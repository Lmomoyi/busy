import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeDevRelay } from "./dev-relay-access";

const verifyHubDeveloper = vi.hoisted(() => vi.fn());
vi.mock("@/lib/oidc", () => ({ verifyHubDeveloper }));

const request = () =>
  new Request("http://hub.test/api/dev/bots/lawyer/eve/v1/session/s1", {
    headers: { authorization: "Bearer synthetic-development-oidc" },
  });
const env = {
  DEV_RELAY_USERS: "user-a, user-b",
  VERCEL_TEAM_SLUG: "test-team",
};

beforeEach(() => {
  vi.resetAllMocks();
  verifyHubDeveloper.mockResolvedValue("user-b");
});

describe("authorizeDevRelay", () => {
  it("accepts a verified development token of a listed user", async () => {
    await expect(authorizeDevRelay(request(), env)).resolves.toBeNull();
    expect(verifyHubDeveloper).toHaveBeenCalledWith(expect.any(Request), {
      team: "test-team",
    });
  });

  it.each([
    ["missing", { ...env, DEV_RELAY_USERS: undefined }],
    ["blank", { ...env, DEV_RELAY_USERS: " " }],
  ])("returns 404 for a %s user list", async (_name, config) => {
    const response = await authorizeDevRelay(request(), config);
    expect(response?.status).toBe(404);
    expect(verifyHubDeveloper).not.toHaveBeenCalled();
  });

  it("returns 401 for a verified user who is not listed", async () => {
    verifyHubDeveloper.mockResolvedValue("user-c");
    expect((await authorizeDevRelay(request(), env))?.status).toBe(401);
  });

  it("returns 401 when the token fails OIDC verification", async () => {
    verifyHubDeveloper.mockRejectedValue(new Error("expired"));
    expect((await authorizeDevRelay(request(), env))?.status).toBe(401);
  });
});
