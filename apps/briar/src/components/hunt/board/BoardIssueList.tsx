import { useAtomValue } from "@effect/atom-react";
import { Bot } from "lucide-react";
import { memo, useCallback, useMemo, useRef, useState, type Ref } from "react";

import { useAppCollectionKeyboardCommandScope } from "@/hooks/useAppCollectionKeyboardCommandScope";
import { useControlledCollectionNavigation } from "@/hooks/useControlledCollectionNavigation";
import { useI18n } from "@/i18n";
import { runIsProcessingAtom } from "@/state/agent-sessions/atoms";
import { boardRunIdsAtom, boardRunKey } from "@/state/board/atoms";
import { runAssigneeAtom } from "@/state/board/run-facts";
import { runAtom } from "@/state/entities/runs";
import type { BoardCardShared } from "./BoardKanban";
import type { BoardHandlers } from "./context";
import { IssueListHeader } from "./IssueListHeader";
import { IssueListRow } from "./IssueListRow";

/*
  The list view, drawn from ids.

  The same split the kanban uses: this component holds the order and the
  keyboard cursor, and each row subscribes to its own run. The rows below share
  one handlers object and one shared-values object, so a row whose run did not
  change is memoised away even when the list re-renders.
*/

interface BoardRowContext {
  readonly handlers: BoardHandlers;
  readonly shared: BoardCardShared;
}

const BoardIssueRow = memo(function BoardIssueRow({
  context,
  isCursor,
  itemRef,
  onActivate,
  onCursor,
  onSelect,
  runId,
}: {
  context: BoardRowContext;
  isCursor: boolean;
  itemRef: Ref<HTMLDivElement>;
  onActivate: (runId: string, repeat: boolean) => void;
  onCursor: (runId: string) => void;
  onSelect: (runId: string) => void;
  runId: string;
}) {
  const { handlers, shared } = context;
  const run = useAtomValue(runAtom(runId));
  const assignee = useAtomValue(runAssigneeAtom(boardRunKey(shared.teamId, runId)));
  const isProcessing = useAtomValue(runIsProcessingAtom(runId));
  if (!run) return null;
  return (
    <IssueListRow
      assignee={assignee}
      availableProviders={shared.availableProviders}
      currentTeamId={shared.teamId}
      deletingIssueId={shared.deletingIssueId}
      isCursor={isCursor}
      isProcessing={isProcessing}
      issueKeyPrefix={shared.issueKeyPrefix}
      itemRef={itemRef}
      onActivate={(repeat) => onActivate(runId, repeat)}
      onCheckpointsChange={handlers.changeCheckpoints}
      onCursor={() => onCursor(runId)}
      onDelete={() => handlers.remove(run)}
      onEdit={() => handlers.edit(run)}
      onMove={handlers.move}
      onOpen={() => handlers.open(run)}
      onPreferencesChange={handlers.changePreferences}
      onPriorityChange={handlers.changePriority}
      onProcessNow={handlers.processNow}
      onProjectChange={handlers.changeProject}
      onSelect={() => onSelect(runId)}
      onTeamChange={handlers.changeTeam}
      onTransfer={handlers.transfer ? () => handlers.transfer!(run) : undefined}
      planningProjects={shared.planningProjects}
      run={run}
      teams={shared.teams}
      updatingIssueId={shared.updatingIssueId}
    />
  );
});

export function BoardIssueList({
  handlers,
  shared,
}: {
  handlers: BoardHandlers;
  shared: BoardCardShared;
}) {
  const { t } = useI18n();
  const runIds = useAtomValue(boardRunIdsAtom(shared.teamId));
  const [cursorId, setCursorId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const activateRun = useCallback((runId: string) => {
    handlersRef.current.openById(runId);
  }, []);
  const navigation = useControlledCollectionNavigation<string, HTMLDivElement>({
    cursorId,
    itemIds: runIds,
    onActivate: activateRun,
    onCursorIdChange: setCursorId,
    onSelectedIdChange: setSelectedId,
    orientation: "vertical",
    selectedId,
    selectionBehavior: "manual",
  });
  useAppCollectionKeyboardCommandScope({
    enabled: runIds.length > 0,
    id: "issue-list",
    move: navigation.move,
    orientation: "vertical",
    rootRef: listRef,
  });
  const context = useMemo<BoardRowContext>(
    () => ({ handlers, shared }),
    [handlers, shared],
  );
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  const onActivate = useCallback((_runId: string, repeat: boolean) => {
    navigationRef.current.activate({ repeat, source: "keyboard" });
  }, []);
  const onSelect = useCallback((runId: string) => {
    setCursorId(runId);
    setSelectedId(runId);
  }, []);

  return <div aria-label={t("dashboard.issueList")} className="issue-list" role="table">
      <IssueListHeader />
      <div className="issue-list-body" data-keyboard-list="" ref={listRef} role="rowgroup">
        {runIds.length === 0 ? <div className="issue-list-empty">
            <Bot size={22} />
            <strong>{t("dashboard.emptyTitle")}</strong>
            <span>{t("dashboard.emptyDescription")}</span>
          </div> : runIds.map(runId => <BoardIssueRow
            context={context}
            isCursor={cursorId === runId}
            itemRef={navigation.getItemRef(runId)}
            key={runId}
            onActivate={onActivate}
            onCursor={setCursorId}
            onSelect={onSelect}
            runId={runId}
          />)}
      </div>
    </div>;
}
