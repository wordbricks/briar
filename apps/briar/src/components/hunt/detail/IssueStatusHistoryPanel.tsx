import { CircleAlert, RefreshCw } from "lucide-react";
import { LoadingState } from "@/components/ui/loading-state";
import { eventMeta } from "@/lib/stages";
import type { HuntEvent, HuntRun } from "@/types";
import { useI18n } from "@/i18n";
import { localizeEvent, relativeTime } from "../model/formatters";
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
  return <div aria-labelledby={labelledBy} className="issue-status-history-panel" id={id} role="tabpanel">
      {loading ? <div className="run-evidence-state">
          <LoadingState label={t("run.activityLoading")} />
        </div> : loadError ? <button className="run-evidence-state error" onClick={onRetry} type="button">
          <CircleAlert size={15} />
          <span>{loadError}</span>
          <RefreshCw size={13} />
        </button> : events.length > 0 ? <div className="issue-activity-history">
          {events.map(event => {
        const display = eventMeta(event.status, event.workflowStage, workflow);
        return <div className="timeline-event" key={event.id}>
                <i className={display.tone} />
                <span>
                  <strong>
                    {localizeEvent(t, event.status, event.workflowStage, display.label)}{" "}
                    <em>
                      {t("run.attempt", {
                  count: event.attempt
                })} ·{" "}
                      {t("run.revision", {
                  count: event.revision
                })}
                    </em>
                  </strong>
                  {event.detail && <p>{event.detail}</p>}
                  <small>
                    {event.actorName ?? event.actor} · {relativeTime(event.occurredAt, t)}
                  </small>
                </span>
              </div>;
      })}
        </div> : <p className="issue-activity-empty">{t("run.activityEmpty")}</p>}
    </div>;
}
