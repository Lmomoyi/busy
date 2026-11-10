import assert from "node:assert/strict";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET as relay } from "./app/api/dev/bots/[slug]/[...path]/route";

const mocks = vi.hoisted(() => ({
  signHubToken: vi.fn(),
  signRoutineToken: vi.fn(),
  verifyHubDeveloper: vi.fn(),
}));

vi.mock("@/lib/oidc", () => ({ verifyHubDeveloper: mocks.verifyHubDeveloper }));
vi.mock("@/lib/hub-token", () => ({
  isRoutineRunId: (value: unknown) =>
    typeof value === "string" && routineRunIdPattern.test(value),
  signHubToken: mocks.signHubToken,
  signRoutineToken: mocks.signRoutineToken,
}));

const runId = "11111111-1111-4111-8111-111111111111";
const bearerToken = "synthetic-development-oidc";
const routineRunIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const params = (slug = "lawyer", path = ["eve", "v1", "session", "s1"]) => ({
  params: Promise.resolve({ path, slug }),
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("DEV_RELAY_USERS", "user-a");
  mocks.verifyHubDeveloper.mockResolvedValue("user-a");
  mocks.signHubToken.mockResolvedValue("hub-token");
  mocks.signRoutineToken.mockResolvedValue("routine-token");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("ok", { status: 202 }))
  );
});

describe("development bot relay", () => {
  it("signs a verified routine occurrence and never forwards the untrusted marker", async () => {
    const req = new Request(
      "http://hub.test/api/dev/bots/lawyer/eve/v1/session/s1",
      {
        body: JSON.stringify({ message: "routine" }),
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
          "X-Busy-Routine-Run": runId,
        },
        method: "POST",
      }
    );

    const response = await relay(req, params());
    expect(response.status).toBe(202);
    expect(mocks.verifyHubDeveloper).toHaveBeenCalledWith(req, {
      team: "mati-solina",
    });
    expect(mocks.signRoutineToken).toHaveBeenCalledWith("lawyer", runId);
    expect(mocks.signHubToken).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "https://lawyer.bots.matisolina.com/eve/v1/session/s1",
      expect.objectContaining({
        headers: {
          Authorization: "Bearer routine-token",
          "Content-Type": "application/json",
        },
      })
    );
    const [forwardedCall] = (fetch as unknown as ReturnType<typeof vi.fn>).mock
      .calls;
    assert(forwardedCall);
    const forwarded = forwardedCall[1] as RequestInit;
    expect(JSON.stringify(forwarded.headers)).not.toContain(
      "x-busy-routine-run"
    );
  });

  it("rejects an untrusted or malformed routine marker before signing or forwarding", async () => {
    const req = new Request(
      "http://hub.test/api/dev/bots/lawyer/eve/v1/session/s1",
      {
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "X-Busy-Routine-Run": "not-a-uuid",
        },
      }
    );

    const response = await relay(req, params());
    expect(response.status).toBe(400);
    expect(mocks.signRoutineToken).not.toHaveBeenCalled();
    expect(mocks.signHubToken).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("uses the ordinary hub token when no routine marker is present", async () => {
    const req = new Request(
      "http://hub.test/api/dev/bots/lawyer/eve/v1/session/s1",
      { headers: { Authorization: `Bearer ${bearerToken}` } }
    );
    const response = await relay(req, params());

    expect(response.status).toBe(202);
    expect(mocks.signHubToken).toHaveBeenCalledWith("lawyer");
    expect(mocks.signRoutineToken).not.toHaveBeenCalled();
  });

  it("does not forward an unauthenticated request", async () => {
    mocks.verifyHubDeveloper.mockRejectedValue(new Error("not authorized"));
    const req = new Request(
      "http://hub.test/api/dev/bots/lawyer/eve/v1/session/s1",
      { headers: { Authorization: `Bearer ${bearerToken}` } }
    );
    const response = await relay(req, params());

    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps a relay without registered users closed", async () => {
    vi.stubEnv("DEV_RELAY_USERS", "");
    const response = await relay(
      new Request("http://hub.test/api/dev/bots/lawyer/eve/v1/session/s1", {
        headers: { Authorization: `Bearer ${bearerToken}` },
      }),
      params()
    );
    expect(response.status).toBe(404);
    expect(mocks.verifyHubDeveloper).not.toHaveBeenCalled();
  });

  it("rejects a verified developer who is not registered", async () => {
    mocks.verifyHubDeveloper.mockResolvedValue("user-b");
    const req = new Request(
      "http://hub.test/api/dev/bots/lawyer/eve/v1/session/s1",
      { headers: { Authorization: `Bearer ${bearerToken}` } }
    );
    const response = await relay(req, params());
    expect(response.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
  });
});
