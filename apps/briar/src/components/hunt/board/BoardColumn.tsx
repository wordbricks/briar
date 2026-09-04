import { useAtomValue } from "@effect/atom-react";
import { Bot, ChevronDown, ChevronRight, Plus } from "lucide-react";
import { memo } from "react";

import { useI18n } from "@/i18n";
import { boardColumnKey, boardColumnRunIdsAtom } from "@/state/board/atoms";
import type { BoardColumnDefinition } from "@/state/board/columns";
import { BoardCard } from "./BoardCard";
import type { BoardCardContext } from "./context";
import { KanbanColumnMenu } from "./KanbanColumnMenu";
import { useBoardColumnLabels } from "./labels";

/*
  One kanban column, subscribed to its own id list.

  The count in the header and the cards below it come from an atom that holds
  the ids of this column alone, so a run moving between two columns re-renders
  those two and nothing else. Memoised for the same reason the card is: the
  kanban above re-renders whenever the grouping changes — its keyboard order
  depends on it — and a column whose ids did not move must not follow.
*/
export const BoardColumn = memo(function BoardColumn({
  context,
  definition,
  isCollapsed,
  isDragOver,
  onToggleCollapsed,
  onToggleHidden,
}: {
  context: BoardCardContext;
  definition: BoardColumnDefinition;
  isCollapsed: boolean;
  isDragOver: boolean;
  onToggleCollapsed: (columnId: string) => void;
  onToggleHidden: (columnId: string) => void;
}) {
  const { t } = useI18n();
  const { checkpointLabels, columnLabel } = useBoardColumnLabels();
  const runIds = useAtomValue(
    boardColumnRunIdsAtom(boardColumnKey(context.teamId, definition.id)),
  );
  const label = columnLabel(definition);
  const checkpointsBefore = checkpointLabels(definition);

  return <div className={`kanban-column-shell${isCollapsed ? " is-collapsed" : ""}`}>
      {checkpointsBefore.length > 0 ? <span aria-label={`${t("settings.workflowCheckpoints")}: ${checkpointsBefore.join(", ")}`} className="kanban-checkpoint-marker" data-checkpoint-count={checkpointsBefore.length} role="img" tabIndex={0} title={checkpointsBefore.join(" · ")}>
          <svg aria-hidden="true" viewBox="0 0 12 10"><path d="M2 0C1.2 0 .7.8 1.1 1.5l4.1 7.4c.35.65 1.25.65 1.6 0l4.1-7.4C11.3.8 10.8 0 10 0Z" /></svg>
        </span> : null}
      <section aria-label={label} className={`kanban-column ${definition.tone}${isDragOver ? " drag-over" : ""}${isCollapsed ? " is-collapsed" : ""}`} data-kanban-column-collapsed={isCollapsed ? "true" : "false"} data-kanban-column-id={definition.id}>
        <header>
          <span><i aria-hidden="true" />{label}</span>
          <div className="kanban-column-header-actions">
            <strong>{runIds.length}</strong>
            <button aria-expanded={!isCollapsed} aria-label={isCollapsed ? t("dashboard.expandColumn", {
              label
            }) : t("dashboard.collapseColumn", {
              label
            })} className="kanban-column-collapse" onClick={() => onToggleCollapsed(definition.id)} type="button">
              {isCollapsed ? <ChevronRight aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
            </button>
            <KanbanColumnMenu label={label} onHide={() => onToggleHidden(definition.id)} />
          </div>
        </header>
        {isCollapsed ? null : <div className="kanban-column-content">
            {runIds.length > 0 ? runIds.map(runId => <BoardCard context={context} key={runId} runId={runId} />) : <div className="kanban-column-empty"><Bot size={18} /><span>{t("dashboard.columnEmpty")}</span></div>}
            <button aria-label={t("dashboard.createIssueInColumn", {
              label
            })} className="kanban-column-add" data-kanban-column-add="" onClick={() => context.handlers.createInColumn(definition.placement)} type="button">
              <Plus aria-hidden="true" size={15} /><span>{t("dashboard.createIssue")}</span>
            </button>
          </div>}
      </section>
    </div>;
});
