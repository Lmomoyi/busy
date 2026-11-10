"use client";

import { Gauge, Sparkles } from "lucide-react";
import Image from "next/image";
import { useAccount } from "@/components/account-provider";
import { useAiConnectionOptional } from "@/components/ai-connection-provider";
import type { AiProviderId, AiProviderOption } from "@/lib/ai/types";

// Loaded with the sidebar. The settings cards stay in account-ai-connection.tsx
// so they arrive with the settings dialog instead of the page.

export const GROK_LOGO = "/ai-providers/grok.png";

let usageFormat: Intl.NumberFormat | undefined;

function formatUsage(value: number) {
  usageFormat ??= new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  });
  return usageFormat.format(value);
}

export type ConnectionState =
  | { kind: "legacy" }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "choose" }
  | {
      kind: "provider";
      model: string | null;
      option: AiProviderOption;
      provider: AiProviderId;
    };

/** Content for the account menu item. The parent owns the Menu.Item wrapper. */
export function AccountAiMenuContent() {
  const connection = useAiConnectionOptional();
  const account = useAccount();
  const state = connectionState(connection);

  if (state.kind === "legacy") {
    return (
      <>
        <Gauge aria-hidden="true" />
        <span className="flex-1">Token Pass usage</span>
        <span className="text-muted-foreground text-xs">
          <TokenPassUsageLabel account={account} compact />
        </span>
      </>
    );
  }

  if (state.kind === "loading") {
    return <MenuConnectionContent label="AI connection" status="Checking…" />;
  }
  if (state.kind === "error") {
    return <MenuConnectionContent label="AI connection" status="Unavailable" />;
  }
  if (state.kind === "choose") {
    return <MenuConnectionContent label="AI connection" status="Choose" />;
  }

  if (
    state.kind === "provider" &&
    state.provider === "token-pass" &&
    state.option.status === "available"
  ) {
    return (
      <>
        <Gauge aria-hidden="true" />
        <span className="flex-1">Token Pass usage</span>
        <span className="text-muted-foreground text-xs">
          <TokenPassUsageLabel account={account} compact />
        </span>
      </>
    );
  }

  const label = menuProviderLabel(
    state.provider,
    state.option.status === "available"
  );
  const status = providerStatus(state.option);
  return (
    <>
      <ProviderLogo provider={state.provider} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="text-muted-foreground text-xs">{status}</span>
    </>
  );
}

export function connectionState(
  connection: ReturnType<typeof useAiConnectionOptional>
): ConnectionState {
  if (!connection) {
    return { kind: "legacy" };
  }
  if (connection.loading && !connection.snapshot) {
    return { kind: "loading" };
  }
  if (connection.error && !connection.snapshot) {
    return { kind: "error" };
  }
  if (!connection.snapshot) {
    return { kind: "loading" };
  }
  if (!connection.snapshot.provider) {
    return { kind: "choose" };
  }
  const { model, provider, providers } = connection.snapshot;
  const option = providers.find((item) => item.id === provider);
  if (!option) {
    return { kind: "error" };
  }
  return {
    kind: "provider",
    model: model ?? null,
    option,
    provider,
  };
}

export function providerLabel(provider: AiProviderId) {
  if (provider === "chatgpt") {
    return "ChatGPT subscription";
  }
  if (provider === "grok") {
    return "Grok subscription";
  }
  if (provider === "gateway") {
    return "AI Gateway";
  }
  return "Token Pass";
}

function menuProviderLabel(provider: AiProviderId, active: boolean) {
  if (provider === "chatgpt") {
    return active ? "Using ChatGPT" : "ChatGPT";
  }
  if (provider === "grok") {
    return active ? "Using Grok" : "Grok";
  }
  return providerLabel(provider);
}

export function providerStatus(option: AiProviderOption) {
  return option.status === "available" ? "Active" : "Reconnect";
}

function MenuConnectionContent({
  label,
  status,
}: {
  label: string;
  status: string;
}) {
  return (
    <>
      <Sparkles aria-hidden="true" />
      <span className="flex-1">{label}</span>
      <span className="text-muted-foreground text-xs">{status}</span>
    </>
  );
}

export function ProviderLogo({ provider }: { provider: AiProviderId }) {
  if (provider === "grok") {
    return (
      <Image
        alt=""
        className="size-5 shrink-0"
        height={20}
        loading="eager"
        src={GROK_LOGO}
        unoptimized
        width={20}
      />
    );
  }
  const name = provider === "chatgpt" ? "chatgpt" : "vercel-mark";
  return (
    <span
      aria-hidden="true"
      className="grid size-5 shrink-0 place-items-center"
    >
      <Image
        alt=""
        className="dark:hidden"
        height={20}
        src={`/ai-providers/${name}-black.svg`}
        width={20}
      />
      <Image
        alt=""
        className="hidden dark:block"
        height={20}
        src={`/ai-providers/${name}-white.svg`}
        width={20}
      />
    </span>
  );
}

export function TokenPassUsageLabel({
  account,
  compact = false,
}: {
  account: ReturnType<typeof useAccount>;
  compact?: boolean;
}) {
  const percent = account.error ? null : account.data?.tokenPass.percentUsed;
  if (account.loading) {
    return <span className="text-muted-foreground">Checking…</span>;
  }
  if (percent === null || percent === undefined) {
    return (
      <span className="text-muted-foreground">
        {compact ? "—" : "Unavailable"}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {formatUsage(percent)}%{compact ? "" : " used"}
    </span>
  );
}
