import { Check, ChevronDown, FolderGit2, ListTodo, RefreshCw } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmptyState, MainContent } from "./layout";
import { Button } from "./ui/button";
import {
  IssueCollection,
  type IssueCollectionState,
  type IssueWorkflowContext,
} from "./hunt/board/IssueCollection";
import { IssuePropertyFilterMenu } from "./hunt/board/IssuePropertyFilterMenu";
import {
  MyIssuesList,
  type MyIssue,
  type MyIssueScope,
} from "./MyIssuesList";
import { ProjectIcon } from "./ProjectIcon";
import { useI18n } from "../i18n";
import { formatIssueKey } from "../lib/issue-key";
import type { DashboardPayload, HuntRun, OrganizationMember, Project } from "../types";
import {
  emptyIssuePropertyFilters,
  runMatchesIssuePropertyFilters,
} from "./hunt/model/filters";

export type MyIssuesProps = {
  currentUserId: string | null;
  isSidebarOpen: boolean;
  loadProjectDashboard: (
    projectId: string,
    signal: AbortSignal,
  ) => Promise<DashboardPayload | null>;
  onOpenIssue: (projectId: string, runId: string) => void;
  organizationId: string | null;
  organizationName?: string | null;
  projects: Project[];
};

type ProjectFilterProps = {
  compact?: boolean;
  projects: Project[];
  selectedProjectIds: ReadonlySet<string>;
  onChange: (projectIds: Set<string>) => void;
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
    const next = new Set(selectedProjectIds);
    if (selectedCount === 0) {
      onChange(new Set([projectId]));
      return;
    }
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    onChange(next);
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
              onChange(new Set());
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
              <span className="my-issues-project-option">
                <ProjectIcon className="my-issues-project-icon" project={project} />
                <span className="issue-property-filter-choice-label">
                  {project.name}
                </span>
              </span>
            </DropdownMenu.CheckboxItem>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function statusMatchesMyIssues(
  run: HuntRun,
  status: IssueCollectionState["status"],
) {
  if (status === "active") return !["completed", "cancelled"].includes(run.status);
  if (status === "attention") return ["paused", "blocked", "failed"].includes(run.status);
  if (status === "completed") return ["completed", "cancelled"].includes(run.status);
  return true;
}

export function MyIssues({
  currentUserId,
  isSidebarOpen,
  loadProjectDashboard,
  onOpenIssue,
  organizationId,
  organizationName,
  projects,
}: MyIssuesProps) {
  const { t } = useI18n();
  const scopedProjects = useMemo(
    () =>
      projects.filter(
        (project) =>
          organizationId === null || project.organizationId === organizationId,
      ),
    [organizationId, projects],
  );
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [dashboards, setDashboards] = useState<Record<string, DashboardPayload>>(
    {},
  );
  const [failedProjectIds, setFailedProjectIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [loadedConfigurationKey, setLoadedConfigurationKey] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<IssueCollectionState["source"]>("all");
  const [status, setStatus] = useState<IssueCollectionState["status"]>("all");
  const [view, setView] = useState<IssueCollectionState["view"]>("list");
  const [scope, setScope] = useState<MyIssueScope>("assigned");
  const [propertyFilters, setPropertyFilters] = useState(emptyIssuePropertyFilters);
  const loadProjectDashboardRef = useRef(loadProjectDashboard);
  loadProjectDashboardRef.current = loadProjectDashboard;
  const projectConfigurationKey = useMemo(
    () =>
      JSON.stringify({
        organizationId,
        projectIds: scopedProjects.map((project) => project.id).sort(),
      }),
    [organizationId, scopedProjects],
  );

  useEffect(() => {
    const projectIds = new Set(scopedProjects.map((project) => project.id));
    setSelectedProjectIds((current) => {
      const next = new Set(
        [...current].filter((projectId) => projectIds.has(projectId)),
      );
      return next.size === current.size ? current : next;
    });
  }, [scopedProjects]);

  useEffect(() => {
    const projectIds = (
      JSON.parse(projectConfigurationKey) as { projectIds: string[] }
    ).projectIds;
    const controller = new AbortController();
    let cancelled = false;
    setIsLoading(true);
    setFailedProjectIds([]);

    if (projectIds.length === 0) {
      setDashboards({});
      setLoadedConfigurationKey(projectConfigurationKey);
      setIsLoading(false);
      return () => controller.abort();
    }

    void Promise.all(
      projectIds.map(async (projectId) => {
        try {
          return {
            dashboard: await loadProjectDashboardRef.current(projectId, controller.signal),
            failed: false,
            projectId,
          };
        } catch {
          return { dashboard: null, failed: true, projectId };
        }
      }),
    ).then((results) => {
      if (cancelled || controller.signal.aborted) return;
      const nextFailedProjectIds: string[] = [];
      setDashboards((current) => {
        const nextDashboards: Record<string, DashboardPayload> = {};
        for (const projectId of projectIds) {
          const dashboard = current[projectId];
          if (dashboard) nextDashboards[projectId] = dashboard;
        }
        for (const result of results) {
          if (result.dashboard) nextDashboards[result.projectId] = result.dashboard;
        }
        return nextDashboards;
      });
      for (const result of results) {
        if (result.failed) nextFailedProjectIds.push(result.projectId);
      }
      setFailedProjectIds(nextFailedProjectIds);
      setLoadedConfigurationKey(projectConfigurationKey);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [projectConfigurationKey, retryToken]);

  const projectById = useMemo(
    () => new Map(scopedProjects.map((project) => [project.id, project])),
    [scopedProjects],
  );
  const issues = useMemo(() => {
    const next: MyIssue[] = [];
    for (const [projectId, dashboard] of Object.entries(dashboards)) {
      const project = projectById.get(projectId);
      if (!project) continue;
      for (const run of dashboard.runs) {
        if (
          currentUserId &&
          (run.createdByUserId === currentUserId ||
            run.assigneeUserId === currentUserId)
        ) {
          next.push({ project, run });
        }
      }
    }
    return next.sort((left, right) =>
      right.run.updatedAt.localeCompare(left.run.updatedAt),
    );
  }, [currentUserId, dashboards, projectById]);
  const selectedIssues = useMemo(
    () =>
      selectedProjectIds.size === 0
        ? issues
        : issues.filter((issue) => selectedProjectIds.has(issue.project.id)),
    [issues, selectedProjectIds],
  );
  const scopedIssues = useMemo(() => {
    if (scope === "created") {
      return selectedIssues.filter(
        (issue) => issue.run.createdByUserId === currentUserId,
      );
    }
    if (scope === "subscribed") {
      return selectedIssues.filter((issue) =>
        issue.run.subscribers?.some((subscriber) => subscriber.userId === currentUserId),
      );
    }
    return selectedIssues;
  }, [currentUserId, scope, selectedIssues]);
  const filteredListIssues = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return scopedIssues.filter(({ project, run }) => {
      if (source !== "all" && run.source !== source) return false;
      if (!runMatchesIssuePropertyFilters(run, propertyFilters)) return false;
      if (!statusMatchesMyIssues(run, status)) return false;
      if (!normalizedQuery) return true;
      return [
        project.name,
        formatIssueKey(project.issueKeyPrefix, run.runNumber),
        run.title,
        run.detail,
        run.issueDescription,
        run.sourceKey,
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase()
        .includes(normalizedQuery);
    });
  }, [propertyFilters, query, scopedIssues, source, status]);
  const projectByRunId = useMemo(
    () => new Map(selectedIssues.map((issue) => [issue.run.id, issue.project])),
    [selectedIssues],
  );
  const dashboardByRunId = useMemo(() => {
    const result = new Map<string, DashboardPayload>();
    for (const issue of selectedIssues) {
      const dashboard = dashboards[issue.project.id];
      if (dashboard) result.set(issue.run.id, dashboard);
    }
    return result;
  }, [dashboards, selectedIssues]);
  const members = useMemo(() => {
    const byUserId = new Map<string, OrganizationMember>();
    for (const dashboard of Object.values(dashboards)) {
      for (const member of dashboard.members ?? []) byUserId.set(member.userId, member);
    }
    return [...byUserId.values()];
  }, [dashboards]);
  const emptyProcessingIds = useMemo(() => new Set<string>(), []);
  const collectionState = useMemo<IssueCollectionState>(
    () => ({
      propertyFilters,
      query,
      setPropertyFilters,
      setQuery,
      setSource,
      setStatus,
      setView,
      source,
      status,
      view,
    }),
    [propertyFilters, query, source, status, view],
  );
  const workflowForRun = useCallback(
    (run: HuntRun): IssueWorkflowContext | undefined => {
      const dashboard = dashboardByRunId.get(run.id);
      if (!dashboard) return undefined;
      return {
        id: dashboard.project.id,
        label: dashboard.project.name,
        settings: dashboard.settings,
      };
    },
    [dashboardByRunId],
  );
  const workflowContexts = useMemo(() => {
    const result = new Map<string, IssueWorkflowContext>();
    for (const issue of selectedIssues) {
      const dashboard = dashboards[issue.project.id];
      if (!dashboard) continue;
      result.set(dashboard.project.id, {
        id: dashboard.project.id,
        label: dashboard.project.name,
        settings: dashboard.settings,
      });
    }
    return [...result.values()];
  }, [dashboards, selectedIssues]);
  const isInitialLoading =
    isLoading &&
    loadedConfigurationKey !== projectConfigurationKey &&
    selectedIssues.length === 0;

  const bodyBefore = failedProjectIds.length > 0 ? (
    <div className="my-issues-load-error" role="alert">
      <span>{t("myIssues.loadError")}</span>
      <Button
        onClick={() => setRetryToken((current) => current + 1)}
        size="sm"
        type="button"
        variant="outline"
      >
        {t("myIssues.retry")}
      </Button>
    </div>
  ) : null;
  const emptyContent = failedProjectIds.length > 0 && issues.length === 0 ? (
    <EmptyState
      action={
        <Button
          onClick={() => setRetryToken((current) => current + 1)}
          size="sm"
          type="button"
          variant="outline"
        >
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

  if (view === "kanban") {
    return (
      <MainContent id="my-issues">
        <IssueCollection
          agents={[]}
          availableProviders={[]}
          bodyBefore={bodyBefore}
          countLabel={(count) => t("myIssues.count", { count })}
          currentUserId={currentUserId}
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
            ].filter(Boolean).join(" ");
          }}
          headerDescription={t("myIssues.description")}
          headerEyebrow={organizationName}
          headerTrailing={
            <Button
              aria-label={t("myIssues.retry")}
              className="my-issues-refresh-button"
              disabled={isLoading}
              onClick={() => setRetryToken((current) => current + 1)}
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
          runs={selectedIssues.map((issue) => issue.run)}
          scrollClassName="my-issues-scroll"
          searchPlaceholder={t("myIssues.search")}
          state={collectionState}
          storageScopeId={organizationId ? `my-issues:${organizationId}` : null}
          title={t("myIssues.title")}
          toolbarAfterSearch={
            <ProjectFilter
              onChange={setSelectedProjectIds}
              projects={scopedProjects}
              selectedProjectIds={selectedProjectIds}
            />
          }
          updatingIssueId={null}
          workflowForRun={workflowForRun}
          workflowContexts={workflowContexts}
        />
      </MainContent>
    );
  }

  return (
    <MainContent id="my-issues">
      <MyIssuesList
        bodyBefore={bodyBefore}
        emptyContent={emptyContent}
        filteredEmptyContent={filteredEmptyContent}
        hasUnfilteredIssues={selectedIssues.length > 0}
        isLoading={isInitialLoading}
        loadingLabel={t("myIssues.loading")}
        members={members}
        onOpen={(issue) => onOpenIssue(issue.project.id, issue.run.id)}
        onQueryChange={setQuery}
        onRetry={() => setRetryToken((current) => current + 1)}
        onScopeChange={setScope}
        onViewChange={setView}
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
            onChange={setPropertyFilters}
          />
        }
        query={query}
        runs={filteredListIssues}
        scope={scope}
        searchPlaceholder={t("myIssues.search")}
        sidebarClosed={!isSidebarOpen}
        title={t("myIssues.title")}
        view={view}
      />
    </MainContent>
  );
}
