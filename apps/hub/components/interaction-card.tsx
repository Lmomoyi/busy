"use client";

import { Check, CircleAlert, Loader2, ShieldCheck, X } from "lucide-react";
import {
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useStore } from "@/components/chat-app";
import { CodeRepositorySetupCard } from "@/components/code-repository-setup-card";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from "@/components/ui/questionnaire";
import type { ChatItem } from "@/lib/chat/items";

/**
 * The small, transport-neutral shape emitted by the eve stream projection.
 * `interaction-card` deliberately owns no event parsing: the stream remains the
 * source of truth, while this component only handles the optimistic UI between
 * an answer request and its settled interaction event.
 */
export type InteractionCardItem = Extract<ChatItem, { kind: "interaction" }>;

interface Props {
  item: InteractionCardItem;
  onAnswer?: (
    id: string,
    answer: { optionId?: string; text?: string }
  ) => Promise<boolean>;
  slug: string;
}

const settled = new Set([
  "accepted",
  "answered",
  "declined",
  "rejected",
  "invalid",
  "failed",
  "withdrawn",
  "interrupted",
  "abandoned",
  "expired",
  "closed",
]);
const safeHttpUrl = (value: string | undefined): string | undefined => {
  if (!value) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
};

interface Answer {
  optionId?: string;
  text?: string;
}
type Options = InteractionCardItem["options"];

/**
 * A question or approval from eve, built from shadcn/ui's AI Elements: a
 * Questionnaire for questions, an Item with actions for approvals (the
 * Confirmation pattern). The user only sees a human label and the answer
 * controls; interaction IDs never appear in the UI. The API request is retried
 * from the same card if transport fails, while eve's settled stream event
 * remains the authority for the final state.
 */
export function InteractionCard({ slug, item, onAnswer }: Props) {
  const store = useStore();
  const { interactionId, link: itemLink, options, prompt, type } = item;
  const state = item.state ?? "open";
  const done = settled.has(state);
  const repositorySetup =
    type === "question" &&
    (item.setup === "code-repository" ||
      item.origin?.callName === "prepare_code_repository");
  const link = safeHttpUrl(itemLink?.url);
  const answer = useCallback(
    (value: Answer) =>
      onAnswer
        ? onAnswer(interactionId, value)
        : store.answer(slug, interactionId, value),
    [interactionId, slug, store, onAnswer]
  );
  const related = link ? (
    <a
      className="hover:text-foreground underline underline-offset-2"
      href={link}
      rel="noreferrer"
      target="_blank"
    >
      {itemLink?.label ?? "Open related page"}
    </a>
  ) : null;

  if (done) {
    return (
      <SettledCard
        answer={
          repositorySetup
            ? undefined
            : givenAnswer(options, item.allowFreeform, item.outcome)
        }
        approval={type === "approval"}
        interactionId={interactionId}
        outcome={settledOutcome(repositorySetup, state, item.outcome)}
        prompt={prompt}
        state={state}
      />
    );
  }

  if (repositorySetup) {
    return (
      <div
        className="border-border flex w-full max-w-md flex-col gap-3 border px-4 py-3"
        data-interaction-id={interactionId}
      >
        <p className="text-sm leading-6 font-medium">{prompt}</p>
        {related ? (
          <p className="text-muted-foreground text-sm">{related}</p>
        ) : null}
        <CodeRepositorySetupCard
          answer={answer}
          botSlug={slug}
          item={item}
          pending={item.pending === true}
          state={state}
        />
      </div>
    );
  }

  return (
    <div className="w-full max-w-md" data-interaction-id={interactionId}>
      <InteractionResponse
        allowFreeform={item.allowFreeform}
        answer={answer}
        approval={type === "approval"}
        itemError={item.error}
        // A refused or failed response gets a fresh, unlocked form.
        key={`${interactionId}:${item.pending ? "pending" : (item.error ?? state)}`}
        options={options}
        pending={item.pending === true}
        prompt={prompt}
        related={related}
      />
    </div>
  );
}

/**
 * What the user answered, in words: the chosen option's label, or their own
 * text. An option id that matches nothing is never shown.
 */
function givenAnswer(
  options: Options,
  allowFreeform: boolean,
  outcome?: string
): string | undefined {
  const chosen = options.find((option) => option.id === outcome);
  if (chosen) {
    return chosen.label;
  }
  return allowFreeform ? outcome : undefined;
}

function settledOutcome(
  repositorySetup: boolean,
  state: string,
  outcome?: string
): string | undefined {
  if (!repositorySetup) {
    return outcome;
  }
  if (state === "closed" || state === "withdrawn") {
    return "Repository setup cancelled.";
  }
  if (state === "failed") {
    return "Repository setup failed.";
  }
  return "Repository selected.";
}

function InteractionResponse({
  approval,
  prompt,
  related,
  options,
  allowFreeform,
  pending,
  itemError,
  answer,
}: {
  approval: boolean;
  prompt: string;
  related: ReactNode;
  options: Options;
  allowFreeform: boolean;
  pending: boolean;
  itemError?: string;
  answer: (value: Answer) => Promise<boolean>;
}) {
  const [sending, setSending] = useState(false);
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(itemError ?? null);
  const busy = sending || locked || pending;

  const submit = useCallback(
    async (value: Answer) => {
      const submitted = value.optionId ?? value.text ?? "";
      if (!submitted.trim() || sending || locked || pending) {
        return;
      }
      setSending(true);
      setError(null);
      let accepted = false;
      try {
        accepted = await answer(value);
        if (accepted) {
          setLocked(true);
        } else {
          setError("Couldn't send that answer. Try again.");
        }
      } catch {
        setError("Couldn't send that answer. Try again.");
      } finally {
        setSending(false);
      }
    },
    [answer, locked, pending, sending]
  );

  const feedback = (
    <>
      {busy ? (
        <p className="text-muted-foreground text-xs" role="status">
          Sending…
        </p>
      ) : null}
      {error ? (
        <p
          className="text-destructive flex items-center gap-1.5 text-xs"
          role="alert"
        >
          <CircleAlert aria-hidden="true" className="size-3.5" />
          {error}
        </p>
      ) : null}
    </>
  );

  // The Confirmation pattern: a prompt with its actions, not a form.
  if (!allowFreeform && (approval || options.length === 0)) {
    return (
      <div className="flex flex-col gap-2">
        <Item size="sm" variant="outline">
          {approval ? (
            <ItemMedia variant="icon">
              <ShieldCheck aria-hidden="true" className="text-signal" />
            </ItemMedia>
          ) : null}
          <ItemContent>
            <ItemTitle>{prompt}</ItemTitle>
            {related || options.length === 0 ? (
              <ItemDescription>
                {related ?? "Waiting for the bot to continue."}
              </ItemDescription>
            ) : null}
          </ItemContent>
          {options.length ? (
            <ApprovalActions
              disabled={busy}
              onSubmit={submit}
              options={options}
            />
          ) : null}
        </Item>
        {feedback}
      </div>
    );
  }

  return (
    <AnswerForm
      allowFreeform={allowFreeform}
      busy={busy}
      feedback={feedback}
      onSubmit={submit}
      options={options}
      prompt={prompt}
      related={related}
    />
  );
}

function ApprovalActions({
  options,
  disabled,
  onSubmit,
}: {
  options: Options;
  disabled: boolean;
  onSubmit: (value: { optionId: string }) => void;
}) {
  const handleClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      const { optionId } = event.currentTarget.dataset;
      if (optionId) {
        onSubmit({ optionId });
      }
    },
    [onSubmit]
  );
  return (
    <ItemActions>
      {options.map((option) => (
        <Button
          data-option-id={option.id}
          disabled={disabled}
          key={option.id}
          onClick={handleClick}
          size="sm"
          type="button"
          variant={approvalVariant(option.style)}
        >
          {option.label}
        </Button>
      ))}
    </ItemActions>
  );
}

function approvalVariant(style: Options[number]["style"]) {
  if (style === "danger") {
    return "destructive" as const;
  }
  return style === "secondary" ? ("outline" as const) : ("signal" as const);
}

const ANSWER = "answer";

function AnswerForm({
  prompt,
  related,
  options,
  allowFreeform,
  busy,
  feedback,
  onSubmit,
}: {
  prompt: string;
  related: ReactNode;
  options: Options;
  allowFreeform: boolean;
  busy: boolean;
  feedback: ReactNode;
  onSubmit: (value: Answer) => void;
}) {
  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const value = new FormData(event.currentTarget).get(ANSWER);
      if (typeof value !== "string") {
        return;
      }
      onSubmit(
        options.some((option) => option.id === value)
          ? { optionId: value }
          : { text: value }
      );
    },
    [onSubmit, options]
  );
  // Stable identity: Questionnaire re-registers its items when this changes.
  const items = useMemo(
    () => [
      {
        choices: options.map((option) => ({ value: option.id })),
        name: ANSWER,
        required: true,
      },
    ],
    [options]
  );
  return (
    <Questionnaire
      className="border-border gap-3 border p-3"
      items={items}
      onSubmit={handleSubmit}
      shortcuts="numbers"
    >
      <QuestionnaireItem
        className="gap-3"
        disabled={busy}
        name={ANSWER}
        required
      >
        <QuestionnaireTitle className="text-sm">{prompt}</QuestionnaireTitle>
        {related ? (
          <QuestionnaireDescription>{related}</QuestionnaireDescription>
        ) : null}
        <QuestionnaireChoices>
          {options.map((option) => (
            <QuestionnaireChoice key={option.id} value={option.id}>
              {option.label}
            </QuestionnaireChoice>
          ))}
          {allowFreeform ? (
            <QuestionnaireInput
              aria-label="Your answer"
              maxLength={2000}
              placeholder={
                options.length ? "Something else…" : "Write an answer…"
              }
            />
          ) : null}
        </QuestionnaireChoices>
      </QuestionnaireItem>
      <QuestionnaireActions>
        <div className="col-start-1 row-start-1 min-w-0">{feedback}</div>
        <QuestionnaireSubmit disabled={busy} size="sm">
          {busy ? (
            <Loader2 aria-hidden="true" className="animate-spin" />
          ) : null}
          Send answer
        </QuestionnaireSubmit>
      </QuestionnaireActions>
    </Questionnaire>
  );
}

function SettledCard({
  interactionId,
  approval,
  prompt,
  state,
  outcome,
  answer,
}: {
  interactionId: string;
  approval: boolean;
  prompt: string;
  state: string;
  outcome?: string;
  answer?: string;
}) {
  let icon = approval ? <ShieldCheck aria-hidden="true" /> : null;
  let text = outcome ?? "No longer needed.";
  if (state === "accepted") {
    icon = <Check aria-hidden="true" />;
    text = answer ?? "Answer sent.";
  } else if (state === "declined" || state === "rejected") {
    icon = <X aria-hidden="true" />;
    text = "Approval declined.";
  }
  return (
    <Item
      className="max-w-md"
      data-interaction-id={interactionId}
      size="sm"
      variant="muted"
    >
      {icon ? (
        <ItemMedia className="text-muted-foreground" variant="icon">
          {icon}
        </ItemMedia>
      ) : null}
      <ItemContent>
        <ItemDescription className="line-clamp-none">{prompt}</ItemDescription>
        <ItemTitle className="break-words whitespace-pre-wrap">
          {text}
        </ItemTitle>
      </ItemContent>
    </Item>
  );
}
