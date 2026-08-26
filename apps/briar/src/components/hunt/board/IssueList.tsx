import { Bot, ChevronRight } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useAppCollectionKeyboardCommandScope } from "@/hooks/useAppCollectionKeyboardCommandScope";
import { useControlledCollectionNavigation } from "@/hooks/useControlledCollectionNavigation";
import { runMeta } from "@/lib/stages";
import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { formatIssueKey } from "@/lib/issue-key";
import type { HuntRun, HuntRunPlacement, IssueExecutionPreferences, OrganizationMember } from "@/types";
import { type AgentProvider } from "@/lib/project-llm";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { IssueContextMenu } from "./IssueContextMenu";
import { PullRequestIconLink } from "./PullRequestIconLink";
import { RunStatusPill } from "../detail/RunStatusPill";
import { localizeStatus, relativeTime } from "../model/formatters";
import { hasResultReviews } from "../results/model";
import { IssueDifficultyIcon } from "../IssueDifficultyIcon";
export function IssueList({
  availableProviders,
  issueKeyPrefix,
  deletingIssueId,
  onDelete,
  onTransfer,
  onEdit,
  onMove,
  onOpen,
  onProcessIssueNow,
  onPriorityChange,
  onPreferencesChange,
  onCheckpointsChange,
  members,
  runs,
  processingIssueIds,
  updatingIssueId
}: {
  availableProviders: AgentProvider[];
  issueKeyPrefix?: string;
  deletingIssueId: string | null;
  onDelete: (runId: string) => void;
  onTransfer?: (runId: string) => void;
  onEdit: (runId: string) => void;
  onMove: (run: HuntRun, placement: HuntRunPlacement) => void;
  onOpen: (runId: string) => void;
  onProcessIssueNow?: (run: HuntRun) => void;
  onPriorityChange: (run: HuntRun, priority: number | null) => void;
  onPreferencesChange: (run: HuntRun, preferences: IssueExecutionPreferences) => void;
  onCheckpointsChange: (run: HuntRun, checkpoints: AutoHuntWorkflowCheckpoint[]) => void;
  members: OrganizationMember[];
  runs: HuntRun[];
  processingIssueIds: ReadonlySet<string>;
  updatingIssueId: string | null;
}) {
  const {
    t
  } = useI18n();
  const runIds = useMemo(() => runs.map(run => run.id), [runs]);
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activateRun = useCallback((runId: string) => {
    onOpen(runId);
  }, [onOpen]);
  const navigation = useControlledCollectionNavigation<string, HTMLDivElement>({
    cursorId,
    itemIds: runIds,
    onActivate: activateRun,
    onCursorIdChange: setCursorId,
    onSelectedIdChange: setSelectedId,
    orientation: "vertical",
    selectedId,
    selectionBehavior: "manual"
  });
  useAppCollectionKeyboardCommandScope({
    enabled: runIds.length > 0,
    id: "issue-list",
    move: navigation.move,
    orientation: "vertical",
    rootRef: listRef
  });
  return <div aria-label={t("dashboard.issueList")} className="issue-list" role="table">
      <div className="issue-list-grid issue-list-header" role="row">
        <span role="columnheader">{t("dashboard.task")}</span>
        <span role="columnheader">{t("dashboard.status")}</span>
        <span role="columnheader">{t("issue.priority")}</span>
        <span role="columnheader">{t("dashboard.updated")}</span>
        <span aria-hidden="true" />
      </div>
      <div className="issue-list-body" data-keyboard-list="" ref={listRef} role="rowgroup">
        {runs.length === 0 ? <div className="issue-list-empty">
            <Bot size={22} />
            <strong>{t("dashboard.emptyTitle")}</strong>
            <span>{t("dashboard.emptyDescription")}</span>
          </div> : runs.map(run => {
        const assignee = members.find(member => member.userId === run.assigneeUserId);
        const meta = runMeta(run.status, run.workflowStage, run.workflow);
        const label = localizeStatus(t, run.status, run.workflowStage, meta.label);
        const isClaimed = run.status === "queued" && Boolean(run.leaseExpiresAt) && Date.parse(run.leaseExpiresAt!) > Date.now();
        return <IssueContextMenu availableProviders={availableProviders} disabled={deletingIssueId === run.id || updatingIssueId === run.id} key={run.id} onDelete={() => onDelete(run.id)} onTransfer={onTransfer ? () => onTransfer(run.id) : undefined} onEdit={() => onEdit(run.id)} onMove={placement => onMove(run, placement)} onOpen={() => onOpen(run.id)} onProcessNow={onProcessIssueNow ? () => onProcessIssueNow(run) : undefined} onPriorityChange={priority => onPriorityChange(run, priority)} onPreferencesChange={preferences => onPreferencesChange(run, preferences)} onCheckpointsChange={checkpoints => onCheckpointsChange(run, checkpoints)} run={run} isProcessing={processingIssueIds.has(run.id)}>
              <div aria-label={t("run.details", {
            title: run.title
          })} className="issue-list-grid issue-list-row" data-keyboard-list-current={cursorId === run.id ? "" : undefined} data-keyboard-list-item="" data-run-id={run.id} onClick={() => {
            setCursorId(run.id);
            setSelectedId(run.id);
            onOpen(run.id);
          }} onFocus={() => setCursorId(run.id)} onKeyDown={event => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            navigation.activate({
              repeat: event.repeat,
              source: "keyboard"
            });
          }} onPointerDown={() => setCursorId(run.id)} ref={navigation.getItemRef(run.id)} role="row" tabIndex={0}>
                <span className="issue-list-task" role="cell">
                  <span className="issue-list-task-kicker">
                    <small>
                      {formatIssueKey(issueKeyPrefix, run.runNumber)} · {run.sourceKey}
                      {assignee ? ` · ${assignee.name}` : ""}
                    </small>
                    <PullRequestIconLink urls={run.pullRequestUrls} />
                    <IssueDifficultyIcon difficulty={run.difficulty} size={12} />
                  </span>
                  <strong>{run.title}</strong>
                  {(run.detail || run.issueDescription) && <span>{run.detail || run.issueDescription}</span>}
                </span>
                <span className="issue-list-status" role="cell">
                  <RunStatusPill label={label} reviewed={hasResultReviews(run)} status={run.status} tone={meta.tone} />
                  <small>
                    <i className={`source-dot ${run.source}`} />
                    {t(`source.${run.source}` as MessageKey)}
                  </small>
                </span>
                <span className="issue-list-priority" role="cell">
                  {run.priority === null ? "—" : `P${run.priority}`}
                </span>
                <span className="issue-list-updated" role="cell">
                  {isClaimed ? t("run.assigned", {
                agent: run.claimedBy ?? "agent"
              }) : relativeTime(run.updatedAt, t)}
                </span>
                <ChevronRight aria-hidden="true" size={15} />
              </div>
            </IssueContextMenu>;
      })}
      </div>
    </div>;
}
