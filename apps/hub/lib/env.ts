type Source = Record<string, string | undefined>;

export type EnvKey =
  | "HUB_URL"
  | "VERCEL_TOKEN"
  | "VERCEL_TEAM_ID"
  | "VERCEL_TEAM_SLUG"
  | "BOTS_DOMAIN"
  | "BUSY_USER"
  | "BUSY_PASSWORD_HASH"
  | "VERCEL_APP_CLIENT_ID"
  | "VERCEL_APP_CLIENT_SECRET"
  | "SESSION_SECRET"
  | "DATABASE_URL"
  | "CRON_SECRET"
  | "BOT_BASE_IMAGE"
  | "TOKEN_PASS_API_KEY"
  | "HUB_SIGNING_KEY";

/** A hub setting the operator must fix; its key is safe to show in the app. */
export class EnvError extends Error {
  readonly key: EnvKey;
  constructor(key: EnvKey, message = `Missing environment variable ${key}`) {
    super(message);
    this.name = "EnvError";
    this.key = key;
  }
}

/** What the app shows for an EnvError: names the setting, never its value. */
export const envSetupMessage = (key: EnvKey) =>
  `The hub has no valid ${key} setting. Set it on the hub project and redeploy the hub (docs/handbook.md).`;
export const ENV_SETUP_MESSAGE_RE =
  /^The hub has no valid [A-Z_]+ setting\. Set it on the hub project and redeploy the hub \(docs\/handbook\.md\)\.$/u;

// Read each variable where it's used, so a route only fails for what it needs.
export function need(key: EnvKey, source: Source = process.env): string {
  const value = source[key];
  if (!value) {
    throw new EnvError(key);
  }
  return value;
}
