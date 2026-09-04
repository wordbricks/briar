import { useAtomValue } from "@effect/atom-react";
import { memo } from "react";

import { boardRunKey } from "@/state/board/atoms";
import {
  runAgentAssociationAtom,
  runAssignedWorkerAtom,
  runAssigneeAtom,
} from "@/state/board/run-facts";
import { runAtom } from "@/state/entities/runs";
import type { BoardCardContext } from "./context";
import { KanbanCard } from "./KanbanCard";

/*
  One kanban card, subscribed to its own run.

  This is where Phase 2's second promise lands: the column above hands down an
  id and the shared context, and the card reads the run and its three derived
  facts itself. An edit to one issue therefore notifies one card. The card is
  memoised and the context is one stable object, so a column that re-renders
  because its own id list moved does not drag its untouched cards with it.
*/
export const BoardCard = memo(function BoardCard({
  context,
  runId,
}: {
  context: BoardCardContext;
  runId: string;
}) {
  const run = useAtomValue(runAtom(runId));
  const key = boardRunKey(context.teamId, runId);
  const agents = useAtomValue(runAgentAssociationAtom(key));
  const assignedWorker = useAtomValue(runAssignedWorkerAtom(key));
  const assignee = useAtomValue(runAssigneeAtom(key));
  if (!run) return null;

  const { companionMode, handlers, pointer } = context;
  const teamIdForRun = run.teamId ?? context.teamId;
  return (
    <KanbanCard
      activeAgent={agents.active}
      assignedWorker={assignedWorker}
      assignee={assignee}
      availableProviders={context.availableProviders}
      cardRef={context.getItemRef(runId)}
      contextMenuDisabled={companionMode}
      currentTeamId={context.teamId}
      deletingIssueId={context.deletingIssueId}
      hideAssignmentBadges={
        !companionMode &&
        ["completed", "cancelled", "paused", "blocked", "failed"].includes(run.status)
      }
      isDragging={context.draggedRunId === runId}
      isKeyboardCursor={context.cursorRunId === runId}
      isMoving={context.recoveringRunId === runId}
      isProcessing={context.processingIssueIds.has(runId)}
      issueKeyPrefix={context.issueKeyPrefix}
      onCheckpointsChange={(checkpoints) => handlers.changeCheckpoints(run, checkpoints)}
      onDelete={() => handlers.remove(run)}
      onEdit={() => handlers.edit(run)}
      onFocus={() => context.onCursor(runId)}
      onMove={(placement) => handlers.move(run, placement)}
      onOpen={() => handlers.open(run)}
      onPointerCancel={(event) => pointer.cancel(run, event)}
      onPointerDown={(event) => pointer.down(run, event)}
      onPointerMove={(event) => pointer.move(run, event)}
      onPointerUp={(event) => pointer.up(run, event)}
      onPreferencesChange={(preferences) => handlers.changePreferences(run, preferences)}
      onPriorityChange={(priority) => handlers.changePriority(run, priority)}
      onProcessNow={handlers.processNow ? () => handlers.processNow!(run) : undefined}
      onProjectChange={
        handlers.changeProject && run.projectId
          ? (projectId) => {
              if (projectId === run.projectId) return;
              handlers.changeProject!(run, projectId);
            }
          : undefined
      }
      onTeamChange={
        handlers.changeTeam ? (teamId) => handlers.changeTeam!(run, teamId) : undefined
      }
      onTransfer={handlers.transfer ? () => handlers.transfer!(run) : undefined}
      planningProjects={
        companionMode
          ? context.planningProjects.filter(
              (project) => !run.teamId || project.teamId === run.teamId,
            )
          : context.planningProjects.filter(
              (project) => project.teamId === teamIdForRun,
            )
      }
      run={run}
      teams={context.teams}
      token={context.token}
      updatingIssueId={context.updatingIssueId}
    />
  );
});
