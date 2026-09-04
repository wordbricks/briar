import { useAtom, useAtomValue } from "@effect/atom-react";
import { Columns3, List, Plus, Search } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";

import { PageHeader } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadingState } from "@/components/ui/loading-state";
import { useI18n } from "@/i18n";
import {
  readKanbanColumnIds,
  toggleKanbanColumnId,
  writeKanbanColumnIds,
} from "@/lib/kanban-column-storage";
import { type AgentProvider } from "@/lib/team-llm";
import {
  boardColumnDefinitionsAtom,
  boardPropertyFiltersAtom,
  boardQueryAtom,
  boardViewAtom,
  boardVisibleColumnIdsAtom,
} from "@/state/board/atoms";
import type {
  OrganizationMember,
  PlanningProject,
  Project,
  ProjectAgent,
} from "@/types";
import {
  BoardSourceFilter,
  BoardStatusTabs,
  BoardTaskCount,
} from "./BoardFilterBar";
import { BoardIssueList } from "./BoardIssueList";
import { BoardKanban, type BoardCardShared } from "./BoardKanban";
import type { BoardHandlers } from "./context";
import { IssuePropertyFilterMenu } from "./IssuePropertyFilterMenu";

/*
  The team's issue board, drawn from the store.

  It replaced the `IssueCollection` render the dashboard used to do with a whole
  `HuntRun[]` in hand. `IssueCollection` still serves "My issues", whose runs
  come from dashboards this window never selected and so are not in the entity
  store; this component is the one for the selected team, and it never holds a
  run. What it holds is the chrome — title, search, filters, view switch — plus
  the two column preferences that live in local storage. The counts sit in their
  own subscribers so this body does not re-render when one of them moves, and
  the kanban below owns the grouping.
*/
export function HuntBoard({
  agents,
  availableProviders,
  currentUserId,
  deletingIssueId,
  handlers,
  headerTrailing,
  isLoading,
  isSidebarOpen,
  issueKeyPrefix,
  members,
  planningProjects,
  processingIssueIds,
  recoveringRunId,
  scrollLeftRef,
  teamId,
  teams,
  token,
  updatingIssueId,
}: {
  agents: ProjectAgent[];
  availableProviders: AgentProvider[];
  currentUserId: string | null;
  deletingIssueId: string | null;
  handlers: BoardHandlers;
  headerTrailing: ReactNode;
  isLoading: boolean;
  isSidebarOpen: boolean;
  issueKeyPrefix: string | undefined;
  members: OrganizationMember[];
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
  const [query, setQuery] = useAtom(boardQueryAtom);
  const [propertyFilters, setPropertyFilters] = useAtom(boardPropertyFiltersAtom);
  const [view, setView] = useAtom(boardViewAtom);
  const definitions = useAtomValue(boardColumnDefinitionsAtom(teamId));
  const visibleColumnIds = useAtomValue(boardVisibleColumnIdsAtom(teamId));
  const [collapsedColumnIds, setCollapsedColumnIds] = useState<string[]>([]);
  const [hiddenColumnIds, setHiddenColumnIds] = useState<string[]>([]);
  /*
    The keyboard cursor and the hidden-column drawer live here rather than in
    the kanban, because switching to the list view and back unmounts it and both
    used to survive that.
  */
  const [cursorRunId, setCursorRunId] = useState<string | null>(null);
  const [hiddenColumnsExpanded, setHiddenColumnsExpanded] = useState(true);
  const toggleHiddenColumnsExpanded = useCallback(
    () => setHiddenColumnsExpanded((current) => !current),
    [],
  );

  useEffect(() => {
    setCollapsedColumnIds(readKanbanColumnIds("collapse", currentUserId, teamId));
    setHiddenColumnIds(readKanbanColumnIds("hide", currentUserId, teamId));
  }, [currentUserId, teamId]);

  const collapsed = useMemo(() => new Set(collapsedColumnIds), [collapsedColumnIds]);
  const hidden = useMemo(() => new Set(hiddenColumnIds), [hiddenColumnIds]);
  const toggleCollapsed = useCallback(
    (columnId: string) => {
      setCollapsedColumnIds((current) => {
        const next = toggleKanbanColumnId(current, columnId);
        writeKanbanColumnIds("collapse", currentUserId, teamId, next);
        return next;
      });
    },
    [currentUserId, teamId],
  );
  const toggleHidden = useCallback(
    (columnId: string) => {
      setHiddenColumnIds((current) => {
        const next = toggleKanbanColumnId(current, columnId);
        writeKanbanColumnIds("hide", currentUserId, teamId, next);
        return next;
      });
    },
    [currentUserId, teamId],
  );

  const shared = useMemo<BoardCardShared>(
    () => ({
      availableProviders,
      companionMode: false,
      deletingIssueId,
      issueKeyPrefix,
      planningProjects,
      processingIssueIds,
      recoveringRunId,
      teamId,
      teams,
      token,
      updatingIssueId,
    }),
    [
      availableProviders,
      deletingIssueId,
      issueKeyPrefix,
      planningProjects,
      processingIssueIds,
      recoveringRunId,
      teamId,
      teams,
      token,
      updatingIssueId,
    ],
  );

  return <>
      <PageHeader
        action={<div className="queue-tools">
            <label className="search-box">
              <Input aria-label={t("dashboard.search")} className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0" onChange={event => setQuery(event.currentTarget.value)} placeholder={t("dashboard.search")} value={query} />
              <Search aria-hidden="true" size={15} />
            </label>
            <IssuePropertyFilterMenu agents={agents} filters={propertyFilters} members={members} onChange={setPropertyFilters} />
            <div aria-label={t("dashboard.viewMode")} className="view-switch" role="group">
              <button aria-label={t("dashboard.kanbanView")} aria-pressed={view === "kanban"} className={view === "kanban" ? "active" : ""} onClick={() => setView("kanban")} title={t("dashboard.kanbanView")} type="button">
                <Columns3 size={14} />
                <span>{t("dashboard.kanban")}</span>
              </button>
              <button aria-label={t("dashboard.listView")} aria-pressed={view === "list"} className={view === "list" ? "active" : ""} onClick={() => setView("list")} title={t("dashboard.listView")} type="button">
                <List size={14} />
                <span>{t("dashboard.list")}</span>
              </button>
            </div>
            {headerTrailing}
          </div>}
        className={`app-page-header queue-header${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region="deep"
        title={<span className="queue-heading-copy">
            <span>{t("dashboard.queue")}</span>
            <BoardTaskCount teamId={teamId} />
          </span>}
      />
      <div className="dashboard-scroll">
        <div className="queue-filter-bar">
          <BoardStatusTabs teamId={teamId} />
          <BoardSourceFilter />
        </div>
        {isLoading ? <div aria-busy="true" aria-live="polite" className="issues-loading-overlay" role="status">
            <LoadingState label={t("dashboard.loadingIssues")} />
          </div> : view === "list" ? <BoardIssueList handlers={handlers} shared={shared} /> : <BoardKanban
            collapsedColumnIds={collapsed}
            cursorRunId={cursorRunId}
            definitions={definitions}
            handlers={handlers}
            hiddenColumnIds={hidden}
            hiddenColumnsExpanded={hiddenColumnsExpanded}
            onCursorRunIdChange={setCursorRunId}
            onToggleCollapsed={toggleCollapsed}
            onToggleHidden={toggleHidden}
            onToggleHiddenColumnsExpanded={toggleHiddenColumnsExpanded}
            scrollLeftRef={scrollLeftRef}
            shared={shared}
            visibleColumnIds={visibleColumnIds}
          />}
      </div>
    </>;
}

/** The board's "new issue" button, which the shell places in the header. */
export function BoardCreateIssueButton({ onCreate }: { onCreate: () => void }) {
  const { t } = useI18n();
  return (
    <Button aria-keyshortcuts="Meta+N" aria-label={t("dashboard.createIssue")} className="create-issue-button" onClick={onCreate} type="button">
      <Plus size={16} />
      {t("issue.newIssue")}
    </Button>
  );
}
