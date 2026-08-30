import { Check, ChevronDown, FolderGit2, ListTodo, RefreshCw, Search } from "lucide-react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, MainContent, PageHeader } from "./layout";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { LoadingState } from "./ui/loading-state";
import { IssueList } from "./hunt/board/IssueList";
import { ProjectIcon } from "./ProjectIcon";
import { useI18n } from "../i18n";
import { formatIssueKey } from "../lib/issue-key";
import type { DashboardPayload, HuntRun, OrganizationMember, Project } from "../types";

type MyIssuesStatus = "all" | "active" | "attention" | "completed";

type MyIssue = {
  project: Project;
  run: HuntRun;
};

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
  projects: Project[];
  selectedProjectIds: ReadonlySet<string>;
  onChange: (projectIds: Set<string>) => void;
};

function ProjectFilter({
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
          className={`issue-property-filter-trigger my-issues-project-filter-trigger${selectedCount > 0 ? " active" : ""}`}
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

function matchesStatus(run: HuntRun, status: MyIssuesStatus) {
  if (status === "active") return !["completed", "cancelled"].includes(run.status);
  if (status === "attention") return ["paused", "blocked", "failed"].includes(run.status);
  if (status === "completed") return ["completed", "cancelled"].includes(run.status);
  return true;
}

function issueMatchesQuery(issue: MyIssue, query: string) {
  if (!query) return true;
  const searchText = [
    issue.project.name,
    formatIssueKey(issue.project.issueKeyPrefix, issue.run.runNumber),
    issue.run.title,
    issue.run.detail,
    issue.run.issueDescription,
    issue.run.sourceKey,
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
  return searchText.includes(query);
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
  const [hasLoaded, setHasLoaded] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<MyIssuesStatus>("all");

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
    const controller = new AbortController();
    let cancelled = false;
    setIsLoading(true);
    setHasLoaded(scopedProjects.length === 0);
    setDashboards({});
    setFailedProjectIds([]);

    if (scopedProjects.length === 0) {
      setIsLoading(false);
      return () => controller.abort();
    }

    void Promise.all(
      scopedProjects.map(async (project) => {
        try {
          return {
            dashboard: await loadProjectDashboard(project.id, controller.signal),
            failed: false,
            projectId: project.id,
          };
        } catch {
          return { dashboard: null, failed: true, projectId: project.id };
        }
      }),
    ).then((results) => {
      if (cancelled || controller.signal.aborted) return;
      const nextDashboards: Record<string, DashboardPayload> = {};
      const nextFailedProjectIds: string[] = [];
      for (const result of results) {
        if (result.dashboard) nextDashboards[result.projectId] = result.dashboard;
        if (result.failed) nextFailedProjectIds.push(result.projectId);
      }
      setDashboards(nextDashboards);
      setFailedProjectIds(nextFailedProjectIds);
      setHasLoaded(true);
      setIsLoading(false);
    });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loadProjectDashboard, retryToken, scopedProjects]);

  const projectById = useMemo(
    () => new Map(scopedProjects.map((project) => [project.id, project])),
    [scopedProjects],
  );
  const issues = useMemo(() => {
    const next: MyIssue[] = [];
    for (const [projectId, dashboard] of Object.entries(dashboards)) {
      const project = projectById.get(projectId) ?? dashboard.project;
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
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredIssues = useMemo(
    () =>
      selectedIssues.filter(
        (issue) =>
          matchesStatus(issue.run, status) &&
          issueMatchesQuery(issue, normalizedQuery),
      ),
    [normalizedQuery, selectedIssues, status],
  );
  const activeCount = selectedIssues.filter((issue) =>
    matchesStatus(issue.run, "active"),
  ).length;
  const attentionCount = selectedIssues.filter((issue) =>
    matchesStatus(issue.run, "attention"),
  ).length;
  const completedCount = selectedIssues.filter((issue) =>
    matchesStatus(issue.run, "completed"),
  ).length;
  const projectByRunId = useMemo(
    () => new Map(filteredIssues.map((issue) => [issue.run.id, issue.project])),
    [filteredIssues],
  );
  const members = useMemo(() => {
    const byUserId = new Map<string, OrganizationMember>();
    for (const dashboard of Object.values(dashboards)) {
      for (const member of dashboard.members ?? []) byUserId.set(member.userId, member);
    }
    return [...byUserId.values()];
  }, [dashboards]);
  const emptyProcessingIds = useMemo(() => new Set<string>(), []);

  return (
    <MainContent id="my-issues">
      <PageHeader
        action={
          <div className="queue-tools my-issues-tools">
            <label className="search-box my-issues-search">
              <Search aria-hidden="true" size={15} />
              <Input
                aria-label={t("myIssues.search")}
                className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={t("myIssues.search")}
                value={query}
              />
            </label>
            <ProjectFilter
              onChange={setSelectedProjectIds}
              projects={scopedProjects}
              selectedProjectIds={selectedProjectIds}
            />
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
          </div>
        }
        className={`app-page-header queue-header${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region="deep"
        description={t("myIssues.description")}
        eyebrow={organizationName}
        title={
          <span className="queue-heading-copy">
            <span>{t("myIssues.title")}</span>
            <span className="queue-task-count">
              {t("myIssues.count", { count: filteredIssues.length })}
            </span>
          </span>
        }
      />
      <div className="dashboard-scroll my-issues-scroll">
        <div className="queue-filter-bar my-issues-filter-bar">
          <div className="status-tabs">
            <button
              className={status === "all" ? "active" : ""}
              onClick={() => setStatus("all")}
              type="button"
            >
              {t("dashboard.all")} <span>{selectedIssues.length}</span>
            </button>
            <button
              className={status === "active" ? "active" : ""}
              onClick={() => setStatus("active")}
              type="button"
            >
              {t("dashboard.active")} <span>{activeCount}</span>
            </button>
            <button
              className={status === "attention" ? "active" : ""}
              onClick={() => setStatus("attention")}
              type="button"
            >
              {t("dashboard.attention")} <span>{attentionCount}</span>
            </button>
            <button
              className={status === "completed" ? "active" : ""}
              onClick={() => setStatus("completed")}
              type="button"
            >
              {t("dashboard.completed")} <span>{completedCount}</span>
            </button>
          </div>
        </div>
        {failedProjectIds.length > 0 ? (
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
        ) : null}
        {!hasLoaded || isLoading ? (
          <div aria-busy="true" className="my-issues-loading" role="status">
            <LoadingState label={t("myIssues.loading")} />
          </div>
        ) : failedProjectIds.length > 0 && issues.length === 0 ? (
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
        ) : issues.length === 0 ? (
          <EmptyState
            description={t("myIssues.emptyDescription")}
            icon={<ListTodo aria-hidden="true" size={22} />}
            title={t("myIssues.emptyTitle")}
          />
        ) : filteredIssues.length === 0 ? (
          <EmptyState
            description={t("myIssues.filterEmptyDescription")}
            icon={<FolderGit2 aria-hidden="true" size={22} />}
            title={t("myIssues.filterEmptyTitle")}
          />
        ) : (
          <IssueList
            availableProviders={[]}
            deletingIssueId={null}
            issueKeyPrefix={undefined}
            issueKeyPrefixForRun={(run) =>
              projectByRunId.get(run.id)?.issueKeyPrefix
            }
            members={members}
            onCheckpointsChange={() => undefined}
            onDelete={() => undefined}
            onEdit={() => undefined}
            onMove={() => undefined}
            onOpen={(runId) => {
              const issue = projectByRunId.get(runId);
              if (issue) onOpenIssue(issue.id, runId);
            }}
            onPreferencesChange={() => undefined}
            onPriorityChange={() => undefined}
            processingIssueIds={emptyProcessingIds}
            projectForRun={(run) => projectByRunId.get(run.id)}
            readOnly
            runs={filteredIssues.map((issue) => issue.run)}
            updatingIssueId={null}
          />
        )}
      </div>
    </MainContent>
  );
}
