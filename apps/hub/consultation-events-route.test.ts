import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: vi.fn(),
  persistedEvents: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ bots: {}, consultations: {}, db: mocks.db }));
vi.mock("@/lib/chat/send", () => ({
  persistedEvents: mocks.persistedEvents,
}));
vi.mock("@/lib/chat/store", () => ({
  botCall: vi.fn(),
  cursorOf: vi.fn(),
  saver: vi.fn(),
}));
vi.mock("@/lib/eve/client", () => ({
  childStreamPath: vi.fn(),
  readStreamAt: vi.fn(),
}));

const id = "11111111-1111-4111-8111-111111111111";

describe("consultation events route", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("rejects a cursor that is not a line number before reading anything", async () => {
    const { GET } = await import("./app/api/consultations/[id]/events/route");
    for (const after of ["abc", "NaN", "Infinity", "1.5"]) {
      // biome-ignore lint/performance/noAwaitInLoops: each cursor is its own request.
      const response = await GET(
        new Request(
          `https://busy.test/api/consultations/${id}/events?after=${after}`
        ),
        { params: Promise.resolve({ id }) }
      );
      expect(response.status).toBe(400);
    }
    expect(mocks.db).not.toHaveBeenCalled();
    expect(mocks.persistedEvents).not.toHaveBeenCalled();
  });
});
