/**
 * The small, server-only account snapshot used by the shell.  Vercel does not
 * expose the Token Pass balance through the Token Pass API key itself, so the
 * report is queried with a team-scoped Vercel OIDC token.  Nothing in this
 * module returns a credential to the browser.
 */

import { getVercelOidcToken } from "@vercel/oidc";
import { decodeJwt } from "jose";

const VERCEL_API = "https://api.vercel.com";
const AI_GATEWAY_API = "https://ai-gateway.vercel.sh/v1/report";
// Team-wide allowance: https://vercel.com/docs/ai-gateway/token-pass/billing
const TOKEN_PASS_CREDIT_USD = 80;
const FETCH_TIMEOUT_MS = 5000;
// The shell asks on every load, focus and minute; the profile and billing period rarely change.
const PROFILE_TTL_MS = 60 * 60_000;
const USAGE_TTL_MS = 60_000;

type Source = Record<string, string | undefined>;

type FetchLike = typeof fetch;

interface VercelUserResponse {
  user?: {
    name?: unknown;
    username?: unknown;
    avatar?: unknown;
  };
}

interface VercelTeamResponse {
  billing?: {
    period?: {
      start?: unknown;
      end?: unknown;
    };
    invoiceItems?: {
      tokenPass?: { quantity?: unknown };
    };
  };
  id?: unknown;
  slug?: unknown;
}

interface ReportResponse {
  results?: Array<{
    hour?: unknown;
    total_cost?: unknown;
  }>;
}

type ReportToken = () => Promise<string | null>;

export interface AccountSnapshot {
  account: {
    name: string;
    username: string | null;
    avatarUrl: string | null;
  };
  tokenPass: {
    status: "active" | "unavailable";
    percentUsed: number | null;
    usedUsd: number | null;
    limitUsd: number | null;
    resetsAt: string | null;
    dashboardUrl: string;
  };
}

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const finiteNumber = (value: unknown): number | null => {
  let number = Number.NaN;
  if (typeof value === "number") {
    number = value;
  } else if (typeof value === "string") {
    number = Number(value);
  }
  return Number.isFinite(number) ? number : null;
};

const dateFromMillis = (value: unknown): Date | null => {
  const millis = finiteNumber(value);
  if (millis === null) {
    return null;
  }
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date;
};

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

const round = (value: number, digits = 6) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

function avatarUrl(hash: string | null): string | null {
  return hash ? `${VERCEL_API}/www/avatar/${encodeURIComponent(hash)}` : null;
}

function fallbackSnapshot(user: string, env: Source): AccountSnapshot {
  const name = text(env.BUSY_DISPLAY_NAME) ?? user;
  const dashboardUrl = "https://vercel.com/dashboard/ai-gateway/token-pass";
  return {
    account: {
      avatarUrl: avatarUrl(text(env.BUSY_AVATAR_HASH)),
      name,
      username: user || null,
    },
    tokenPass: {
      dashboardUrl,
      limitUsd: null,
      percentUsed: null,
      resetsAt: null,
      status: "unavailable",
      usedUsd: null,
    },
  };
}

async function json<T>(
  fetchImpl: FetchLike,
  url: string,
  token: string
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// Per instance, and keyed by the Vercel token and team that own the data: another token or team
// never reads these entries. Nothing here depends on the signed-in Busy user.
const cache = new Map<string, { expires: number; value: unknown }>();

export function clearAccountCache() {
  cache.clear();
}

/** A null (failed or unusable) answer is never kept: the next request asks again. */
async function cached<T>(
  key: string,
  ttlMs: number,
  now: Date,
  load: () => Promise<T | null>,
  usable: (value: T) => boolean = () => true
): Promise<T | null> {
  const hit = cache.get(key);
  if (hit && hit.expires > now.getTime() && usable(hit.value as T)) {
    return hit.value as T;
  }
  const value = await load();
  if (value === null) {
    cache.delete(key);
  } else {
    cache.set(key, { expires: now.getTime() + ttlMs, value });
  }
  return value;
}

function oidcOwnerId(token: string): string | null {
  try {
    return text((decodeJwt(token) as Record<string, unknown>).owner_id);
  } catch {
    return null;
  }
}

/**
 * Custom reporting is team-scoped by the bearer token, not by a query
 * parameter. Prefer a fresh Vercel OIDC token because its owner_id is the
 * deployment's team. AI_GATEWAY_REPORT_TOKEN is an explicit escape hatch for
 * a regular team-scoped AI Gateway key provisioned by the operator.
 */
async function defaultReportToken(
  env: Source,
  teamId: string
): Promise<string | null> {
  const explicit = text(env.AI_GATEWAY_REPORT_TOKEN);
  if (explicit) {
    return explicit;
  }
  try {
    const oidc = await getVercelOidcToken();
    return oidcOwnerId(oidc) === teamId ? oidc : null;
  } catch {
    const oidc = text(env.VERCEL_OIDC_TOKEN);
    return oidc && oidcOwnerId(oidc) === teamId ? oidc : null;
  }
}

function reportHour(value: unknown): Date | null {
  const raw = text(value);
  if (!raw) {
    return null;
  }
  // The reporting API returns UTC hours as `YYYY-MM-DD HH:mm:ss`.
  const date = new Date(`${raw.replace(" ", "T")}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Returns null for an unusable response. An empty, well-formed result set is
 * a real zero; a non-empty set must have a valid hourly timestamp and cost on
 * every row, otherwise showing a partial balance would be misleading.
 */
function reportUsage(
  report: ReportResponse | null,
  periodStart: Date,
  periodEnd: Date
): { usedUsd: number; currentRows: number } | null {
  if (!(report && Array.isArray(report.results))) {
    return null;
  }
  let usedUsd = 0;
  let currentRows = 0;
  for (const row of report.results) {
    const at = reportHour(row?.hour);
    const cost = finiteNumber(row?.total_cost);
    if (!at || cost === null || cost < 0) {
      return null;
    }
    if (at >= periodStart && at < periodEnd) {
      usedUsd += cost;
      currentRows += 1;
    }
  }
  return { currentRows, usedUsd };
}

/**
 * Read the single account's display data and the current Token Pass period.
 * Vercel's reporting endpoint is the authoritative usage source; if either
 * the access token, billing period, or report is unavailable the usage fields
 * stay null so the UI can say that usage is unavailable instead of guessing.
 */
export async function accountSnapshot(
  user: string,
  env: Source = process.env,
  fetchImpl: FetchLike = fetch,
  now = new Date(),
  reportToken?: ReportToken
): Promise<AccountSnapshot> {
  const fallback = fallbackSnapshot(user, env);
  const token = text(env.VERCEL_TOKEN);
  const teamId = text(env.VERCEL_TEAM_ID);
  if (!(token && teamId)) {
    return fallback;
  }

  const identity = `${teamId}:${token}`;
  const [vercelUser, rawTeam] = await Promise.all([
    cached(`user:${identity}`, PROFILE_TTL_MS, now, () =>
      json<VercelUserResponse>(fetchImpl, `${VERCEL_API}/v2/user`, token)
    ),
    cached(
      `team:${identity}`,
      PROFILE_TTL_MS,
      now,
      () =>
        json<VercelTeamResponse>(
          fetchImpl,
          `${VERCEL_API}/v2/teams/${encodeURIComponent(teamId)}`,
          token
        ),
      // A billing period that ended since it was read: ask for the new one.
      (kept) => {
        const end = dateFromMillis(kept.billing?.period?.end);
        return !end || now < end;
      }
    ),
  ]);
  // Never let a token's default/personal team silently supply the billing
  // period for another configured team.
  const team = rawTeam?.id === teamId ? rawTeam : null;

  const name =
    text(vercelUser?.user?.name) ??
    text(vercelUser?.user?.username) ??
    text(team?.slug) ??
    fallback.account.name;
  const username =
    text(vercelUser?.user?.username) ?? fallback.account.username;
  const account = {
    avatarUrl:
      avatarUrl(text(vercelUser?.user?.avatar)) ?? fallback.account.avatarUrl,
    name,
    username,
  };
  const teamSlug = text(team?.slug);
  const dashboardUrl = teamSlug
    ? `https://vercel.com/${encodeURIComponent(teamSlug)}/~/ai-gateway/token-pass`
    : fallback.tokenPass.dashboardUrl;

  const periodStart = dateFromMillis(team?.billing?.period?.start);
  const periodEnd = dateFromMillis(team?.billing?.period?.end);
  const periodIsCurrent = Boolean(
    periodStart && periodEnd && periodStart < now && now < periodEnd
  );
  const tokenPassEnabled =
    (finiteNumber(team?.billing?.invoiceItems?.tokenPass?.quantity) ?? 0) > 0;

  if (!(periodStart && periodEnd && periodIsCurrent)) {
    return { account, tokenPass: { ...fallback.tokenPass, dashboardUrl } };
  }

  const reportUrl = new URL(AI_GATEWAY_API);
  reportUrl.searchParams.set("start_date", isoDay(periodStart));
  reportUrl.searchParams.set("end_date", isoDay(periodEnd));
  // The API dates are inclusive. Hourly rows let us respect the billing
  // period's exact UTC end instead of charging the entire end calendar day.
  reportUrl.searchParams.set("group_by", "day");
  reportUrl.searchParams.set("date_part", "hour");
  reportUrl.searchParams.set("provider", "token-pass");
  // Only a usable report is kept; the bearer is resolved on a miss.
  const usage = await cached(
    `usage:${identity}:${reportUrl}`,
    USAGE_TTL_MS,
    now,
    async () => {
      const bearer = reportToken
        ? await reportToken().catch(() => null)
        : await defaultReportToken(env, teamId);
      const report = bearer
        ? await json<ReportResponse>(fetchImpl, reportUrl.toString(), bearer)
        : null;
      return reportUsage(report, periodStart, periodEnd);
    }
  );
  // A non-empty, valid current-period result also proves that Token Pass is
  // active when billing metadata is briefly behind the reporting stream.
  const active = tokenPassEnabled || (usage !== null && usage.currentRows > 0);

  // A valid report with no matching hourly rows is a real zero only when the
  // team is known to have Token Pass enabled. Otherwise leave it unavailable:
  // a standard AI Gateway team can also have zero token-pass rows.
  if (!(usage && active)) {
    return { account, tokenPass: { ...fallback.tokenPass, dashboardUrl } };
  }

  const safeUsedUsd = usage.usedUsd;
  const percentUsed = round(
    Math.min(100, Math.max(0, (safeUsedUsd / TOKEN_PASS_CREDIT_USD) * 100)),
    1
  );
  return {
    account,
    tokenPass: {
      dashboardUrl,
      limitUsd: TOKEN_PASS_CREDIT_USD,
      percentUsed,
      resetsAt: periodEnd.toISOString(),
      status: "active",
      usedUsd: round(safeUsedUsd),
    },
  };
}
