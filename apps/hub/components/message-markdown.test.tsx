// @vitest-environment happy-dom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it as test, vi } from "vitest";
import type { MarkdownResult } from "@/lib/chat/markdown-protocol";
import { MessageMarkdown } from "./message-markdown";

const worker = vi.hoisted(() => ({
  requests: [] as { text: string; answer: () => void }[],
}));
vi.mock("@/lib/chat/markdown-client", () => ({
  requestMarkdown: (text: string) =>
    new Promise<MarkdownResult>((resolve) => {
      worker.requests.push({
        answer: () => resolve({ blocks: [], hideCaret: false }),
        text,
      });
    }),
}));
vi.mock("@/components/prepared-markdown", () => ({
  PreparedMarkdown: () => null,
}));

afterEach(() => {
  cleanup();
  worker.requests.length = 0;
});

const answer = (index: number) =>
  act(async () => {
    worker.requests[index]?.answer();
    await Promise.resolve();
  });

test("parses only the newest text while an earlier parse is still running", async () => {
  const view = render(<MessageMarkdown streaming text="a" />);
  for (const text of ["ab", "abc", "abcd"]) {
    view.rerender(<MessageMarkdown streaming text={text} />);
  }
  // Tokens that arrived during the first parse are not queued behind it one by one.
  expect(worker.requests.map((r) => r.text)).toEqual(["a"]);
  await answer(0);
  expect(worker.requests.map((r) => r.text)).toEqual(["a", "abcd"]);
  await answer(1);
  expect(worker.requests).toHaveLength(2);
  expect(
    view.container
      .querySelector("[data-markdown-worker]")
      ?.hasAttribute("data-markdown-loading")
  ).toBe(false);
});
