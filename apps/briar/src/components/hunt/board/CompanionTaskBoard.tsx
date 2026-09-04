import { useAtom, useAtomValue } from "@effect/atom-react";
import { Bot, Check, ListFilter } from "lucide-react";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";

import { LoadingState } from "@/components/ui/loading-state";
import { Typography } from "@/components/ui/typography";
import { useControlledCollectionNavigation } from "@/hooks/useControlledCollectionNavigation";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import { type AgentProvider } from "@/lib/team-llm";
import { boardSourceAtom, companionRunIdsAtom } from "@/state/board/atoms";
import { runAtom } from "@/state/entities/runs";
import type { PlanningProject, Project } from "@/types";
import { BoardCard } from "./BoardCard";
import { CompanionTaskSwipeAction } from "./CompanionTaskSwipeAction";
import type { BoardCardContext, BoardHandlers } from "./context";

/*
  One task in the stream. It reads its own run so the swipe action's disabled
  state — which depends on the run's status and lease — costs the list nothing.
*/
const CompanionTaskRow = memo(function CompanionTaskRow({
  context,
  runId,
}: {
  context: BoardCardContext;
  runId: string;
}) {
  const run = useAtomValue(runAtom(runId));
  if (!run) return null;
  const { handlers } = context;
  const claimed =
    run.status === "queued" &&
    Boolean(run.leaseExpiresAt) &&
    Date.parse(run.leaseExpiresAt!) > Date.now();
  return (
    <CompanionTaskSwipeAction
      disabled={
        !handlers.processNow ||
        run.executionReadiness === "waiting" ||
        claimed ||
        context.processingIssueIds.has(runId)
      }
      enabled={run.status === "backlog" || run.status === "queued"}
      onProcessNow={() => handlers.processNow?.(run)}
    >
      <BoardCard context={context} runId={runId} />
    </CompanionTaskSwipeAction>
  );
});

/*
  The phone Tasks stream.

  One column, newest updated first, no search box and no drag. It reads the same
  filter atoms as the desktop board except for the status, which the bottom bar
  owns, and it renders the same id-driven cards — so an issue that changes while
  the list is open reaches its own card and nothing else.
*/
export function CompanionTaskBoard({
  availableProviders,
  deletingIssueId,
  handlers,
  isLoading,
  issueKeyPrefix,
  planningProjects,
  processingIssueIds,
  recoveringRunId,
  scrollLeftRef,
  teamId,
  teams,
  token,
  updatingIssueId,
}: {
  availableProviders: AgentProvider[];
  deletingIssueId: string | null;
  handlers: BoardHandlers;
  isLoading: boolean;
  issueKeyPrefix: string | undefined;
  planningProjects: Array<Pick<PlanningProject, "id" | "name" | "teamId">>;
  processingIssueIds: ReadonlySet<string>;
  recoveringRunId: string | null;
  scrollLeftRef: MutableRefObject<number | null>;
  teamId: string;
  teams: Array<Pick<Project, "id" | "name">>;
  token: string | null;
  updatingIssueId: string | null;
}) {
  const { t } = useI18n();
  const runIds = useAtomValue(companionRunIdsAtom(teamId));
  const [source, setSource] = useAtom(boardSourceAtom);
  const [isSourceFilterOpen, setIsSourceFilterOpen] = useState(false);
  const [cursorRunId, setCursorRunId] = useState<string | null>(null);
  const sourceFilterRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSourceFilterOpen) return;
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!sourceFilterRef.current?.contains(event.target as Node)) {
        setIsSourceFilterOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsSourceFilterOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isSourceFilterOpen]);

  const navigation = useControlledCollectionNavigation<string, HTMLDivElement>({
    cursorId: cursorRunId,
    itemIds: runIds,
    onCursorIdChange: setCursorRunId,
    orientation: "vertical",
    selectedId: null,
    selectionBehavior: "manual",
  });
  useEffect(() => {
    setCursorRunId((current) =>
      current !== null && !runIds.includes(current) ? null : current,
    );
  }, [runIds]);

  /* The phone board has no drag, so every pointer handler is a no-op. */
  const pointer = useMemo(
    () => ({
      cancel: () => undefined,
      consumeSuppressedClick: () => false,
      down: () => undefined,
      move: () => undefined,
      up: () => undefined,
    }),
    [],
  );
  const cardHandlers = useMemo<BoardHandlers>(
    () => ({
      ...handlers,
      open: (run) => {
        setCursorRunId(run.id);
        if (boardRef.current) scrollLeftRef.current = boardRef.current.scrollLeft;
        handlers.open(run);
      },
    }),
    [handlers, scrollLeftRef],
  );
  const context = useMemo<BoardCardContext>(
    () => ({
      availableProviders,
      companionMode: true,
      cursorRunId,
      deletingIssueId,
      draggedRunId: null,
      getItemRef: navigation.getItemRef,
      handlers: cardHandlers,
      issueKeyPrefix,
      onCursor: setCursorRunId,
      planningProjects,
      pointer,
      processingIssueIds,
      recoveringRunId,
      teamId,
      teams,
      token,
      updatingIssueId,
    }),
    [
      availableProviders,
      cardHandlers,
      cursorRunId,
      deletingIssueId,
      issueKeyPrefix,
      navigation.getItemRef,
      planningProjects,
      pointer,
      processingIssueIds,
      recoveringRunId,
      teamId,
      teams,
      token,
      updatingIssueId,
    ],
  );

  return <div className="dashboard-scroll">
      <div className="queue-header">
        <div className="queue-heading">
          <div className="queue-heading-copy">
            <Typography as="span" tone="muted" variant="caption">
              {t("dashboard.taskCount", {
            count: runIds.length
          })}
            </Typography>
          </div>
          <div className="companion-source-filter" ref={sourceFilterRef}>
            <button aria-controls="companion-source-filter-menu" aria-expanded={isSourceFilterOpen} aria-haspopup="menu" aria-label={t("dashboard.filter")} className={`companion-filter-trigger${source !== "all" ? " active" : ""}`} onClick={() => setIsSourceFilterOpen(current => !current)} type="button">
              <ListFilter size={18} />
            </button>
            {isSourceFilterOpen && <div aria-label={t("dashboard.filter")} className="companion-filter-menu" id="companion-source-filter-menu" role="menu">
                {(["all", "issue", "feedback", "error"] as const).map(value => <button aria-checked={source === value} className={source === value ? "active" : ""} key={value} onClick={() => {
              setSource(value);
              setIsSourceFilterOpen(false);
            }} role="menuitemradio" type="button">
                      <span>
                        {value === "all" ? t("dashboard.all") : t(`source.${value}` as MessageKey)}
                      </span>
                      {source === value && <Check size={15} />}
                    </button>)}
              </div>}
          </div>
        </div>
      </div>
      {isLoading ? <div aria-live="polite" aria-busy="true" className="issues-loading-overlay" role="status">
          <LoadingState label={t("dashboard.loadingIssues")} />
        </div> : <div aria-label={t("dashboard.kanbanBoard")} className="kanban-board" data-keyboard-list="" ref={boardRef}>
          {runIds.length === 0 ? <div className="companion-no-runs">
              <Bot size={22} />
              <strong>{t("dashboard.emptyTitle")}</strong>
              <span>{t("dashboard.emptyDescription")}</span>
            </div> : <div className="kanban-column-shell">
              <section aria-label={t("companion.navTasks")} className="kanban-column slate companion-task-stream" data-kanban-column-collapsed="false" data-kanban-column-id="companion-tasks">
                <div className="kanban-column-content">
                  {runIds.map(runId => <CompanionTaskRow context={context} key={runId} runId={runId} />)}
                </div>
              </section>
            </div>}
        </div>}
    </div>;
}
