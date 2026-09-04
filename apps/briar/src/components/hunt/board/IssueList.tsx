import { Bot } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useAppCollectionKeyboardCommandScope } from "@/hooks/useAppCollectionKeyboardCommandScope";
import { useControlledCollectionNavigation } from "@/hooks/useControlledCollectionNavigation";
import { type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import type { HuntRun, HuntRunPlacement, IssueExecutionPreferences, OrganizationMember, PlanningProject, Project } from "@/types";
import { type AgentProvider } from "@/lib/team-llm";
import { useI18n } from "@/i18n";
import { IssueListHeader } from "./IssueListHeader";
import { IssueListRow } from "./IssueListRow";
export function IssueList({
  availableProviders,
  issueKeyPrefix,
  deletingIssueId,
  onDelete,
  onTransfer,
  onTeamChange,
  onProjectChange,
  teams = [],
  currentTeamId = null,
  planningProjects = [],
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
  updatingIssueId,
  issueKeyPrefixForRun,
  projectForRun,
  readOnly = false,
}: {
  availableProviders: AgentProvider[];
  issueKeyPrefix?: string;
  deletingIssueId: string | null;
  onDelete: (runId: string) => void;
  onTransfer?: (runId: string) => void;
  onTeamChange?: (run: HuntRun, teamId: string) => void;
  onProjectChange?: (run: HuntRun, projectId: string) => void;
  teams?: Array<Pick<Project, "id" | "name">>;
  currentTeamId?: string | null;
  planningProjects?: Array<Pick<PlanningProject, "id" | "name" | "teamId">>;
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
  issueKeyPrefixForRun?: (run: HuntRun) => string | undefined;
  projectForRun?: (run: HuntRun) => Pick<Project, "icon" | "name"> | undefined;
  readOnly?: boolean;
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
      <IssueListHeader />
      <div className="issue-list-body" data-keyboard-list="" ref={listRef} role="rowgroup">
        {runs.length === 0 ? <div className="issue-list-empty">
            <Bot size={22} />
            <strong>{t("dashboard.emptyTitle")}</strong>
            <span>{t("dashboard.emptyDescription")}</span>
          </div> : runs.map(run => <IssueListRow
            assignee={members.find(member => member.userId === run.assigneeUserId) ?? null}
            availableProviders={availableProviders}
            currentTeamId={currentTeamId}
            deletingIssueId={deletingIssueId}
            isCursor={cursorId === run.id}
            isProcessing={processingIssueIds.has(run.id)}
            issueKeyPrefix={issueKeyPrefixForRun?.(run) ?? issueKeyPrefix}
            itemRef={navigation.getItemRef(run.id)}
            key={run.id}
            onActivate={repeat => navigation.activate({
              repeat,
              source: "keyboard"
            })}
            onCheckpointsChange={onCheckpointsChange}
            onCursor={() => setCursorId(run.id)}
            onDelete={onDelete}
            onEdit={onEdit}
            onMove={onMove}
            onOpen={onOpen}
            onPreferencesChange={onPreferencesChange}
            onPriorityChange={onPriorityChange}
            onProcessNow={onProcessIssueNow}
            onProjectChange={onProjectChange}
            onSelect={() => {
              setCursorId(run.id);
              setSelectedId(run.id);
            }}
            onTeamChange={onTeamChange}
            onTransfer={onTransfer}
            planningProjects={planningProjects}
            project={projectForRun?.(run)}
            readOnly={readOnly}
            run={run}
            teams={teams}
            updatingIssueId={updatingIssueId}
          />)}
      </div>
    </div>;
}
