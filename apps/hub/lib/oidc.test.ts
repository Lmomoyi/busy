import { generateKeyPair, SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { verifyHubDeveloper } from "./oidc";

const TEAM = "test-team";
const keys = await generateKeyPair("ES256");

async function request(claims: Record<string, unknown>) {
  const token = await new SignJWT({
    environment: "development",
    sub: `owner:${TEAM}:project:busy-hub:environment:development`,
    user_id: "user-a",
    ...claims,
  })
    .setProtectedHeader({ alg: "ES256" })
    .setAudience(`https://vercel.com/${TEAM}`)
    .setIssuer(`https://oidc.vercel.com/${TEAM}`)
    .setExpirationTime("5m")
    .sign(keys.privateKey);
  return new Request("http://hub.test/api/dev/live/lawyer", {
    headers: { authorization: `Bearer ${token}` },
  });
}
const verify = async (claims: Record<string, unknown> = {}) =>
  verifyHubDeveloper(await request(claims), {
    jwks: async () => keys.publicKey,
    team: TEAM,
  });

describe("verifyHubDeveloper", () => {
  it("returns the user id of a development token for the hub project", async () => {
    await expect(verify()).resolves.toBe("user-a");
  });

  it.each([
    [
      "another project",
      { sub: `owner:${TEAM}:project:bot-x:environment:production` },
    ],
    [
      "another team",
      { sub: "owner:other:project:busy-hub:environment:development" },
    ],
    ["a production token", { environment: "production" }],
    ["no user id", { user_id: undefined }],
  ])("refuses %s", async (_name, claims) => {
    await expect(verify(claims)).rejects.toThrow();
  });
});
