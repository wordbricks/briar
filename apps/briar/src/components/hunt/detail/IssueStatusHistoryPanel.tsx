import { CircleAlert, RefreshCw } from "lucide-react";
import { LoadingState } from "@/components/ui/loading-state";
import { eventMeta } from "@/lib/stages";
import type { HuntEvent, HuntRun } from "@/types";
import { useI18n } from "@/i18n";
import { localizeEvent, relativeTime } from "../model/formatters";
import { cn } from "@/lib/utils";
export function IssueStatusHistoryPanel({
  events,
  id,
  labelledBy,
  loadError,
  loading,
  onRetry,
  workflow
}: {
  events: HuntEvent[];
  id: string;
  labelledBy: string;
  loadError: string | null;
  loading: boolean;
  onRetry: () => void;
  workflow: HuntRun["workflow"];
}) {
  const {
    t
  } = useI18n();
  return <div aria-labelledby={labelledBy} className="issue-status-history-panel min-h-0 overflow-y-auto px-0.5 pb-2" id={id} role="tabpanel">
      {loading ? <div className="run-evidence-state flex min-h-[120px] items-center justify-center gap-2 text-2xs text-muted-foreground">
          <LoadingState label={t("run.activityLoading")} />
        </div> : loadError ? <button className="run-evidence-state error flex min-h-[120px] w-full items-center justify-center gap-2 rounded-lg border-0 bg-[var(--status-destructive-surface)] text-foreground" onClick={onRetry} type="button">
          <CircleAlert size={15} />
          <span>{loadError}</span>
          <RefreshCw size={13} />
        </button> : events.length > 0 ? <div className="issue-activity-history">
          {events.map(event => {
        const display = eventMeta(event.status, event.workflowStage, workflow);
        return <div className="timeline-event relative flex min-h-[72px] pl-[30px] before:absolute before:bottom-[-4px] before:left-[5px] before:top-3 before:w-px before:bg-border last:before:hidden" key={event.id}>
                <i className={cn("absolute left-px top-1 z-[1] size-[9px] rounded-full border-2 border-card shadow-[0_0_0_1px_var(--border)]", display.tone === "violet" && "bg-[#8066d5]", display.tone === "blue" && "bg-[#56a0d6]", display.tone === "indigo" && "bg-[#56a0d6]", display.tone === "emerald" && "bg-[#4db48d]", (display.tone === "rose" || display.tone === "red") && "bg-[#d95f72]", !["violet", "blue", "indigo", "emerald", "rose", "red"].includes(display.tone) && "bg-muted-foreground")} />
                <span className="min-w-0 pb-4">
                  <strong className="text-2xs text-foreground">
                    {localizeEvent(t, event.status, event.workflowStage, display.label)}{" "}
                      <em className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 font-mono text-2xs font-medium not-italic text-muted-foreground">
                      {t("run.attempt", {
                  count: event.attempt
                })} ·{" "}
                      {t("run.revision", {
                  count: event.revision
                })}
                    </em>
                  </strong>
                  {event.detail && <p className="my-0.5 text-2xs text-muted-foreground">{event.detail}</p>}
                  <small className="font-mono text-2xs text-muted-foreground">
                    {event.actorName ?? event.actor} · {relativeTime(event.occurredAt, t)}
                  </small>
                </span>
              </div>;
      })}
        </div> : <p className="issue-activity-empty my-12 text-center text-xs text-muted-foreground">{t("run.activityEmpty")}</p>}
    </div>;
}
