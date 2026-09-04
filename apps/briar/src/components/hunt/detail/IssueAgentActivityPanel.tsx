import { CircleAlert } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useLayoutEffect, useRef } from "react";
import { AgentWorkLog } from "@/components/AgentWorkLog";
import { SelectMenu } from "@/components/SelectMenu";
import { type AutoHuntAgentMessage } from "@/lib/auto-hunt-agent";
import { agentProviderLabels, type AgentProvider } from "@/lib/team-llm";
import type { ProjectAgentTranscriptSession } from "@/hooks/useProjectAgentTranscriptSessions";
import { useI18n } from "@/i18n";
export function IssueAgentActivityPanel({
  activity,
  error,
  id,
  isLive,
  labelledBy,
  loading,
  onSelectSession,
  provider,
  selectedSessionId,
  sessions = []
}: {
  activity: AutoHuntAgentMessage[];
  error: string | null;
  id: string;
  isLive: boolean;
  labelledBy: string;
  loading: boolean;
  onSelectSession?: (sessionId: string | null) => void;
  provider: AgentProvider | null;
  selectedSessionId?: string | null;
  sessions?: readonly ProjectAgentTranscriptSession[];
}) {
  const {
    localeTag,
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
  // Every claim of the run records its own session, so the newest one is what
  // the run-scoped log follows while the others stay selectable.
  const latestSessionId = sessions[0]?.sessionId ?? null;
  const activeSessionId = selectedSessionId ?? latestSessionId;
  const isHistoricSession = Boolean(activeSessionId && activeSessionId !== latestSessionId);
  const sessionTime = new Intl.DateTimeFormat(localeTag, {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const sessionOptions = sessions.map((session, position) => ({
    value: session.sessionId,
    label: t(session.archived ? "run.agentActivitySessionArchived" : position === 0 ? "run.agentActivitySessionLatest" : "run.agentActivitySessionOption", {
      index: sessions.length - position,
      time: sessionTime.format(new Date(session.startedAtMs))
    })
  }));
  return <div aria-labelledby={labelledBy} className="issue-agent-activity-panel" id={id} onScroll={handleScroll} ref={panelRef} role="tabpanel">
      <header>
        <div>
          <strong>{t("run.agentActivity")}</strong>
          <p>{t("run.agentActivityDescription")}</p>
        </div>
        <div className="issue-agent-activity-controls">
          {onSelectSession && sessionOptions.length > 1 ? <SelectMenu className="issue-agent-activity-session-select" label={t("run.agentActivitySession")} onValueChange={value => onSelectSession(value === latestSessionId ? null : value)} options={sessionOptions} size="small" value={activeSessionId ?? ""} /> : null}
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
        </div>
      </header>
      {isHistoricSession ? <p className="issue-agent-activity-notice">
          {t("run.agentActivityHistoricNotice")}
        </p> : null}
      {error ? <div className="auto-hunt-event-state error" role="alert">
          <CircleAlert size={14} />
          {t("run.agentActivityLoadFailed")}
        </div> : loading ? <div className="auto-hunt-event-state">
          <Spinner className="size-[14px]" />
          {t("run.agentActivityLoading")}
        </div> : activity.length === 0 ? <div className="auto-hunt-event-state">
          {t("run.agentActivityEmpty")}
        </div> : <AgentWorkLog activity={activity} provider={provider} terminal={!isLive} />}
    </div>;
}
