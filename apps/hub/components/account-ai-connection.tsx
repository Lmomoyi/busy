"use client";

import { ExternalLink, Sparkles } from "lucide-react";
import { useCallback } from "react";
import {
  type ConnectionState,
  connectionState,
  ProviderLogo,
  providerLabel,
  providerStatus,
  TokenPassUsageLabel,
} from "@/components/account-ai-menu";
import { useAccount } from "@/components/account-provider";
import { useAiConnectionOptional } from "@/components/ai-connection-provider";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
const AI_GATEWAY_DOCS_URL = "https://vercel.com/docs/ai-gateway";
let creditFormat: Intl.NumberFormat | undefined;

function formatCredit(value: number) {
  creditFormat ??= new Intl.NumberFormat(undefined, {
    currency: "USD",
    style: "currency",
  });
  return creditFormat.format(value);
}

/** Settings card that follows the saved AI connection, not an unsaved draft. */
export function AccountAiConnectionCard({
  variant = "card",
}: {
  variant?: "card" | "plain";
} = {}) {
  const connection = useAiConnectionOptional();
  const account = useAccount();
  const state = connectionState(connection);

  if (
    state.kind === "legacy" ||
    (state.kind === "provider" &&
      state.provider === "token-pass" &&
      state.option.status === "available")
  ) {
    return (
      <TokenPassUsageCard
        account={account}
        connection={connection}
        variant={variant}
      />
    );
  }

  return (
    <section
      aria-labelledby="account-ai-connection-heading"
      className={
        variant === "card" ? "border-border rounded-xl border p-4" : undefined
      }
    >
      <div className="flex items-start gap-3">
        {state.kind === "provider" ? (
          <ProviderLogo provider={state.provider} />
        ) : (
          <span
            aria-hidden="true"
            className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center"
          >
            <Sparkles className="size-4" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <h3
              className="text-sm font-medium"
              id="account-ai-connection-heading"
            >
              {cardTitle(state)}
            </h3>
            <span className="text-muted-foreground shrink-0 text-xs">
              {cardStatus(state)}
            </span>
          </div>
          <ConnectionCardBody connection={connection} state={state} />
        </div>
      </div>
    </section>
  );
}

function ConnectionCardBody({
  connection,
  state,
}: {
  connection: ReturnType<typeof useAiConnectionOptional>;
  state: Exclude<ConnectionState, { kind: "legacy" }>;
}) {
  const retry = useCallback(() => {
    connection?.refresh().catch(() => undefined);
  }, [connection]);
  if (state.kind === "loading") {
    return (
      <p className="text-muted-foreground mt-3 text-xs">
        Checking AI connection…
      </p>
    );
  }
  if (state.kind === "error") {
    return (
      <div className="mt-3">
        <p className="text-muted-foreground text-xs">
          AI connection is unavailable. Retry to load its current status.
        </p>
        {connection ? (
          <Button
            className="mt-3 h-8 px-3"
            onClick={retry}
            size="sm"
            variant="outline"
          >
            Try again
          </Button>
        ) : null}
      </div>
    );
  }
  if (state.kind === "choose") {
    return (
      <p className="text-muted-foreground mt-3 text-xs">
        Choose an AI connection in Settings.
      </p>
    );
  }
  if (state.provider === "token-pass" && state.option.status !== "available") {
    return (
      <p className="text-destructive mt-3 text-xs" role="alert">
        Token Pass is not configured for this Busy account. Choose AI Gateway or
        ask the account owner to configure Token Pass.
      </p>
    );
  }
  if (state.provider === "token-pass") {
    return (
      <>
        <ConnectionIssueStatus connection={connection} retry={retry} />
        <p className="text-muted-foreground mt-3 text-xs">
          Use your Vercel team&apos;s Token Pass allowance.
        </p>
      </>
    );
  }
  if (state.provider === "gateway") {
    return (
      <>
        <ConnectionIssueStatus connection={connection} retry={retry} />
        <p className="text-muted-foreground mt-3 text-xs">
          Use Vercel AI Gateway for model calls. Usage is billed by model and
          provider.
        </p>
        <a
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium underline-offset-4 hover:underline"
          href={AI_GATEWAY_DOCS_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          View AI Gateway billing docs{" "}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      </>
    );
  }

  if (state.option.status !== "available") {
    return (
      <p className="text-muted-foreground mt-3 text-xs">
        Reconnect your {state.provider === "chatgpt" ? "ChatGPT" : "Grok"}{" "}
        subscription to use it in Busy. Existing bot settings stay unchanged,
        but bots using this connection cannot run until you reconnect it.
      </p>
    );
  }

  const modelAvailable = state.option.models?.some(
    (model) => model.id === state.model
  );

  return (
    <>
      {connection?.error || connection?.connectionError ? (
        <ConnectionIssueStatus connection={connection} retry={retry} />
      ) : null}
      <p className="text-muted-foreground mt-3 text-xs">
        Using your {state.provider === "chatgpt" ? "ChatGPT" : "Grok"}{" "}
        subscription.
      </p>
      {state.model ? (
        <p className="mt-2 text-xs">
          Model:{" "}
          {state.option.models?.find((model) => model.id === state.model)
            ?.label ?? state.model}
          {modelAvailable ? null : (
            <span className="text-destructive ml-1">
              (no longer available; choose another in Settings)
            </span>
          )}
        </p>
      ) : null}
      {state.provider === "chatgpt" ? (
        <a
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium underline-offset-4 hover:underline"
          href={CHATGPT_USAGE_URL}
          rel="noopener noreferrer"
          target="_blank"
        >
          Manage usage <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : (
        <a
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium underline-offset-4 hover:underline"
          href="https://grok.com/dashboard"
          rel="noopener noreferrer"
          target="_blank"
        >
          View usage in Grok{" "}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      )}
    </>
  );
}

function ConnectionIssueStatus({
  connection,
  retry,
}: {
  connection: ReturnType<typeof useAiConnectionOptional>;
  retry: () => void;
}) {
  if (!(connection?.error || connection?.connectionError)) {
    return null;
  }
  return (
    <div
      className="border-destructive/30 bg-destructive/5 mt-3 rounded-lg border p-3"
      role="alert"
    >
      <p className="text-destructive text-xs">
        {connection.error ?? connection.connectionError}
      </p>
      <Button
        className="mt-3 h-8 px-3"
        onClick={retry}
        size="sm"
        variant="outline"
      >
        Refresh status
      </Button>
    </div>
  );
}

function cardTitle(state: Exclude<ConnectionState, { kind: "legacy" }>) {
  return state.kind === "provider"
    ? providerLabel(state.provider)
    : "AI connection";
}

function cardStatus(state: Exclude<ConnectionState, { kind: "legacy" }>) {
  if (state.kind === "loading") {
    return "Checking…";
  }
  if (state.kind === "error") {
    return "Unavailable";
  }
  if (state.kind === "choose") {
    return "Choose";
  }
  return providerStatus(state.option);
}

function TokenPassUsageCard({
  account,
  connection,
  variant,
}: {
  account: ReturnType<typeof useAccount>;
  connection: ReturnType<typeof useAiConnectionOptional>;
  variant: "card" | "plain";
}) {
  const retry = useCallback(() => {
    connection?.refresh().catch(() => undefined);
  }, [connection]);
  const percent = account.error ? null : account.data?.tokenPass.percentUsed;
  const value =
    percent === null || percent === undefined
      ? undefined
      : Math.min(100, Math.max(0, percent));
  const valueText = usageValueText(account, percent);
  const description = tokenPassDescription(account);
  return (
    <section
      aria-labelledby="subscription-heading"
      className={
        variant === "card" ? "border-border rounded-xl border p-4" : undefined
      }
    >
      <ConnectionIssueStatus connection={connection} retry={retry} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-medium" id="subscription-heading">
          Token Pass
        </h3>
        <span className="text-sm">
          <TokenPassUsageLabel account={account} />
        </span>
      </div>
      <span
        aria-label="Token Pass subscription usage"
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={value}
        aria-valuetext={valueText}
        className="bg-foreground/10 block h-1 w-full overflow-hidden"
        role="progressbar"
      >
        <span
          className={cn(
            "bg-foreground/70 block h-full transition-[width]",
            percent !== null &&
              percent !== undefined &&
              percent >= 90 &&
              "bg-amber-400"
          )}
          style={{ width: `${value ?? 0}%` }}
        />
      </span>
      <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
        {description}
      </p>
      {!account.error &&
      account.data?.tokenPass.usedUsd !== null &&
      account.data?.tokenPass.usedUsd !== undefined &&
      account.data?.tokenPass.limitUsd !== null &&
      account.data?.tokenPass.limitUsd !== undefined ? (
        <p className="text-muted-foreground mt-1 text-xs tabular-nums">
          {formatCredit(account.data.tokenPass.usedUsd)} of{" "}
          {formatCredit(account.data.tokenPass.limitUsd)} in credits used
        </p>
      ) : null}
      {account.data?.tokenPass.resetsAt ? (
        <p className="text-muted-foreground mt-1 text-xs">
          Resets{" "}
          {new Date(account.data.tokenPass.resetsAt).toLocaleDateString(
            undefined,
            { day: "numeric", month: "short" }
          )}
        </p>
      ) : null}
      {account.data?.tokenPass.dashboardUrl ? (
        <a
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium underline-offset-4 hover:underline"
          href={account.data.tokenPass.dashboardUrl}
          rel="noopener noreferrer"
          target="_blank"
        >
          Manage subscription{" "}
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      ) : null}
    </section>
  );
}

function tokenPassDescription(account: ReturnType<typeof useAccount>) {
  if (account.loading) {
    return "Checking your subscription usage…";
  }
  if (account.error) {
    return "Couldn't refresh usage. Busy will try again automatically.";
  }
  if (
    account.data?.tokenPass.percentUsed === null ||
    account.data?.tokenPass.percentUsed === undefined
  ) {
    return "Usage is currently unavailable. Check your subscription in Vercel.";
  }
  return "Current billing period, shared across your Vercel team.";
}

function usageValueText(
  { loading }: ReturnType<typeof useAccount>,
  percent: number | null | undefined
) {
  if (percent !== null && percent !== undefined) {
    return `${percent}% used`;
  }
  return loading ? "Loading usage" : "Usage unavailable";
}
