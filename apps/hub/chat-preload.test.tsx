// @vitest-environment happy-dom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatApp } from "@/components/chat-app";
import {
  held,
  initialBot,
  installFakes,
  json,
  type Server,
  type Streams,
  settle,
} from "@/components/components.test-helpers";

vi.mock("@/components/chat-pane", () => ({ ChatPane: () => null }));

const SNAPSHOT = /^\/api\/bots\/[^/]+\/snapshot$/u;
const background = ["beta", "gamma", "delta", "epsilon"];
const bots = [
  initialBot("alpha", { name: "Alpha" }),
  ...background.map((slug) =>
    initialBot(slug, { name: slug, snapshotLoaded: false })
  ),
];
const snapshot = () => json({ consults: [], rows: [], sessionId: "s1" });

let server: Server;
let streams: Streams;
let idle: (() => void)[];
let answers: Map<string, ReturnType<typeof held>>;

/** Runs what the browser would run once it is idle. */
async function becomeIdle() {
  await act(async () => {
    for (const callback of idle.splice(0)) {
      callback();
    }
    await Promise.resolve();
  });
  await settle();
}

const requested = () =>
  server.to("GET", SNAPSHOT).map((call) => call.path.split("/")[3]);

beforeEach(() => {
  ({ server, streams } = installFakes());
  idle = [];
  answers = new Map();
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    idle.push(callback);
    return idle.length;
  });
  vi.stubGlobal("cancelIdleCallback", () => {
    idle = [];
  });
  server.on(
    "GET",
    "/api/account",
    json({
      account: { avatarUrl: null, name: "The user" },
      tokenPass: {
        dashboardUrl: "https://vercel.com",
        percentUsed: 12.5,
        status: "active",
      },
    })
  );
  server.on("GET", SNAPSHOT, (call) => {
    const answer = held();
    answers.set(call.path.split("/")[3] ?? "", answer);
    return answer.answer();
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function renderChats() {
  await act(async () => {
    render(<ChatApp initial={bots} selected="alpha" />);
    await Promise.resolve();
  });
  await settle();
}

describe("background chat preload", () => {
  it("waits for the browser to be idle, after the selected chat's stream", async () => {
    await renderChats();
    expect(streams.live("alpha")).toHaveLength(1);
    expect(requested()).toEqual([]);

    await becomeIdle();
    expect(requested()).toEqual(["beta", "gamma"]);
  });

  it("keeps at most two snapshots in flight and loads every chat in the end", async () => {
    await renderChats();
    await becomeIdle();
    let settledCount = 0;
    let most = requested().length - settledCount;
    for (const slug of background) {
      const answer = answers.get(slug);
      expect(answer, `${slug} was requested`).toBeDefined();
      // A failed snapshot must not stall the ones behind it.
      if (slug === "gamma") {
        answer?.reject(new Error("offline"));
      } else {
        answer?.resolve(snapshot());
      }
      settledCount += 1;
      // biome-ignore lint/performance/noAwaitInLoops: each answer releases the next request.
      await settle();
      most = Math.max(most, requested().length - settledCount);
    }
    expect(most).toBe(2);
    expect(requested()).toEqual(background);
  });

  it("stops when the app unmounts", async () => {
    await renderChats();
    await becomeIdle();
    cleanup();
    answers.get("beta")?.resolve(snapshot());
    answers.get("gamma")?.resolve(snapshot());
    await settle();
    expect(requested()).toEqual(["beta", "gamma"]);
  });

  it("does not start at all when the app unmounts before the browser is idle", async () => {
    await renderChats();
    cleanup();
    await becomeIdle();
    expect(requested()).toEqual([]);
  });

  it("still loads a chat at once when its row is hovered", async () => {
    await renderChats();
    fireEvent.pointerEnter(screen.getAllByRole("button", { name: "delta" })[0]);
    await settle();
    expect(requested()).toEqual(["delta"]);

    // The queue skips what is already loading.
    await becomeIdle();
    answers.get("beta")?.resolve(snapshot());
    await settle();
    expect(requested()).toEqual(["delta", "beta", "gamma", "epsilon"]);
  });

  it("falls back to a timer where requestIdleCallback is missing", async () => {
    vi.stubGlobal("requestIdleCallback", undefined);
    await renderChats();
    expect(requested()).toEqual([]);
    await waitFor(() => expect(requested()).toEqual(["beta", "gamma"]));
  });
});
