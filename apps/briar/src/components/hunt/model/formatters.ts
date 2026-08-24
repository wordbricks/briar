import { AGENT_EXECUTION_USD_TICKS_PER_DOLLAR } from "@/lib/agent-execution-cost";
import type { HuntRun } from "@/types";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
export function formatExecutionUsdTicks(value: number, locale: string) {
  const dollars = value / AGENT_EXECUTION_USD_TICKS_PER_DOLLAR;
  const magnitude = Math.abs(dollars);
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: magnitude === 0 || magnitude >= 1 ? 2 : magnitude >= 0.01 ? 4 : magnitude >= 0.0001 ? 6 : 8,
    maximumFractionDigits: magnitude >= 1 ? 2 : 10
  }).format(dollars);
}
export function formatRatePerMillion(value: number, locale: string) {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(value * 1_000_000);
}
export type Translate = ReturnType<typeof useI18n>["t"];
export const builtInStageIds = new Set(["analyzing", "planning", "implementing", "reviewing", "pr_open", "local_qa", "ci_qa", "staging_qa", "production_qa", "monitoring"]);
export function localizeWorkflowStage(t: Translate, stageId: string, fallback: string) {
  return builtInStageIds.has(stageId) ? t(`stage.${stageId}` as MessageKey) : fallback;
}
export function localizeStatus(t: Translate, status: HuntRun["status"], workflowStage: string | null, fallback: string) {
  if (status === "running" && workflowStage && builtInStageIds.has(workflowStage)) return t(`stage.${workflowStage}` as MessageKey);
  return t(`status.${status}` as MessageKey) || fallback;
}
export function localizeEvent(t: Translate, status: HuntRun["status"], workflowStage: string | null, fallback: string) {
  if (workflowStage && builtInStageIds.has(workflowStage)) return t(`stage.${workflowStage}` as MessageKey);
  return t(`status.${status}` as MessageKey) || fallback;
}
export function relativeTime(value: string, t: Translate) {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 60) return t("time.minutesAgo", {
    count: minutes
  });
  if (minutes < 1_440) return t("time.hoursAgo", {
    count: Math.floor(minutes / 60)
  });
  return t("time.daysAgo", {
    count: Math.floor(minutes / 1_440)
  });
}
export function formatDate(value: string, localeTag: string) {
  return new Intl.DateTimeFormat(localeTag, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}
