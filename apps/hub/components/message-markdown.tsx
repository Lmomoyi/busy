"use client";

import dynamic from "next/dynamic";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PreparedMarkdown } from "@/components/prepared-markdown";
import { requestMarkdown } from "@/lib/chat/markdown-client";
import type { MarkdownResult } from "@/lib/chat/markdown-protocol";
import { decodeMarkdown } from "@/lib/chat/markdown-transport";

const FallbackMarkdown = dynamic(() =>
  import("streamdown").then((module) => module.Streamdown)
);

export function MessageMarkdown({
  text,
  streaming,
  prepared,
}: {
  text: string;
  streaming: boolean;
  prepared?: string;
}) {
  const tree = useMemo(
    () => (prepared ? decodeMarkdown(prepared, text) : undefined),
    [prepared, text]
  );
  const [result, setResult] = useState<{
    text: string;
    streaming: boolean;
    value: MarkdownResult;
  } | null>(null);
  const [fallback, setFallback] = useState(false);
  // One parse at a time, always of the newest text: tokens that arrive while the worker is
  // busy are skipped, not queued, so a long reply never falls behind its own stream.
  const wanted = useRef({ streaming, text });
  const parsing = useRef<boolean>(false);
  const shown = useRef<boolean>(false);
  useEffect(() => {
    if (tree) {
      return;
    }
    shown.current = true;
    wanted.current = { streaming, text };
    const parse = () => {
      const request = wanted.current;
      parsing.current = true;
      requestMarkdown(request.text, request.streaming).then(
        (value) => {
          parsing.current = false;
          if (!shown.current) {
            return;
          }
          setResult({ ...request, value });
          if (wanted.current !== request) {
            parse();
          }
        },
        () => {
          parsing.current = false;
          if (shown.current) {
            setFallback(true);
          }
        }
      );
    };
    if (!parsing.current) {
      parse();
    }
    return () => {
      shown.current = false;
    };
  }, [text, streaming, tree]);
  if (tree) {
    return <PreparedMarkdown tree={tree} />;
  }
  const loading = (
    <div className="whitespace-pre-wrap" data-markdown-loading="">
      {text}
    </div>
  );
  if (fallback) {
    return (
      <Suspense fallback={loading}>
        <FallbackMarkdown
          caret="block"
          isAnimating={streaming}
          mode={streaming ? "streaming" : "static"}
          parseIncompleteMarkdown={streaming}
        >
          {text}
        </FallbackMarkdown>
      </Suspense>
    );
  }
  if (!result) {
    return loading;
  }
  return (
    <div
      data-markdown-loading={
        result.text !== text || result.streaming !== streaming ? "" : undefined
      }
      data-markdown-worker=""
    >
      <PreparedMarkdown
        blocks={result.value.blocks}
        hideCaret={result.value.hideCaret}
        streaming={streaming}
      />
    </div>
  );
}
