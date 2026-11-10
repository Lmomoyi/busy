import { allowedVercelUser } from "./auth/vercel";
import { verifyHubDeveloper } from "./oidc";

type Env = Record<string, string | undefined>;

const TEAM = "mati-solina";

function denied(status: 401 | 404): Response {
  return new Response(status === 404 ? "not found" : "unauthorized", {
    status,
  });
}

/**
 * Guard the local development relay: closed unless DEV_RELAY_USERS names the Vercel users allowed
 * through, and then only for a development token Vercel signed for one of them. The grant follows
 * the person, so it survives the token's rotation.
 */
export async function authorizeDevRelay(
  req: Request,
  env: Env = process.env
): Promise<Response | null> {
  const users = env.DEV_RELAY_USERS;
  if (!users?.trim()) {
    return denied(404);
  }
  try {
    const user = await verifyHubDeveloper(req, {
      team: env.VERCEL_TEAM_SLUG ?? TEAM,
    });
    return allowedVercelUser(user, users) ? null : denied(401);
  } catch {
    return denied(401);
  }
}
