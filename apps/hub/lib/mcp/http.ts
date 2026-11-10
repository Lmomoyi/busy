import { z } from "zod";

export const connectionId = z.uuid();
export const FLOW_MAX_AGE = 10 * 60;
export const FLOW_PATH = "/api/mcp/callback";
export const flowCookie = (id: string) => `busy_mcp_${id}`;
export const flowCookieOptions = {
  httpOnly: true,
  maxAge: FLOW_MAX_AGE,
  path: FLOW_PATH,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
} as const;

/**
 * The origin the browser used. A local TLS proxy (portless) forwards to the dev server's own
 * port, so `req.url` names an address the browser can't reach, and an OAuth redirect built
 * from it never comes back. Only outside production: a deployed hub's `req.url` is already
 * its public address, and there the header would be one more thing a caller could set.
 */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host =
    process.env.NODE_ENV === "production"
      ? null
      : req.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  if (!host) {
    return url.origin;
  }
  const protocol =
    req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
    url.protocol.slice(0, -1);
  return URL.parse(`${protocol}://${host}`)?.origin ?? url.origin;
}

export function mcpJson(data: unknown, status = 200) {
  return Response.json(data, {
    headers: { "Cache-Control": "no-store" },
    status,
  });
}

export const resultPath = (slug: string, result: "connected" | "error") =>
  slug
    ? `/b/${encodeURIComponent(slug)}?${new URLSearchParams({ mcp: result })}`
    : `/?${new URLSearchParams({ mcp: result })}`;

const CHAT_RETURN_TO = /^\/b\/[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u;

/** Accept only a local Busy bot path; never reflect an absolute/external URL. */
export function safeReturnTo(value: unknown): string | null {
  return typeof value === "string" && CHAT_RETURN_TO.test(value) ? value : null;
}

export function contextualResultPath(
  returnTo: string | null,
  result: "connected" | "error"
): string | null {
  if (!returnTo) {
    return null;
  }
  return result === "connected" ? returnTo : `${returnTo}?codeSetup=error`;
}
