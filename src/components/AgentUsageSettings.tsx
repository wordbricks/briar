import { Activity, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  SettingsAlert,
  SettingsCard,
  SettingsGroupHeading,
  SettingsIconButton,
  SettingsNote,
  SettingsSection,
} from "@/components/settings";
import { useI18n } from "../i18n";
import {
  clearAgentUsageHistory,
  formatUsageDuration,
  formatUsageWindowLabel,
  loadAgentUsage,
  readAgentUsageHistory,
  recordAgentUsageSnapshot,
  type AgentUsageProvider,
  type AgentUsageSnapshot,
  type AgentUsageWindow,
} from "../lib/agent-usage";
import { AgentProviderIcon } from "./AgentIcons";

const providerOrder = ["claude", "codex", "grok"] as const;

function providerName(provider: AgentUsageProvider["provider"]) {
  if (provider === "claude") return "Claude";
  if (provider === "grok") return "Grok";
  return "Codex";
}

function ProviderWindow({ window }: { window: AgentUsageWindow }) {
  const { t } = useI18n();
  const percentage = Math.round(window.usedPercent);
  return (
    <div className="usage-settings-window">
      <div>
        <strong>{formatUsageWindowLabel(window)}</strong>
        <span>{percentage}%</span>
      </div>
      <i>
        <b
          className={
            percentage >= 90
              ? "critical"
              : percentage >= 75
                ? "warning"
                : ""
          }
          style={{ width: `${Math.min(100, Math.max(0, percentage))}%` }}
        />
      </i>
      <small>
        {window.resetsAt && window.resetsAt > Date.now()
          ? t("usage.resetsIn", {
              duration: formatUsageDuration(window.resetsAt - Date.now()),
            })
          : t("usage.resetUnknown")}
      </small>
    </div>
  );
}

function ProviderCard({ provider }: { provider: AgentUsageProvider }) {
  const { localeTag, t } = useI18n();
  const windows = [provider.session, provider.weekly, provider.monthly].filter(
    (window): window is AgentUsageWindow => window !== null,
  );
  return (
    <article className={`usage-settings-provider ${provider.status}`}>
      <header>
        <span className={`agent-usage-provider-icon ${provider.provider}`}>
          <AgentProviderIcon provider={provider.provider} size={13} />
        </span>
        <div>
          <strong>{providerName(provider.provider)}</strong>
          <small>
            {provider.accountLabel ??
              provider.planType ??
              t("usage.systemAccount")}
          </small>
        </div>
        <span>{t(`usage.status.${provider.status}`)}</span>
      </header>
      {windows.length > 0 ? (
        <div className="usage-settings-windows">
          {windows.map((window) => (
            <ProviderWindow key={window.windowMinutes} window={window} />
          ))}
        </div>
      ) : (
        <p>{provider.error ?? t("usage.noProviderUsage")}</p>
      )}
      <footer>
        {t("usage.lastChecked", {
          time: new Intl.DateTimeFormat(localeTag, {
            dateStyle: "medium",
            timeStyle: "short",
          }).format(provider.updatedAt),
        })}
      </footer>
    </article>
  );
}

export function AgentUsageSettings({
  onManageAccounts,
}: {
  onManageAccounts: () => void;
}) {
  const { localeTag, t } = useI18n();
  const [history, setHistory] = useState<AgentUsageSnapshot[]>(
    readAgentUsageHistory,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = history[0] ?? null;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const snapshot = await loadAgentUsage();
      setHistory(recordAgentUsageSnapshot(snapshot));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const chartHistory = useMemo(
    () => [...history].reverse().slice(-24),
    [history],
  );

  return (
    <SettingsSection>
      <SettingsGroupHeading
        action={
          <SettingsIconButton
            aria-label={t("usage.refresh")}
            disabled={refreshing}
            onClick={() => void refresh()}
            title={t("usage.refresh")}
          >
            <RefreshCw className={refreshing ? "spin" : ""} size={16} />
          </SettingsIconButton>
        }
        title={t("usage.currentStatus")}
      />
      <div className="usage-settings-provider-grid">
        {latest
          ? providerOrder.map((provider) => (
              <ProviderCard key={provider} provider={latest[provider]} />
            ))
          : providerOrder.map((provider) => (
              <article
                className="usage-settings-provider unavailable"
                key={provider}
              >
                <header>
                  <span className={`agent-usage-provider-icon ${provider}`}>
                    <AgentProviderIcon provider={provider} size={13} />
                  </span>
                  <strong>{providerName(provider)}</strong>
                </header>
                <p>{t("usage.refreshing")}</p>
              </article>
            ))}
      </div>
      {error ? <SettingsAlert>{error}</SettingsAlert> : null}

      <SettingsGroupHeading
        action={
          <div className="usage-settings-history-actions">
            <button onClick={onManageAccounts} type="button">
              {t("usage.manageAccounts")}
            </button>
            <SettingsIconButton
              aria-label={t("usage.clearHistory")}
              disabled={history.length === 0}
              onClick={() => {
                clearAgentUsageHistory();
                setHistory([]);
              }}
              title={t("usage.clearHistory")}
            >
              <Trash2 size={15} />
            </SettingsIconButton>
          </div>
        }
        title={t("usage.history")}
      />
      <SettingsCard>
        {history.length === 0 ? (
          <div className="usage-settings-empty">
            <Activity aria-hidden size={22} />
            <p>{t("usage.noHistory")}</p>
          </div>
        ) : (
          <>
            <div
              aria-label={t("usage.historyChart")}
              className="usage-settings-chart"
            >
              {providerOrder.map((provider) => (
                <div key={provider}>
                  <span>{providerName(provider)}</span>
                  <i>
                    {chartHistory.map((snapshot) => {
                      const windows = [
                        snapshot[provider].session,
                        snapshot[provider].weekly,
                        snapshot[provider].monthly,
                      ].filter(
                        (window): window is AgentUsageWindow => window !== null,
                      );
                      const value = Math.max(
                        0,
                        ...windows.map((window) => window.usedPercent),
                      );
                      return (
                        <b
                          key={snapshot.updatedAt}
                          style={{ height: `${Math.max(3, value)}%` }}
                          title={`${Math.round(value)}%`}
                        />
                      );
                    })}
                  </i>
                </div>
              ))}
            </div>
            <div className="usage-settings-history-table">
              <div role="row">
                <strong>{t("usage.checkedAt")}</strong>
                {providerOrder.map((provider) => (
                  <strong key={provider}>{providerName(provider)}</strong>
                ))}
              </div>
              {history.map((snapshot) => (
                <div key={snapshot.updatedAt} role="row">
                  <time>
                    {new Intl.DateTimeFormat(localeTag, {
                      dateStyle: "short",
                      timeStyle: "short",
                    }).format(snapshot.updatedAt)}
                  </time>
                  {providerOrder.map((provider) => {
                    const windows = [
                      snapshot[provider].session,
                      snapshot[provider].weekly,
                      snapshot[provider].monthly,
                    ].filter(
                      (window): window is AgentUsageWindow => window !== null,
                    );
                    const percentage =
                      windows.length > 0
                        ? Math.max(
                            ...windows.map((window) => window.usedPercent),
                          )
                        : null;
                    return (
                      <span
                        className={snapshot[provider].status}
                        key={provider}
                        title={snapshot[provider].error ?? undefined}
                      >
                        {percentage === null
                          ? t(`usage.status.${snapshot[provider].status}`)
                          : `${Math.round(percentage)}%`}
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          </>
        )}
      </SettingsCard>
      <SettingsNote>{t("usage.historyNote")}</SettingsNote>
    </SettingsSection>
  );
}
