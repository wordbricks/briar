import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  RefreshCw,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  emptyUsageProvider,
  formatUsageDuration,
  formatUsageWindowLabel,
  loadAgentUsage,
  quotaUsageProviderLabel,
  quotaUsageProviders,
  recordAgentUsageSnapshot,
  tightestUsageWindow,
  type AgentUsageProvider,
  type AgentUsageSnapshot,
  type AgentUsageWindow,
} from "../lib/agent-usage";
import {
  defaultAppProviderSettings,
  loadAppProviderSettings,
  type AppProviderSettings,
} from "../lib/project-llm";
import { AgentProviderIcon } from "./AgentIcons";
import {
  StatusPanel,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelTitle,
} from "./ui/status-panel";
import { cn } from "../lib/utils";

const refreshIntervalMs = 5 * 60_000;
type UsageMode = "detailed" | "compact";

function ProviderIcon({
  provider,
}: {
  provider: AgentUsageProvider["provider"];
}) {
  return (
    <span
      className={cn(
        "grid size-[18px] shrink-0 place-items-center rounded-md border border-border bg-card [&_img]:block [&_svg]:block",
        provider === "claude" && "text-[#ca6d43]",
        provider === "codex" && "text-foreground",
        provider === "cursor" && "text-[#23231f] dark:text-foreground",
        provider === "grok" && "text-[#17181b] dark:text-foreground",
        provider === "agy" && "text-[#4285f4]",
        provider === "opencode" && "text-[#4f8a70]",
      )}
    >
      <AgentProviderIcon provider={provider} size={12} />
    </span>
  );
}

function providerName(provider: AgentUsageProvider["provider"]) {
  return quotaUsageProviderLabel(provider);
}

function usageTone(usedPercent: number) {
  if (usedPercent >= 90) return "critical";
  if (usedPercent >= 75) return "warning";
  return "normal";
}

function UsageMeter({
  compact = false,
  window,
}: {
  compact?: boolean;
  window: AgentUsageWindow;
}) {
  const percentage = Math.round(window.usedPercent);
  const tone = usageTone(percentage);
  return (
    <span className={cn("flex items-center gap-1.5", compact && "gap-1.25")}>
      {!compact ? (
        <small className="w-4 font-mono text-micro font-medium text-muted-foreground">
          {formatUsageWindowLabel(window)}
        </small>
      ) : null}
      <i
        className={cn(
          "h-1.25 w-9 overflow-hidden rounded-full bg-secondary",
          compact && "w-[42px]",
        )}
      >
        <b
          className={cn(
            "block h-full rounded-[inherit] bg-accent-foreground",
            tone === "warning" && "bg-warning",
            tone === "critical" && "bg-destructive",
          )}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </i>
      <strong
        className={cn(
          "min-w-[25px] font-mono text-micro font-semibold text-muted-foreground",
          tone === "warning" && "text-[var(--status-warning-foreground)]",
          tone === "critical" && "text-[var(--status-destructive-foreground)]",
        )}
      >
        {percentage}%
      </strong>
    </span>
  );
}

function ProviderReset({ provider }: { provider: AgentUsageProvider }) {
  const { t } = useI18n();
  const reset = [provider.session, provider.weekly, provider.monthly]
    .map((window) => window?.resetsAt ?? null)
    .filter((value): value is number => value !== null && value > Date.now())
    .sort((left, right) => left - right)[0];
  if (reset) {
    return (
      <small>
        {t("usage.resetsIn", {
          duration: formatUsageDuration(reset - Date.now()),
        })}
      </small>
    );
  }
  if (provider.status === "unavailable") {
    return <small>{t("usage.signInRequired")}</small>;
  }
  if (provider.status === "error") {
    return <small>{t("usage.refreshFailed")}</small>;
  }
  return null;
}

function ProviderRow({
  mode,
  onOpen,
  provider,
}: {
  mode: UsageMode;
  onOpen: () => void;
  provider: AgentUsageProvider;
}) {
  const windows = [provider.session, provider.weekly, provider.monthly].filter(
    (window): window is AgentUsageWindow => window !== null,
  );
  const shown =
    mode === "compact"
      ? [tightestUsageWindow(provider)].filter(
          (window): window is AgentUsageWindow => window !== null,
        )
      : windows;
  const name = providerName(provider.provider);
  return (
    <button
      className="block min-h-[66px] w-full cursor-pointer border-0 border-b border-border bg-popover px-3.5 py-2.5 text-left text-inherit hover:bg-muted focus-visible:relative focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
      onClick={onOpen}
      title={provider.error ?? undefined}
      type="button"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ProviderIcon provider={provider.provider} />
        <strong className="min-w-0 truncate text-xs font-semibold text-foreground [&>small]:text-micro [&>small]:font-medium [&>small]:text-muted-foreground">
          {name}
          {provider.planType ? <small> · {provider.planType}</small> : null}
        </strong>
        <span className="ml-0.5 text-micro text-muted-foreground">
          <ProviderReset provider={provider} />
        </span>
        <ChevronRight
          aria-hidden
          className="ml-auto text-muted-foreground"
          size={13}
        />
      </div>
      {shown.length > 0 ? (
        <div className="mt-1.5 ml-[27px] flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
          {shown.map((window) => (
            <UsageMeter key={window.windowMinutes} window={window} />
          ))}
        </div>
      ) : null}
    </button>
  );
}

function ProviderDetails({
  onBack,
  onManageAccount,
  provider,
}: {
  onBack: () => void;
  onManageAccount: () => void;
  provider: AgentUsageProvider;
}) {
  const { localeTag, t } = useI18n();
  const windows = [provider.session, provider.weekly, provider.monthly].filter(
    (window): window is AgentUsageWindow => window !== null,
  );
  return (
    <div>
      <header className="flex min-h-[50px] items-center gap-2 border-b border-border px-2.5 py-2">
        <button
          aria-label={t("usage.back")}
          className="grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-secondary hover:text-foreground"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden size={14} />
        </button>
        <ProviderIcon provider={provider.provider} />
        <div className="flex min-w-0 flex-1 flex-col">
          <strong className="text-xs">{providerName(provider.provider)}</strong>
          <small className="truncate text-micro text-muted-foreground">
            {provider.accountLabel ??
              provider.planType ??
              t("usage.systemAccount")}
          </small>
        </div>
        {provider.status === "ok" ? (
          <CircleCheck
            aria-label={t("usage.connected")}
            className="text-[var(--status-success-foreground)]"
            size={16}
          />
        ) : (
          <CircleX aria-label={t("usage.needsAttention")} size={16} />
        )}
      </header>
      <div className="flex min-h-[180px] flex-col gap-3 p-3.5">
        <StatusPanel
          className="[&_[data-slot=status-panel-description]]:text-micro [&_[data-slot=status-panel-title]]:text-micro"
          density="compact"
          role={provider.status === "ok" ? "status" : "alert"}
          tone={provider.status === "ok" ? "success" : "destructive"}
        >
          <StatusPanelContent>
            <StatusPanelTitle>
              {provider.status === "ok"
                ? t("usage.connected")
                : provider.status === "unavailable"
                  ? t("usage.signInRequired")
                  : t("usage.refreshFailed")}
            </StatusPanelTitle>
            <StatusPanelDescription>
              {t("usage.lastChecked", {
                time: new Intl.DateTimeFormat(localeTag, {
                  hour: "numeric",
                  minute: "2-digit",
                }).format(provider.updatedAt),
              })}
            </StatusPanelDescription>
            {provider.error ? (
              <StatusPanelDescription className="mt-1.5">
                {provider.error}
              </StatusPanelDescription>
            ) : null}
          </StatusPanelContent>
        </StatusPanel>
        {windows.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {windows.map((window) => (
              <div
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-1 [&>span]:col-span-full"
                key={window.windowMinutes}
              >
                <UsageMeter window={window} />
                <small className="col-span-full ml-[35px] text-micro text-muted-foreground">
                  {window.resetsAt && window.resetsAt > Date.now()
                    ? t("usage.resetsIn", {
                        duration: formatUsageDuration(
                          window.resetsAt - Date.now(),
                        ),
                      })
                    : t("usage.resetUnknown")}
                </small>
              </div>
            ))}
          </div>
        ) : (
          <p className="m-auto text-micro text-muted-foreground">
            {t("usage.noProviderUsage")}
          </p>
        )}
      </div>
      <footer className="border-t border-border">
        <button
          className="flex min-h-[38px] w-full cursor-pointer items-center justify-between border-0 bg-transparent px-3.5 py-0 text-micro text-foreground hover:bg-secondary"
          onClick={onManageAccount}
          type="button"
        >
          {t("usage.manageProviderAccount", {
            provider: providerName(provider.provider),
          })}
          <ChevronRight aria-hidden size={14} />
        </button>
      </footer>
    </div>
  );
}

function StatusProvider({ provider }: { provider: AgentUsageProvider }) {
  const { t } = useI18n();
  const window = tightestUsageWindow(provider);
  const name = providerName(provider.provider);
  if (!window) {
    return (
      <span
        aria-label={name}
        className="flex min-w-0 items-center gap-1.5"
        data-slot="usage-status-provider"
        role="img"
        title={name}
      >
        <ProviderIcon provider={provider.provider} />
      </span>
    );
  }
  return (
    <span
      className="flex min-w-0 items-center gap-1.5"
      data-slot="usage-status-provider"
    >
      <ProviderIcon provider={provider.provider} />
      <UsageMeter compact window={window} />
      {window.resetsAt && window.resetsAt > Date.now() ? (
        <small className="truncate text-micro text-muted-foreground">
          {t("usage.usedReset", {
            duration: formatUsageDuration(window.resetsAt - Date.now()),
          })}
        </small>
      ) : null}
    </span>
  );
}

export function AgentUsageStatusBar({
  loadUsage = loadAgentUsage,
  loadProviderSettings = loadAppProviderSettings,
  onManageAccounts,
  onOpenUsageDetails,
}: {
  loadUsage?: () => Promise<AgentUsageSnapshot>;
  loadProviderSettings?: () => Promise<AppProviderSettings>;
  onManageAccounts: () => void;
  onOpenUsageDetails: () => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<Promise<void> | null>(null);
  const [snapshot, setSnapshot] = useState<AgentUsageSnapshot | null>(null);
  const [providerSettings, setProviderSettings] = useState<AppProviderSettings>(
    defaultAppProviderSettings,
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mode, setMode] = useState<UsageMode>("detailed");
  const [selectedProvider, setSelectedProvider] = useState<
    AgentUsageProvider["provider"] | null
  >(null);

  const refresh = useCallback(() => {
    if (requestRef.current) return requestRef.current;
    setIsRefreshing(true);
    const request = Promise.allSettled([loadUsage(), loadProviderSettings()])
      .then(([usageResult, settingsResult]) => {
        if (usageResult.status === "fulfilled") {
          setSnapshot(usageResult.value);
          recordAgentUsageSnapshot(usageResult.value);
        }
        if (settingsResult.status === "fulfilled") {
          setProviderSettings(settingsResult.value);
        }
      })
      .finally(() => {
        setIsRefreshing(false);
        requestRef.current = null;
      });
    requestRef.current = request;
    return request;
  }, [loadProviderSettings, loadUsage]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(
      () => void refresh(),
      refreshIntervalMs,
    );
    return () => window.clearInterval(interval);
  }, [refresh]);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  const providers = useMemo(
    () =>
      quotaUsageProviders
        .filter((provider) => providerSettings[provider])
        .map(
          (provider) => snapshot?.[provider] ?? emptyUsageProvider(provider),
        ),
    [providerSettings, snapshot],
  );

  return (
    <div className="relative h-full min-w-0 flex-1" ref={rootRef}>
      {isOpen ? (
        <div
          aria-label={t("usage.title")}
          className="absolute bottom-[calc(100%+7px)] left-2 z-60 w-[360px] origin-bottom-left animate-in overflow-hidden rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl duration-150 fade-in slide-in-from-bottom-1 zoom-in-95 motion-reduce:animate-none"
          role="dialog"
        >
          {selectedProvider ? (
            <ProviderDetails
              onBack={() => setSelectedProvider(null)}
              onManageAccount={() => {
                setIsOpen(false);
                onManageAccounts();
              }}
              provider={
                providers.find(
                  (provider) => provider.provider === selectedProvider,
                ) ?? emptyUsageProvider(selectedProvider)
              }
            />
          ) : (
            <>
              <header className="flex h-10 items-center gap-2 px-3.5 py-0">
                <strong className="mr-auto text-sm font-bold">
                  {t("usage.title")}
                </strong>
                <span className="text-micro text-muted-foreground">
                  {t("usage.allAgents")}
                </span>
                <button
                  aria-label={t("usage.refresh")}
                  className="grid size-6 cursor-pointer place-items-center rounded-md border-0 bg-transparent p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  onClick={() => void refresh()}
                  type="button"
                >
                  <Spinner
                    aria-hidden
                    icon={RefreshCw}
                    spinning={isRefreshing}
                    size={13}
                  />
                </button>
              </header>
              <div
                aria-label={t("usage.density")}
                className="mx-3.5 mt-0 mb-2.5 grid h-[31px] grid-cols-2 rounded-lg border border-border bg-muted p-0.5 [&>button]:cursor-pointer [&>button]:rounded-md [&>button]:border-0 [&>button]:bg-transparent [&>button]:text-micro [&>button]:text-muted-foreground [&>button[aria-pressed=true]]:bg-card [&>button[aria-pressed=true]]:text-foreground [&>button[aria-pressed=true]]:shadow-sm"
                role="group"
              >
                <button
                  aria-pressed={mode === "detailed"}
                  onClick={() => setMode("detailed")}
                  type="button"
                >
                  {t("usage.detailed")}
                </button>
                <button
                  aria-pressed={mode === "compact"}
                  onClick={() => setMode("compact")}
                  type="button"
                >
                  {t("usage.compact")}
                </button>
              </div>
              <div className="scrollbar-subtle max-h-[min(420px,calc(100vh-220px))] overflow-auto border-t border-border">
                {providers.map((provider) => (
                  <ProviderRow
                    key={provider.provider}
                    mode={mode}
                    onOpen={() => setSelectedProvider(provider.provider)}
                    provider={provider}
                  />
                ))}
              </div>
              <footer className="grid [&>button]:flex [&>button]:h-[38px] [&>button]:cursor-pointer [&>button]:items-center [&>button]:justify-between [&>button]:border-0 [&>button]:border-b [&>button]:border-border [&>button]:bg-popover [&>button]:px-3.5 [&>button]:py-0 [&>button]:text-left [&>button]:text-xs [&>button]:text-popover-foreground [&>button]:last:border-b-0 [&>button]:hover:bg-accent [&>button]:hover:text-accent-foreground [&_svg]:text-muted-foreground">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onOpenUsageDetails();
                  }}
                  type="button"
                >
                  {t("usage.detailsHistory")}
                  <ChevronRight aria-hidden size={14} />
                </button>
                <button
                  onClick={() => {
                    setIsOpen(false);
                    onManageAccounts();
                  }}
                  type="button"
                >
                  {t("usage.manageAccounts")}
                  <ChevronRight aria-hidden size={14} />
                </button>
              </footer>
            </>
          )}
        </div>
      ) : null}
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        className="agent-usage-status-trigger flex h-full w-full cursor-pointer items-center gap-3 overflow-hidden border-0 bg-transparent px-3 py-0 text-left text-muted-foreground whitespace-nowrap hover:bg-secondary focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring [&>svg:last-child]:shrink-0 [&>svg:last-child]:text-muted-foreground [&_[data-slot=usage-status-provider]+[data-slot=usage-status-provider]]:border-l [&_[data-slot=usage-status-provider]+[data-slot=usage-status-provider]]:border-border [&_[data-slot=usage-status-provider]+[data-slot=usage-status-provider]]:pl-3"
        onClick={() => {
          setSelectedProvider(null);
          setIsOpen((open) => !open);
        }}
        type="button"
      >
        {providers.map((provider) => (
          <StatusProvider key={provider.provider} provider={provider} />
        ))}
        <Spinner
          aria-hidden
          icon={RefreshCw}
          spinning={isRefreshing}
          size={10}
        />
      </button>
    </div>
  );
}
