import { CircleAlert } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useLayoutEffect, useRef } from "react";
import { AgentWorkLog } from "@/components/AgentWorkLog";
import { type AutoHuntAgentMessage } from "@/lib/auto-hunt-agent";
import { agentProviderLabels, type AgentProvider } from "@/lib/team-llm";
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
  return <div aria-labelledby={labelledBy} className="issue-agent-activity-panel" id={id} onScroll={handleScroll} ref={panelRef} role="tabpanel">
      <header>
        <div>
          <strong>{t("run.agentActivity")}</strong>
          <p>{t("run.agentActivityDescription")}</p>
        </div>
        <span className="auto-hunt-event-count">
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
