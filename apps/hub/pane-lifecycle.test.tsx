// @vitest-environment happy-dom
// What a closed dialog or a hidden chat pane must stop doing, and survive coming back from.
import assert from "node:assert/strict";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initialBot,
  installFakes,
  json,
  pane,
  renderApp,
  requested,
  type Server,
  said,
  seq,
  settle,
  started,
} from "./components/components.test-helpers";
import { McpAppFrame } from "./components/mcp-app-frame";

const rfb = vi.hoisted(() => {
  const made: { disconnected: boolean; fire: (type: string) => void }[] = [];
  class RFB extends EventTarget {
    viewOnly = false;
    disconnected = false;
    constructor() {
      super();
      made.push(this);
    }
    fire(type: string) {
      this.dispatchEvent(new Event(type));
    }
    disconnect() {
      this.disconnected = true;
    }
    // biome-ignore lint/style/useThisInClassMethods: no-op browser API mock.
    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op browser API mock.
    blur() {}
  }
  return { made, RFB };
});
vi.mock("@novnc/novnc", () => ({ default: rfb.RFB }));
vi.mock("virtua", () => import("@/components/virtua-test-double"));

/**
 * Models the sandbox proxy in lib/mcp/app-sandbox.ts: it announces
 * `sandbox-proxy-ready` every 250 ms only until it receives the resource once.
 */
const sandbox = vi.hoisted(() => ({ resourceReceived: false }));
vi.mock("@modelcontextprotocol/ext-apps/app-bridge", () => {
  const done = () => Promise.resolve();
  class AppBridge extends EventTarget {
    oninitialized: (() => void) | null = null;
    onerror: (() => void) | null = null;
    sendToolInput = done;
    sendToolResult = done;
    setHostContext = done;
    teardownResource = done;
    connect() {
      // The proxy only keeps announcing while it has not been given a resource.
      if (!sandbox.resourceReceived) {
        queueMicrotask(() => this.dispatchEvent(new Event("sandboxready")));
      }
      return Promise.resolve();
    }
    sendSandboxResourceReady() {
      sandbox.resourceReceived = true;
      // The app inside the proxy initializes once, against this bridge.
      queueMicrotask(() => this.oninitialized?.());
      return Promise.resolve();
    }
  }
  class PostMessageTransport {
    close = done;
  }
  return { AppBridge, PostMessageTransport };
});

const LAWYER = /^Lawyer/u;
const resolved = () => Promise.resolve({});
const inline = () => Promise.resolve({ mode: "inline" as const });
const LIVE = "/api/bots/lawyer/live";
let server: Server;

beforeEach(() => {
  ({ server } = installFakes());
  rfb.made.length = 0;
  sandbox.resourceReceived = false;
  server.on(
    "POST",
    LIVE,
    json({ password: "p", url: "wss://x.test/?token=t", viewOnly: false })
  );
  server.on("PUT", LIVE, json({ expiresAt: Date.now() + 75_000, ok: true }));
  server.on("PATCH", LIVE, json({ expiresAt: Date.now() + 75_000, ok: true }));
});

afterEach(async () => {
  cleanup();
  await settle(30);
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const loginBot = () =>
  initialBot("lawyer", {
    name: "Lawyer",
    rows: seq(
      said("d0", "Sign in"),
      started("turn_1"),
      requested("call_1", "request_login"),
      [
        "interaction.opened",
        {
          interactionId: "login_1",
          request: { kind: "question", prompt: "Please sign in" },
          subject: { callId: "call_1" },
        },
      ]
    ),
  });

async function openAndCloseLive() {
  renderApp([loginBot(), initialBot("coder", { name: "Coder" })]);
  await settle(30);
  fireEvent.click(pane("Lawyer").getByRole("button", { name: "Take control" }));
  await settle(20);
  const [client] = rfb.made;
  assert(client);
  act(() => client.fire("connect"));
  await settle(20);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  await settle(30);
  return client;
}

describe("Live dialog", () => {
  it("disconnects the VNC session when the Live dialog closes", async () => {
    const client = await openAndCloseLive();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(client.disconnected).toBe(true);
  });

  it("does not reopen the computer when returning to a bot whose Live is closed", async () => {
    await openAndCloseLive();
    const before = server.to("POST", LIVE).length;
    fireEvent.click(screen.getByRole("button", { name: "Coder" }));
    await settle(30);
    fireEvent.click(
      screen.getAllByRole("button", { name: LAWYER })[0] as HTMLElement
    );
    await settle(30);
    expect(server.to("POST", LIVE).length).toBe(before);
    expect(rfb.made).toHaveLength(1);
  });
});

describe("MCP App frame", () => {
  it("still initializes after its pane is hidden and shown again", async () => {
    vi.useFakeTimers();
    const onError = vi.fn();
    const frame = (
      <McpAppFrame
        hostContext={{}}
        onCallTool={resolved}
        onError={onError}
        onMessage={resolved}
        onOpenLink={resolved}
        onRequestDisplayMode={inline}
        resource={
          { html: "<main>App</main>", meta: {} } as Parameters<
            typeof McpAppFrame
          >[0]["resource"]
        }
        sandboxUrl="https://sandbox.example.test/mcp-app-sandbox"
        title="App"
      />
    );
    // happy-dom iframes have no window until loaded; give the frame one.
    Object.defineProperty(HTMLIFrameElement.prototype, "contentWindow", {
      configurable: true,
      get: () => window,
    });
    // Reloading the proxy starts its announcements over.
    Object.defineProperty(HTMLIFrameElement.prototype, "src", {
      configurable: true,
      set: () => {
        sandbox.resourceReceived = false;
      },
    });
    const view = render(<Activity mode="visible">{frame}</Activity>);
    await act(() => vi.advanceTimersByTimeAsync(100));
    // Switching bots hides the pane, coming back shows it again.
    view.rerender(<Activity mode="hidden">{frame}</Activity>);
    view.rerender(<Activity mode="visible">{frame}</Activity>);
    await act(() => vi.advanceTimersByTimeAsync(16_000));
    expect(onError).not.toHaveBeenCalled();
  });
});
