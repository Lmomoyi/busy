"use client";

import { type MouseEvent, useCallback } from "react";
import { Button } from "@/components/ui/button";

/** The Suggestion pattern from shadcn/ui's AI Elements. One tap sends the reply as the user's message; writing anything else makes them go away (items.ts). */
export function QuickReplies({
  replies,
  onPick,
}: {
  replies: readonly string[];
  onPick: (text: string) => void;
}) {
  const pick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { reply } = event.currentTarget.dataset;
      if (reply) {
        onPick(reply);
      }
    },
    [onPick]
  );

  if (replies.length === 0) {
    return null;
  }

  return (
    <fieldset className="mx-auto flex w-full shrink-0 flex-wrap justify-end gap-2 px-6 pb-2">
      <legend className="sr-only">Suggested replies</legend>
      {replies.map((reply) => (
        <Button
          className="animate-enter max-w-full"
          data-reply={reply}
          key={reply}
          onClick={pick}
          size="sm"
          type="button"
          variant="outline"
        >
          <span className="truncate">{reply}</span>
        </Button>
      ))}
    </fieldset>
  );
}
