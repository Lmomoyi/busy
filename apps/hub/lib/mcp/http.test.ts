import { afterEach, describe, expect, it, vi } from "vitest";
import { requestOrigin } from "./http";

afterEach(() => {
  vi.unstubAllEnvs();
});

const proxied = (headers: Record<string, string>) =>
  new Request("https://localhost:4102/api/mcp/callback?cid=1", { headers });

describe("requestOrigin", () => {
  it("is the request's own origin when nothing proxies it", () => {
    expect(requestOrigin(new Request("http://localhost:3000/api/mcp"))).toBe(
      "http://localhost:3000"
    );
  });

  it("is the address the browser used behind a local proxy", () => {
    expect(
      requestOrigin(
        proxied({
          "x-forwarded-host": "hub.busy.localhost:1355",
          "x-forwarded-proto": "https",
        })
      )
    ).toBe("https://hub.busy.localhost:1355");
  });

  it("ignores the forwarded host on a deployed hub", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(
      requestOrigin(
        new Request("https://busy.example/api/mcp", {
          headers: { "x-forwarded-host": "evil.example" },
        })
      )
    ).toBe("https://busy.example");
  });

  it("falls back to the request's origin when the forwarded host isn't one", () => {
    expect(requestOrigin(proxied({ "x-forwarded-host": "not a host/" }))).toBe(
      "https://localhost:4102"
    );
  });
});
