import { CircleAlert } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useLayoutEffect, useRef } from "react";
import { AgentWorkLog } from "@/components/AgentWorkLog";
import { type AutoHuntAgentMessage } from "@/lib/auto-hunt-agent";
import { agentProviderLabels, type AgentProvider } from "@/lib/project-llm";
import { useI18n } from "@/i18n";
export function IssueAgentActivityPanel({
  activity,
  error,
  id,
  isLive,
  labelledBy,
  loading,
  provider
}: {
  activity: AutoHuntAgentMessage[];
  error: string | null;
  id: string;
  isLive: boolean;
  labelledBy: string;
  loading: boolean;
  provider: AgentProvider | null;
}) {
  const {
    t
  } = useI18n();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  useLayoutEffect(() => {
    if (loading) {
      stickToBottomRef.current = true;
      return;
    }
    const panel = panelRef.current;
    if (panel && stickToBottomRef.current && !error && activity.length > 0) {
      panel.scrollTop = panel.scrollHeight;
    }
  }, [activity, error, loading]);
  const handleScroll = () => {
    const panel = panelRef.current;
    if (!panel) return;
    stickToBottomRef.current = panel.scrollHeight - panel.scrollTop - panel.clientHeight < 24;
  };
  return <div aria-labelledby={labelledBy} className="issue-agent-activity-panel min-h-0 min-w-0 overflow-y-auto" id={id} onScroll={handleScroll} ref={panelRef} role="tabpanel">
      <header className="flex items-start justify-between gap-3 border-b border-border px-0.5 pb-2">
        <div>
          <strong>{t("run.agentActivity")}</strong>
          <p className="mt-0.5 text-2xs text-muted-foreground">{t("run.agentActivityDescription")}</p>
        </div>
        <span className="auto-hunt-event-count text-2xs text-muted-foreground">
          {isLive ? <i>
              <span />
              {t("autoHunt.live")}
            </i> : null}
          {provider ? agentProviderLabels[provider] : null}
          {t("autoHunt.eventCount", {
          count: activity.length
        })}
        </span>
      </header>
      {error ? <div className="auto-hunt-event-state error" role="alert">
          <CircleAlert size={14} />
          {t("run.agentActivityLoadFailed")}
        </div> : loading ? <div className="auto-hunt-event-state">
          <Spinner size={14} />
          {t("run.agentActivityLoading")}
        </div> : activity.length === 0 ? <div className="auto-hunt-event-state">
          {t("run.agentActivityEmpty")}
        </div> : <AgentWorkLog activity={activity} provider={provider} terminal={!isLive} />}
    </div>;
}
