import { useAtomValue } from "@effect/atom-react";
import { Check, ChevronDown, FolderGit2, ListTodo, RefreshCw } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useCallback, useEffect, useMemo } from "react";
import { EmptyState, MainContent } from "./layout";
import { Button } from "./ui/button";
import {
  IssueCollection,
  type IssueCollectionState,
  type IssueWorkflowContext,
} from "./hunt/board/IssueCollection";
import { IssuePropertyFilterMenu } from "./hunt/board/IssuePropertyFilterMenu";
import { MyIssuesList } from "./MyIssuesList";
import { TeamIcon } from "./TeamIcon";
import { useI18n } from "../i18n";
import { formatIssueKey } from "../lib/issue-key";
import type { HuntRun, Project } from "../types";
import { teamSettingsAtom } from "../state/team/atoms";
import {
  myIssuesCountAtom,
  myIssuesQueryAtom,
  myIssuesFailedTeamIdsAtom,
  myIssuesGroupedRunIdsAtom,
  myIssuesLoadedKeyAtom,
  myIssuesLoadingAtom,
  myIssuesMembersAtom,
  myIssuesPropertyFiltersAtom,
  myIssuesRetryAtom,
  myIssuesRunProjectIdsAtom,
  myIssuesRunProjectsAtom,
  myIssuesScopedRunIdsAtom,
  myIssuesScopedRunsAtom,
  myIssuesScopeAtom,
  myIssuesSelectedProjectIdsAtom,
  myIssuesSourceAtom,
  myIssuesStatusAtom,
  myIssuesViewAtom,
  resetMyIssuesViewState,
} from "../state/my-issues/atoms";
import {
  myIssuesCompositionKey,
  useMyIssuesSync,
  type MyIssuesDashboardLoader,
} from "../state/my-issues/useMyIssuesSync";
import { useRegistry } from "../state/registry";

/*
  "내 이슈", drawn from the store.

  The page used to load a `DashboardPayload` per project of the organization
  into a `useState` record and render run objects out of it. Those responses go
  through `applySyncEvent` now (`state/my-issues/useMyIssuesSync.ts`), and what
  is left here is the page's chrome: the project filter, the scope tabs and the
  choice between the two views. The list below renders ids, so a realtime edit
  to one issue reaches its own row and nothing else; the kanban is
  `IssueCollection`, which still takes runs, and is mounted only while it is the
  selected view.
*/

export type MyIssuesProps = {
  isSidebarOpen: boolean;
  loadProjectDashboard: MyIssuesDashboardLoader;
  onOpenIssue: (projectId: string, runId: string) => void;
  organizationId: string | null;
  organizationName?: string | null;
  projects: Project[];
};

type ProjectFilterProps = {
  compact?: boolean;
  projects: Project[];
  selectedProjectIds: ReadonlySet<string>;
  onChange: (projectIds: string[]) => void;
};

function ProjectFilter({
  compact = false,
  projects,
  selectedProjectIds,
  onChange,
}: ProjectFilterProps) {
  const { t } = useI18n();
  const selectedCount = selectedProjectIds.size;
  const selectedProject =
    selectedCount === 1
      ? projects.find((project) => selectedProjectIds.has(project.id))
      : null;
  const label =
    selectedProject?.name ??
    (selectedCount === 0
      ? t("myIssues.allProjects")
      : t("myIssues.selectedProjects", { count: selectedCount }));

  const toggleProject = (projectId: string) => {
    if (selectedCount === 0) {
      onChange([projectId]);
      return;
    }
    const next = new Set(selectedProjectIds);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    onChange([...next]);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          aria-label={t("myIssues.projectSelectLabel")}
          className={`issue-property-filter-trigger my-issues-project-filter-trigger${compact ? " compact" : ""}${selectedCount > 0 ? " active" : ""}`}
          disabled={projects.length === 0}
          type="button"
        >
          <FolderGit2 aria-hidden="true" size={15} />
          <span>{label}</span>
          {selectedCount > 1 ? <strong>{selectedCount}</strong> : null}
          <ChevronDown aria-hidden="true" size={12} />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          className="issue-property-filter-menu my-issues-project-menu"
          collisionPadding={10}
          sideOffset={6}
        >
          <DropdownMenu.Label className="issue-property-filter-heading">
            {t("myIssues.projectFilter")}
          </DropdownMenu.Label>
          <DropdownMenu.CheckboxItem
            checked={selectedCount === 0}
            className="issue-property-filter-choice"
            onSelect={(event) => {
              event.preventDefault();
              onChange([]);
            }}
          >
            <DropdownMenu.ItemIndicator className="issue-property-filter-check">
              <Check aria-hidden="true" size={13} />
            </DropdownMenu.ItemIndicator>
            <span className="issue-property-filter-choice-label">
              {t("myIssues.allProjects")}
            </span>
          </DropdownMenu.CheckboxItem>
          <DropdownMenu.Separator className="issue-property-filter-separator" />
          {projects.map((project) => (
            <DropdownMenu.CheckboxItem
              checked={selectedCount === 0 || selectedProjectIds.has(project.id)}
              className="issue-property-filter-choice"
              data-project-id={project.id}
              key={project.id}
              onSelect={(event) => {
                event.preventDefault();
                toggleProject(project.id);
              }}
            >
              <DropdownMenu.ItemIndicator className="issue-property-filter-check">
                <Check aria-hidden="true" size={13} />
              </DropdownMenu.ItemIndicator>
              <span className="issue-property-filter-choice-label">
                <TeamIcon className="my-issues-project-menu-icon" project={project} />
                {project.name}
              </span>
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * The kanban view, which is `IssueCollection` across several workflows. It is
 * the one place on the page that still subscribes to run objects, and it is
 * mounted only while the kanban is selected.
 */
function MyIssuesKanban({
  bodyBefore,
  emptyContent,
  filteredEmptyContent,
  headerTrailing,
  isLoading,
  isSidebarOpen,
  onOpenIssue,
  organizationId,
  organizationName,
  state,
  toolbarAfterSearch,
}: {
  bodyBefore: React.ReactNode;
  emptyContent: React.ReactNode;
  filteredEmptyContent: React.ReactNode;
  headerTrailing: React.ReactNode;
  isLoading: boolean;
  isSidebarOpen: boolean;
  onOpenIssue: (projectId: string, runId: string) => void;
  organizationId: string | null;
  organizationName?: string | null;
  state: IssueCollectionState;
  toolbarAfterSearch: React.ReactNode;
}) {
  const { t } = useI18n();
  const runs = useAtomValue(myIssuesScopedRunsAtom);
  const projectByRunId = useAtomValue(myIssuesRunProjectsAtom);
  const members = useAtomValue(myIssuesMembersAtom);
  const workflowProjectIds = useAtomValue(myIssuesRunProjectIdsAtom);
  const registry = useRegistry();
  const workflowContexts = useMemo(
    () =>
      workflowProjectIds.flatMap((teamId): IssueWorkflowContext[] => {
        const settings = registry.get(teamSettingsAtom(teamId));
        if (!settings) return [];
        return [{ id: teamId, label: undefined, settings }];
      }),
    [registry, workflowProjectIds],
  );
  const workflowForRun = useCallback(
    (run: HuntRun): IssueWorkflowContext | undefined => {
      const project = projectByRunId.get(run.id);
      if (!project) return undefined;
      const settings = registry.get(teamSettingsAtom(project.id));
      if (!settings) return undefined;
      return { id: project.id, label: project.name, settings };
    },
    [projectByRunId, registry],
  );
  const emptyProcessingIds = useMemo(() => new Set<string>(), []);

  return (
    <IssueCollection
      agents={[]}
      availableProviders={[]}
      bodyBefore={bodyBefore}
      countLabel={(count) => t("myIssues.count", { count })}
      currentUserId={null}
      deletingIssueId={null}
      emptyContent={emptyContent}
      filteredEmptyContent={filteredEmptyContent}
      getSearchText={(run) => {
        const project = projectByRunId.get(run.id);
        return [
          project?.name,
          formatIssueKey(project?.issueKeyPrefix, run.runNumber),
          run.title,
          run.detail,
          run.issueDescription,
          run.sourceKey,
        ]
          .filter(Boolean)
          .join(" ");
      }}
      headerDescription={t("myIssues.description")}
      headerEyebrow={organizationName}
      headerTrailing={headerTrailing}
      isLoading={isLoading}
      isSidebarOpen={isSidebarOpen}
      issueKeyPrefixForRun={(run) => projectByRunId.get(run.id)?.issueKeyPrefix}
      loadingLabel={t("myIssues.loading")}
      members={members}
      onOpen={(run) => {
        const project = projectByRunId.get(run.id);
        if (project) onOpenIssue(project.id, run.id);
      }}
      processingIssueIds={emptyProcessingIds}
      projectForRun={(run) => projectByRunId.get(run.id)}
      readOnly
      recoveringRunId={null}
      runs={runs}
      scrollClassName="my-issues-scroll"
      searchPlaceholder={t("myIssues.search")}
      state={state}
      storageScopeId={organizationId ? `my-issues:${organizationId}` : null}
      title={t("myIssues.title")}
      toolbarAfterSearch={toolbarAfterSearch}
      updatingIssueId={null}
      workflowForRun={workflowForRun}
      workflowContexts={workflowContexts}
    />
  );
}

export function MyIssues({
  isSidebarOpen,
  loadProjectDashboard,
  onOpenIssue,
  organizationId,
  organizationName,
  projects,
}: MyIssuesProps) {
  const { t } = useI18n();
  const registry = useRegistry();
  const scopedProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          organizationId === null || project.organizationId === organizationId,
      ),
    [organizationId, projects],
  );
  const scopedProjectIds = useMemo(
    () => scopedProjects.map((project) => project.id),
    [scopedProjects],
  );
  useMyIssuesSync({
    load: loadProjectDashboard,
    organizationId,
    teamIds: scopedProjectIds,
  });
  /*
    The page's view state is in atoms now, and this page is what scopes it:
    mounting puts it back to its defaults, which is what unmounting the page did
    to the `useState` it replaced.
  */
  useEffect(() => {
    resetMyIssuesViewState(registry);
  }, [registry]);

  const view = useAtomValue(myIssuesViewAtom);
  const scope = useAtomValue(myIssuesScopeAtom);
  const query = useAtomValue(myIssuesQueryAtom);
  const source = useAtomValue(myIssuesSourceAtom);
  const status = useAtomValue(myIssuesStatusAtom);
  const propertyFilters = useAtomValue(myIssuesPropertyFiltersAtom);
  const selectedProjectIdList = useAtomValue(myIssuesSelectedProjectIdsAtom);
  const members = useAtomValue(myIssuesMembersAtom);
  const groups = useAtomValue(myIssuesGroupedRunIdsAtom);
  const filteredCount = useAtomValue(myIssuesCountAtom);
  const scopedRunIds = useAtomValue(myIssuesScopedRunIdsAtom);
  const failedProjectIds = useAtomValue(myIssuesFailedTeamIdsAtom);
  const isLoading = useAtomValue(myIssuesLoadingAtom);
  const loadedKey = useAtomValue(myIssuesLoadedKeyAtom);

  const selectedProjectIds = useMemo(
    () => new Set(selectedProjectIdList),
    [selectedProjectIdList],
  );
  const retry = useCallback(
    () => registry.update(myIssuesRetryAtom, (token) => token + 1),
    [registry],
  );
  const collectionState = useMemo<IssueCollectionState>(
    () => ({
      propertyFilters,
      query,
      setPropertyFilters: (next) =>
        registry.set(myIssuesPropertyFiltersAtom, next),
      setQuery: (next) => registry.set(myIssuesQueryAtom, next),
      setSource: (next) => registry.set(myIssuesSourceAtom, next),
      setStatus: (next) => registry.set(myIssuesStatusAtom, next),
      setView: (next) => registry.set(myIssuesViewAtom, next),
      source,
      status,
      view,
    }),
    [propertyFilters, query, registry, source, status, view],
  );
  const isInitialLoading =
    isLoading &&
    loadedKey !== myIssuesCompositionKey(organizationId, scopedProjectIds) &&
    scopedRunIds.length === 0;

  const bodyBefore = failedProjectIds.length > 0 ? (
    <div className="my-issues-load-error" role="alert">
      <span>{t("myIssues.loadError")}</span>
      <Button onClick={retry} size="sm" type="button" variant="outline">
        {t("myIssues.retry")}
      </Button>
    </div>
  ) : null;
  const emptyContent = failedProjectIds.length > 0 && scopedRunIds.length === 0 ? (
    <EmptyState
      action={
        <Button onClick={retry} size="sm" type="button" variant="outline">
          {t("myIssues.retry")}
        </Button>
      }
      description={t("myIssues.loadErrorDescription")}
      icon={<RefreshCw aria-hidden="true" size={22} />}
      title={t("myIssues.loadError")}
    />
  ) : (
    <EmptyState
      description={t("myIssues.emptyDescription")}
      icon={<ListTodo aria-hidden="true" size={22} />}
      title={t("myIssues.emptyTitle")}
    />
  );
  const filteredEmptyContent = (
    <EmptyState
      description={t("myIssues.filterEmptyDescription")}
      icon={<FolderGit2 aria-hidden="true" size={22} />}
      title={t("myIssues.filterEmptyTitle")}
    />
  );
  const setSelectedProjectIds = useCallback(
    (next: string[]) => registry.set(myIssuesSelectedProjectIdsAtom, next),
    [registry],
  );

  if (view === "kanban") {
    return (
      <MainContent id="my-issues">
        <MyIssuesKanban
          bodyBefore={bodyBefore}
          emptyContent={emptyContent}
          filteredEmptyContent={filteredEmptyContent}
          headerTrailing={
            <Button
              aria-label={t("myIssues.retry")}
              className="my-issues-refresh-button"
              disabled={isLoading}
              onClick={retry}
              size="icon-sm"
              title={t("myIssues.retry")}
              type="button"
              variant="outline"
            >
              <RefreshCw aria-hidden="true" size={15} />
            </Button>
          }
          isLoading={isInitialLoading}
          isSidebarOpen={isSidebarOpen}
          onOpenIssue={onOpenIssue}
          organizationId={organizationId}
          organizationName={organizationName}
          state={collectionState}
          toolbarAfterSearch={
            <ProjectFilter
              onChange={setSelectedProjectIds}
              projects={scopedProjects}
              selectedProjectIds={selectedProjectIds}
            />
          }
        />
      </MainContent>
    );
  }

  return (
    <MainContent id="my-issues">
      <MyIssuesList
        bodyBefore={bodyBefore}
        count={filteredCount}
        emptyContent={emptyContent}
        filteredEmptyContent={filteredEmptyContent}
        groups={groups}
        hasUnfilteredIssues={scopedRunIds.length > 0}
        isLoading={isInitialLoading}
        loadingLabel={t("myIssues.loading")}
        members={members}
        onOpen={onOpenIssue}
        onQueryChange={(next) => registry.set(myIssuesQueryAtom, next)}
        onRetry={retry}
        onScopeChange={(next) => registry.set(myIssuesScopeAtom, next)}
        onViewChange={(next) => registry.set(myIssuesViewAtom, next)}
        projectFilter={
          <ProjectFilter
            compact
            onChange={setSelectedProjectIds}
            projects={scopedProjects}
            selectedProjectIds={selectedProjectIds}
          />
        }
        propertyFilter={
          <IssuePropertyFilterMenu
            agents={[]}
            filters={propertyFilters}
            members={members}
            onChange={(next) => registry.set(myIssuesPropertyFiltersAtom, next)}
          />
        }
        query={query}
        scope={scope}
        searchPlaceholder={t("myIssues.search")}
        sidebarClosed={!isSidebarOpen}
        title={t("myIssues.title")}
        view={view}
      />
    </MainContent>
  );
}
