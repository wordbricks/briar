import {
  ArrowLeft,
  ChevronRight,
  CircleCheck,
  CircleX,
  RefreshCw,
} from "lucide-react";
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
import { AgentProviderIcon } from "./AgentIcons";
import {
  StatusPanel,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelTitle,
} from "./ui/status-panel";

const refreshIntervalMs = 5 * 60_000;
type UsageMode = "detailed" | "compact";

function ProviderIcon({
  provider,
}: {
  provider: AgentUsageProvider["provider"];
}) {
  return (
    <span className={`agent-usage-provider-icon ${provider}`}>
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
  return (
    <span className={`agent-usage-meter ${compact ? "compact" : ""}`}>
      {!compact ? <small>{formatUsageWindowLabel(window)}</small> : null}
      <i>
        <b
          className={usageTone(percentage)}
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </i>
      <strong className={usageTone(percentage)}>{percentage}%</strong>
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
      className="agent-usage-provider-row"
      onClick={onOpen}
      title={provider.error ?? undefined}
      type="button"
    >
      <div className="agent-usage-provider-heading">
        <ProviderIcon provider={provider.provider} />
        <strong>
          {name}
          {provider.planType ? <small> · {provider.planType}</small> : null}
        </strong>
        <ProviderReset provider={provider} />
        <ChevronRight aria-hidden size={13} />
      </div>
      {shown.length > 0 ? (
        <div className="agent-usage-provider-meters">
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
    <div className="agent-usage-provider-details">
      <header>
        <button aria-label={t("usage.back")} onClick={onBack} type="button">
          <ArrowLeft aria-hidden size={14} />
        </button>
        <ProviderIcon provider={provider.provider} />
        <div>
          <strong>{providerName(provider.provider)}</strong>
          <small>
            {provider.accountLabel ??
              provider.planType ??
              t("usage.systemAccount")}
          </small>
        </div>
        {provider.status === "ok" ? (
          <CircleCheck aria-label={t("usage.connected")} size={16} />
        ) : (
          <CircleX aria-label={t("usage.needsAttention")} size={16} />
        )}
      </header>
      <div className="agent-usage-provider-detail-body">
        <StatusPanel
          className="agent-usage-health"
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
              <StatusPanelDescription className="agent-usage-health-error">
                {provider.error}
              </StatusPanelDescription>
            ) : null}
          </StatusPanelContent>
        </StatusPanel>
        {windows.length > 0 ? (
          <div className="agent-usage-detail-windows">
            {windows.map((window) => (
              <div key={window.windowMinutes}>
                <UsageMeter window={window} />
                <small>
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
          <p className="agent-usage-detail-empty">
            {t("usage.noProviderUsage")}
          </p>
        )}
      </div>
      <footer>
        <button onClick={onManageAccount} type="button">
          {t("usage.manageProviderAccount", {
            provider: providerName(provider.provider),
          })}
          <ChevronRight aria-hidden size={14} />
        </button>
      </footer>
    </div>
  );
}

function StatusProvider({
  loading,
  provider,
}: {
  loading: boolean;
  provider: AgentUsageProvider;
}) {
  const { t } = useI18n();
  const window = tightestUsageWindow(provider);
  const name = providerName(provider.provider);
  if (loading && !window) {
    return (
      <span className="agent-usage-status-provider">
        <ProviderIcon provider={provider.provider} />
        <small>{t("usage.refreshing")}</small>
      </span>
    );
  }
  if (!window) {
    return (
      <span className="agent-usage-status-provider">
        <ProviderIcon provider={provider.provider} />
        <small>
          {name} ·{" "}
          {provider.status === "unavailable"
            ? t("usage.signIn")
            : t("usage.unavailable")}
        </small>
      </span>
    );
  }
  return (
    <span className="agent-usage-status-provider">
      <ProviderIcon provider={provider.provider} />
      <UsageMeter compact window={window} />
      {window.resetsAt && window.resetsAt > Date.now() ? (
        <small>
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
  onManageAccounts,
  onOpenUsageDetails,
}: {
  loadUsage?: () => Promise<AgentUsageSnapshot>;
  onManageAccounts: () => void;
  onOpenUsageDetails: () => void;
}) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const requestRef = useRef<Promise<void> | null>(null);
  const [snapshot, setSnapshot] = useState<AgentUsageSnapshot | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mode, setMode] = useState<UsageMode>("detailed");
  const [selectedProvider, setSelectedProvider] =
    useState<AgentUsageProvider["provider"] | null>(null);

  const refresh = useCallback(() => {
    if (requestRef.current) return requestRef.current;
    setIsRefreshing(true);
    const request = loadUsage()
      .then((next) => {
        setSnapshot(next);
        recordAgentUsageSnapshot(next);
      })
      .catch(() => undefined)
      .finally(() => {
        setIsRefreshing(false);
        requestRef.current = null;
      });
    requestRef.current = request;
    return request;
  }, [loadUsage]);

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
      quotaUsageProviders.map(
        (provider) => snapshot?.[provider] ?? emptyUsageProvider(provider),
      ),
    [snapshot],
  );

  return (
    <div className="agent-usage-status-bar" ref={rootRef}>
      {isOpen ? (
        <div
          aria-label={t("usage.title")}
          className="agent-usage-popover"
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
              <header className="agent-usage-popover-header">
                <strong>{t("usage.title")}</strong>
                <span>{t("usage.allAgents")}</span>
                <button
                  aria-label={t("usage.refresh")}
                  onClick={() => void refresh()}
                  type="button"
                >
                  <RefreshCw
                    aria-hidden
                    className={isRefreshing ? "spin" : ""}
                    size={13}
                  />
                </button>
              </header>
              <div
                aria-label={t("usage.density")}
                className="agent-usage-mode"
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
              <div className="agent-usage-provider-list">
                {providers.map((provider) => (
                  <ProviderRow
                    key={provider.provider}
                    mode={mode}
                    onOpen={() => setSelectedProvider(provider.provider)}
                    provider={provider}
                  />
                ))}
              </div>
              <footer className="agent-usage-popover-footer">
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
        className="agent-usage-status-trigger"
        onClick={() => {
          setSelectedProvider(null);
          setIsOpen((open) => !open);
        }}
        type="button"
      >
        {providers.map((provider) => (
          <StatusProvider
            key={provider.provider}
            loading={isRefreshing}
            provider={provider}
          />
        ))}
        <RefreshCw
          aria-hidden
          className={isRefreshing ? "spin" : ""}
          size={10}
        />
      </button>
    </div>
  );
}
