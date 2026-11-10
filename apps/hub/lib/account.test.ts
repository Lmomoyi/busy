import { beforeEach, describe, expect, it, vi } from "vitest";
import { accountSnapshot, clearAccountCache } from "./account";

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

beforeEach(() => {
  clearAccountCache();
});

describe("account snapshot cache", () => {
  const env = { VERCEL_TEAM_ID: "team-id", VERCEL_TOKEN: "server-token" };
  const team = (id = "team-id") => ({
    billing: {
      invoiceItems: { tokenPass: { quantity: 1 } },
      period: {
        end: Date.parse("2026-11-10T08:00:00Z"),
        start: Date.parse("2026-10-10T07:00:00Z"),
      },
    },
    id,
    slug: id,
  });
  /** Answers by URL, so the order of calls doesn't matter. */
  function vercel(over: { report?: () => Response; user?: string } = {}) {
    const answer = (url: string) => {
      if (url.endsWith("/v2/user")) {
        return response({ user: { name: over.user ?? "The user" } });
      }
      if (url.includes("/v2/teams/")) {
        return response(team(decodeURIComponent(url.split("/").at(-1) ?? "")));
      }
      return (
        over.report?.() ??
        response({ results: [{ hour: "2026-10-30 02:00:00", total_cost: 8 }] })
      );
    };
    return vi.fn<typeof fetch>((input) =>
      Promise.resolve(answer(String(input)))
    );
  }
  const to = (fetchImpl: ReturnType<typeof vercel>, part: string) =>
    fetchImpl.mock.calls.filter(([input]) => String(input).includes(part))
      .length;
  const at = (time: string) => new Date(`2026-11-02T${time}Z`);
  const bearer = async () => "team-oidc-token";

  it("keeps the profile for an hour and the usage report for a minute", async () => {
    const fetchImpl = vercel();
    const first = await accountSnapshot(
      "u",
      env,
      fetchImpl,
      at("12:00:00"),
      bearer
    );
    expect(
      await accountSnapshot("u", env, fetchImpl, at("12:00:59"), bearer)
    ).toEqual(first);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await accountSnapshot("u", env, fetchImpl, at("12:01:00"), bearer);
    expect(to(fetchImpl, "/v1/report")).toBe(2);
    expect(to(fetchImpl, "/v2/")).toBe(2);

    await accountSnapshot("u", env, fetchImpl, at("13:00:00"), bearer);
    expect(to(fetchImpl, "/v2/")).toBe(4);
  });

  it("does not keep a failed report or a failed profile request", async () => {
    const fetchImpl = vercel({
      report: vi
        .fn<() => Response>()
        .mockReturnValueOnce(response({ error: "not available" }, 403))
        .mockImplementation(() => response({ results: [] })),
    });
    const failed = await accountSnapshot(
      "u",
      env,
      fetchImpl,
      at("12:00:00"),
      bearer
    );
    expect(failed.tokenPass.status).toBe("unavailable");
    const next = await accountSnapshot(
      "u",
      env,
      fetchImpl,
      at("12:00:01"),
      bearer
    );
    expect(next.tokenPass).toMatchObject({ percentUsed: 0, status: "active" });

    clearAccountCache();
    const down = vi.fn<typeof fetch>(() => Promise.resolve(response({}, 500)));
    const fallback = await accountSnapshot("u", env, down, at("12:00:02"));
    expect(fallback.account.name).toBe("u");
    const back = await accountSnapshot(
      "u",
      env,
      vercel(),
      at("12:00:03"),
      bearer
    );
    expect(back.account.name).toBe("The user");
  });

  it("never serves one token's or team's data to another", async () => {
    const one = vercel({ user: "First account" });
    await accountSnapshot("u", env, one, at("12:00:00"), bearer);

    const other = vercel({ user: "Second account" });
    const otherToken = await accountSnapshot(
      "u",
      { ...env, VERCEL_TOKEN: "another-token" },
      other,
      at("12:00:01"),
      bearer
    );
    expect(otherToken.account.name).toBe("Second account");
    expect(other).toHaveBeenCalledTimes(3);

    const otherTeam = await accountSnapshot(
      "u",
      { ...env, VERCEL_TEAM_ID: "team-two" },
      other,
      at("12:00:02"),
      bearer
    );
    expect(otherTeam.tokenPass.dashboardUrl).toContain("/team-two/");
    expect(other).toHaveBeenCalledTimes(6);

    // Without server configuration nothing cached is shown, only the signed-in user's fallback.
    const signedOut = await accountSnapshot("someone", {}, other);
    expect(signedOut.account.name).toBe("someone");
  });

  it("asks for the team again once its cached billing period has ended", async () => {
    const fetchImpl = vercel();
    await accountSnapshot("u", env, fetchImpl, at("12:00:00"), bearer);
    await accountSnapshot(
      "u",
      env,
      fetchImpl,
      new Date("2026-11-10T08:00:01Z"),
      bearer
    );
    expect(to(fetchImpl, "/v2/teams/")).toBe(2);
  });
});

describe("account snapshot", () => {
  it("uses Vercel profile data and reports Token Pass usage for the current billing period", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({
          user: {
            avatar: "avatar-hash",
            name: "Alex Rivera",
            username: "alexrivera",
          },
        })
      )
      .mockResolvedValueOnce(
        response({
          billing: {
            invoiceItems: { tokenPass: { quantity: 1 } },
            period: {
              end: Date.parse("2026-11-10T08:00:00Z"),
              start: Date.parse("2026-10-10T07:00:00Z"),
            },
          },
          id: "team-id",
          slug: "mati-solina",
        })
      )
      .mockResolvedValueOnce(
        response({
          results: [
            { hour: "2026-10-30 02:00:00", total_cost: 8.4 },
            // The reporting API's end_date is inclusive, so the service filters
            // this row out because it is after the billing period's exact end.
            { hour: "2026-11-10 08:00:00", total_cost: 99 },
          ],
        })
      );

    const snapshot = await accountSnapshot(
      "fallback",
      { VERCEL_TEAM_ID: "team-id", VERCEL_TOKEN: "server-token" },
      fetchImpl,
      new Date("2026-11-02T12:00:00Z"),
      async () => "team-oidc-token"
    );
    expect(snapshot).toEqual({
      account: {
        avatarUrl: "https://api.vercel.com/www/avatar/avatar-hash",
        name: "Alex Rivera",
        username: "alexrivera",
      },
      tokenPass: {
        dashboardUrl: "https://vercel.com/mati-solina/~/ai-gateway/token-pass",
        limitUsd: 80,
        percentUsed: 10.5,
        resetsAt: "2026-11-10T08:00:00.000Z",
        status: "active",
        usedUsd: 8.4,
      },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    const profileHeaders = fetchImpl.mock.calls[0]?.[1]?.headers as Record<
      string,
      string
    >;
    const reportHeaders = fetchImpl.mock.calls[2]?.[1]?.headers as Record<
      string,
      string
    >;
    expect(profileHeaders.Authorization).toBe("Bearer server-token");
    expect(reportHeaders.Authorization).toBe("Bearer team-oidc-token");
    const reportUrl = new URL(String(fetchImpl.mock.calls[2]?.[0]));
    expect(reportUrl.searchParams.get("group_by")).toBe("day");
    expect(reportUrl.searchParams.get("date_part")).toBe("hour");
    expect(reportUrl.searchParams.get("provider")).toBe("token-pass");
  });

  it("does not invent a percentage when the report is unavailable", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ user: { name: "Alex Rivera" } }))
      .mockResolvedValueOnce(
        response({
          billing: {
            period: {
              end: Date.parse("2026-11-10T08:00:00Z"),
              start: Date.parse("2026-10-10T07:00:00Z"),
            },
          },
          id: "team-id",
          slug: "mati-solina",
        })
      )
      .mockResolvedValueOnce(response({ error: "not available" }, 403));

    const snapshot = await accountSnapshot(
      "alex",
      { VERCEL_TEAM_ID: "team-id", VERCEL_TOKEN: "server-token" },
      fetchImpl,
      new Date("2026-11-02T12:00:00Z"),
      async () => "team-oidc-token"
    );
    expect(snapshot.account.name).toBe("Alex Rivera");
    expect(snapshot.tokenPass.status).toBe("unavailable");
    expect(snapshot.tokenPass.percentUsed).toBeNull();
    expect(snapshot.tokenPass.usedUsd).toBeNull();
  });

  it("reports a real zero when Token Pass is active but no hourly usage rows exist", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ user: { name: "Alex Rivera" } }))
      .mockResolvedValueOnce(
        response({
          billing: {
            invoiceItems: { tokenPass: { quantity: 1 } },
            period: {
              end: Date.parse("2026-11-10T08:00:00Z"),
              start: Date.parse("2026-10-10T07:00:00Z"),
            },
          },
          id: "team-id",
          slug: "mati-solina",
        })
      )
      .mockResolvedValueOnce(response({ results: [] }));

    const snapshot = await accountSnapshot(
      "alex",
      { VERCEL_TEAM_ID: "team-id", VERCEL_TOKEN: "server-token" },
      fetchImpl,
      new Date("2026-11-02T12:00:00Z"),
      async () => "team-oidc-token"
    );
    expect(snapshot.tokenPass).toMatchObject({
      limitUsd: 80,
      percentUsed: 0,
      status: "active",
      usedUsd: 0,
    });
  });

  it("does not invent zero usage for an inactive team", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ user: { name: "Alex Rivera" } }))
      .mockResolvedValueOnce(
        response({
          billing: {
            invoiceItems: { tokenPass: { quantity: 0 } },
            period: {
              end: Date.parse("2026-11-10T08:00:00Z"),
              start: Date.parse("2026-10-10T07:00:00Z"),
            },
          },
          id: "team-id",
          slug: "mati-solina",
        })
      )
      .mockResolvedValueOnce(response({ results: [] }));

    const snapshot = await accountSnapshot(
      "alex",
      { VERCEL_TEAM_ID: "team-id", VERCEL_TOKEN: "server-token" },
      fetchImpl,
      new Date("2026-11-02T12:00:00Z"),
      async () => "team-oidc-token"
    );
    expect(snapshot.tokenPass.status).toBe("unavailable");
    expect(snapshot.tokenPass.percentUsed).toBeNull();
  });

  it("does not treat malformed report rows as valid zero or partial usage", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ user: { name: "Alex Rivera" } }))
      .mockResolvedValueOnce(
        response({
          billing: {
            invoiceItems: { tokenPass: { quantity: 1 } },
            period: {
              end: Date.parse("2026-11-10T08:00:00Z"),
              start: Date.parse("2026-10-10T07:00:00Z"),
            },
          },
          id: "team-id",
          slug: "mati-solina",
        })
      )
      .mockResolvedValueOnce(
        response({
          results: [
            { hour: "2026-10-30 02:00:00", total_cost: 8.4 },
            { hour: "not-a-date", total_cost: 1 },
          ],
        })
      );

    const snapshot = await accountSnapshot(
      "alex",
      { VERCEL_TEAM_ID: "team-id", VERCEL_TOKEN: "server-token" },
      fetchImpl,
      new Date("2026-11-02T12:00:00Z"),
      async () => "team-oidc-token"
    );
    expect(snapshot.tokenPass.status).toBe("unavailable");
    expect(snapshot.tokenPass.percentUsed).toBeNull();
    expect(snapshot.tokenPass.usedUsd).toBeNull();
  });

  it("does not use billing data returned for a different team", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ user: { name: "Alex Rivera" } }))
      .mockResolvedValueOnce(
        response({
          billing: {
            invoiceItems: { tokenPass: { quantity: 1 } },
            period: {
              end: Date.parse("2026-11-10T08:00:00Z"),
              start: Date.parse("2026-10-10T07:00:00Z"),
            },
          },
          id: "another-team",
          slug: "another-team",
        })
      );

    const snapshot = await accountSnapshot(
      "alex",
      { VERCEL_TEAM_ID: "team-id", VERCEL_TOKEN: "server-token" },
      fetchImpl,
      new Date("2026-11-02T12:00:00Z"),
      async () => "team-oidc-token"
    );
    expect(snapshot.tokenPass.percentUsed).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to the authenticated Busy user without server configuration", async () => {
    const snapshot = await accountSnapshot(
      "alex",
      { BUSY_DISPLAY_NAME: "Alex Rivera" },
      vi.fn<typeof fetch>(),
      new Date("2026-11-02T12:00:00Z")
    );
    expect(snapshot.account).toEqual({
      avatarUrl: null,
      name: "Alex Rivera",
      username: "alex",
    });
    expect(snapshot.tokenPass.percentUsed).toBeNull();
  });
});
