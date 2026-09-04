import { useAtomValue } from "@effect/atom-react";
import { Bot, ChevronDown, ChevronRight } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useAppCollectionKeyboardCommandScope } from "@/hooks/useAppCollectionKeyboardCommandScope";
import {
  useControlledCollectionNavigation,
  type CollectionNavigationDirection,
} from "@/hooks/useControlledCollectionNavigation";
import { useI18n } from "@/i18n";
import { boardGroupedRunIdsAtom } from "@/state/board/atoms";
import type { BoardColumnDefinition } from "@/state/board/columns";
import type { HuntRun } from "@/types";
import { BoardColumn } from "./BoardColumn";
import type { BoardCardContext, BoardHandlers } from "./context";
import { KanbanColumnMenu } from "./KanbanColumnMenu";
import { useBoardColumnLabels } from "./labels";
import { placementMatchesRun } from "../model/kanban";

/*
  The kanban surface: drag, keyboard order and the columns.

  It subscribes to the grouping because the keyboard order is the grouping
  flattened, which means a status change re-renders this component — the order
  really did move. Everything below it is memoised, so that render reaches the
  two columns whose ids changed and no further, and the board chrome above
  (header, search, status tabs) never hears about it at all.
*/

type KeyboardColumn = { id: string; runIds: readonly string[] };

function resolveKeyboardRunId(
  columns: readonly KeyboardColumn[],
  currentRunId: string | null,
  direction: CollectionNavigationDirection,
) {
  const runIds = columns.flatMap((column) => column.runIds);
  if (runIds.length === 0) return null;
  if (currentRunId === null) {
    return direction === "up" || direction === "left"
      ? runIds.at(-1) ?? null
      : runIds[0] ?? null;
  }
  const columnIndex = columns.findIndex((column) =>
    column.runIds.includes(currentRunId),
  );
  if (columnIndex < 0) return runIds[0] ?? null;
  const column = columns[columnIndex]!;
  const rowIndex = column.runIds.indexOf(currentRunId);
  if (direction === "up" || direction === "down") {
    return column.runIds[
      Math.min(
        column.runIds.length - 1,
        Math.max(0, rowIndex + (direction === "up" ? -1 : 1)),
      )
    ] ?? currentRunId;
  }
  if (direction !== "left" && direction !== "right") return null;
  const target = columns[columnIndex + (direction === "left" ? -1 : 1)];
  return target?.runIds[Math.min(rowIndex, target.runIds.length - 1)] ?? currentRunId;
}

export type BoardCardShared = Omit<
  BoardCardContext,
  "cursorRunId" | "draggedRunId" | "getItemRef" | "handlers" | "onCursor" | "pointer"
>;

export function BoardKanban({
  collapsedColumnIds,
  cursorRunId,
  definitions,
  handlers,
  hiddenColumnIds,
  hiddenColumnsExpanded,
  onCursorRunIdChange,
  onToggleCollapsed,
  onToggleHidden,
  onToggleHiddenColumnsExpanded,
  scrollLeftRef,
  shared,
  visibleColumnIds,
}: {
  collapsedColumnIds: ReadonlySet<string>;
  /*
    The keyboard cursor and the hidden-column drawer belong to the board rather
    than to this component, because both survive a switch to the list view and
    back — which unmounts everything below here.
  */
  cursorRunId: string | null;
  /** Every column of the board, hidden ones included, in board order. */
  definitions: readonly BoardColumnDefinition[];
  handlers: BoardHandlers;
  hiddenColumnIds: ReadonlySet<string>;
  hiddenColumnsExpanded: boolean;
  onCursorRunIdChange: (runId: string | null) => void;
  onToggleCollapsed: (columnId: string) => void;
  onToggleHidden: (columnId: string) => void;
  onToggleHiddenColumnsExpanded: () => void;
  scrollLeftRef: MutableRefObject<number | null>;
  shared: BoardCardShared;
  /** The ids the status tab keeps, before the hidden-column preference. */
  visibleColumnIds: readonly string[];
}) {
  const { t } = useI18n();
  const { columnLabel } = useBoardColumnLabels();
  const grouped = useAtomValue(boardGroupedRunIdsAtom(shared.teamId));
  const [draggedRunId, setDraggedRunId] = useState<string | null>(null);
  const [dragOverColumnId, setDragOverColumnId] = useState<string | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const pointerDragRef = useRef<{
    active: boolean;
    pointerId: number;
    startX: number;
    startY: number;
  } | null>(null);
  const pointerDragPreviewRef = useRef<HTMLElement | null>(null);
  const suppressCardClickRef = useRef(false);
  const definitionsRef = useRef(definitions);
  definitionsRef.current = definitions;

  useEffect(() => () => pointerDragPreviewRef.current?.remove(), []);
  useLayoutEffect(() => {
    const scrollLeft = scrollLeftRef.current;
    if (scrollLeft === null || !boardRef.current) return;
    boardRef.current.scrollLeft = scrollLeft;
    scrollLeftRef.current = null;
  }, [scrollLeftRef]);

  const shownColumns = useMemo(() => {
    const byId = new Map(definitions.map((column) => [column.id, column]));
    return visibleColumnIds.flatMap((id) => {
      const column = byId.get(id);
      return column && !hiddenColumnIds.has(id) ? [column] : [];
    });
  }, [definitions, hiddenColumnIds, visibleColumnIds]);
  const hiddenColumns = useMemo(() => {
    const byId = new Map(definitions.map((column) => [column.id, column]));
    return visibleColumnIds.flatMap((id) => {
      const column = byId.get(id);
      return column && hiddenColumnIds.has(id) ? [column] : [];
    });
  }, [definitions, hiddenColumnIds, visibleColumnIds]);

  const keyboardColumns = useMemo<KeyboardColumn[]>(
    () =>
      shownColumns.flatMap((column) => {
        const runIds = grouped.get(column.id) ?? [];
        return collapsedColumnIds.has(column.id) || runIds.length === 0
          ? []
          : [{ id: column.id, runIds }];
      }),
    [collapsedColumnIds, grouped, shownColumns],
  );
  const keyboardRunIds = useMemo(
    () => keyboardColumns.flatMap((column) => column.runIds),
    [keyboardColumns],
  );
  const navigation = useControlledCollectionNavigation<string, HTMLDivElement>({
    cursorId: cursorRunId,
    itemIds: keyboardRunIds,
    onCursorIdChange: onCursorRunIdChange,
    orientation: "both",
    resolveNextId: ({ currentId, direction }) =>
      resolveKeyboardRunId(keyboardColumns, currentId, direction),
    selectedId: null,
    selectionBehavior: "manual",
  });
  useAppCollectionKeyboardCommandScope({
    enabled: keyboardRunIds.length > 0,
    id: "issue-kanban-board",
    move: navigation.move,
    orientation: "both",
    rootRef: boardRef,
  });
  const cursorRunIdRef = useRef(cursorRunId);
  cursorRunIdRef.current = cursorRunId;
  useEffect(() => {
    const current = cursorRunIdRef.current;
    if (current !== null && !keyboardRunIds.includes(current)) {
      onCursorRunIdChange(null);
    }
  }, [keyboardRunIds, onCursorRunIdChange]);

  const clearDrag = useCallback(() => {
    pointerDragPreviewRef.current?.remove();
    pointerDragPreviewRef.current = null;
    pointerDragRef.current = null;
    setDraggedRunId(null);
    setDragOverColumnId(null);
  }, []);
  const columnAtPoint = (x: number, y: number) =>
    document.elementFromPoint?.(x, y)?.closest<HTMLElement>("[data-kanban-column-id]")
      ?.dataset.kanbanColumnId ?? null;

  const pointer = useMemo(
    () => ({
      cancel: (_run: HuntRun, event: ReactPointerEvent<HTMLElement>) => {
        if (pointerDragRef.current?.pointerId === event.pointerId) clearDrag();
      },
      consumeSuppressedClick: () => {
        if (!suppressCardClickRef.current) return false;
        suppressCardClickRef.current = false;
        return true;
      },
      down: (run: HuntRun, event: ReactPointerEvent<HTMLElement>) => {
        if (
          run.status === "paused" ||
          event.pointerType === "touch" ||
          !event.isPrimary ||
          event.button !== 0 ||
          (event.target as Element).closest?.("a, button, input, select, textarea")
        ) {
          return;
        }
        pointerDragRef.current = {
          active: false,
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      },
      move: (run: HuntRun, event: ReactPointerEvent<HTMLElement>) => {
        const drag = pointerDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.active) {
          if (
            Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6
          ) {
            return;
          }
          drag.active = true;
          const preview = event.currentTarget.cloneNode(true) as HTMLElement;
          preview.setAttribute("aria-hidden", "true");
          preview.classList.add("kanban-card-drag-preview", "dragging");
          preview.style.width = `${event.currentTarget.getBoundingClientRect().width}px`;
          document.body.append(preview);
          pointerDragPreviewRef.current = preview;
          setDraggedRunId(run.id);
        }
        event.preventDefault();
        setDragOverColumnId(columnAtPoint(event.clientX, event.clientY));
      },
      up: (run: HuntRun, event: ReactPointerEvent<HTMLElement>) => {
        const drag = pointerDragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.active) {
          pointerDragRef.current = null;
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        suppressCardClickRef.current = true;
        const columnId = columnAtPoint(event.clientX, event.clientY);
        const target = definitionsRef.current.find(
          (candidate) => candidate.id === columnId,
        );
        clearDrag();
        if (target && !placementMatchesRun(run, target.placement)) {
          handlers.move(run, target.placement);
        }
      },
    }),
    [clearDrag, handlers],
  );

  /*
    The card's open path also belongs to the kanban: it swallows the click a
    drop produces and remembers where the board was scrolled to, so coming back
    from the issue detail lands on the same column.
  */
  const cardHandlers = useMemo<BoardHandlers>(
    () => ({
      ...handlers,
      open: (run) => {
        if (pointer.consumeSuppressedClick()) return;
        onCursorRunIdChange(run.id);
        if (boardRef.current) scrollLeftRef.current = boardRef.current.scrollLeft;
        handlers.open(run);
      },
    }),
    [handlers, onCursorRunIdChange, pointer, scrollLeftRef],
  );

  const context = useMemo<BoardCardContext>(
    () => ({
      ...shared,
      cursorRunId,
      draggedRunId,
      getItemRef: navigation.getItemRef,
      handlers: cardHandlers,
      onCursor: onCursorRunIdChange,
      pointer,
    }),
    [
      cardHandlers,
      cursorRunId,
      draggedRunId,
      navigation.getItemRef,
      onCursorRunIdChange,
      pointer,
      shared,
    ],
  );

  return <div aria-label={t("dashboard.kanbanBoard")} className="kanban-board" data-keyboard-list="" ref={boardRef}>
      {shownColumns.length === 0 && hiddenColumns.length === 0 ? <div className="companion-no-runs">
          <Bot size={22} />
          <strong>{t("dashboard.emptyTitle")}</strong>
          <span>{t("dashboard.emptyDescription")}</span>
        </div> : <>
          {shownColumns.map(column => <BoardColumn
            context={context}
            definition={column}
            isCollapsed={collapsedColumnIds.has(column.id)}
            isDragOver={dragOverColumnId === column.id}
            key={column.id}
            onToggleCollapsed={onToggleCollapsed}
            onToggleHidden={onToggleHidden}
          />)}
          {hiddenColumns.length > 0 ? <aside aria-label={t("dashboard.hiddenColumns")} className={`kanban-hidden-columns${hiddenColumnsExpanded ? "" : " is-collapsed"}`} data-kanban-hidden-columns="">
              <button aria-expanded={hiddenColumnsExpanded} aria-label={hiddenColumnsExpanded ? t("dashboard.collapseHiddenColumns") : t("dashboard.expandHiddenColumns")} className="kanban-hidden-columns-toggle" onClick={onToggleHiddenColumnsExpanded} type="button">
                {hiddenColumnsExpanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}<span>{t("dashboard.hiddenColumns")}</span>
              </button>
              {hiddenColumnsExpanded ? <ul className="kanban-hidden-column-list">
                  {hiddenColumns.map(column => <li className={`kanban-hidden-column ${column.tone}`} data-kanban-hidden-column-id={column.id} key={column.id}><span><i aria-hidden="true" />{columnLabel(column)}</span><strong>{(grouped.get(column.id) ?? []).length}</strong><KanbanColumnMenu hidden label={columnLabel(column)} onShow={() => onToggleHidden(column.id)} /></li>)}
                </ul> : null}
            </aside> : null}
        </>}
    </div>;
}
