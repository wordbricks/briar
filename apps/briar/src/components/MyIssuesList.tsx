import { useAtomValue } from "@effect/atom-react";
import {
  AlertCircle,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Columns3,
  List,
  Plus,
  Search,
  TriangleAlert,
} from "lucide-react";
import { memo, useMemo, useState, type ReactNode } from "react";

import { Input } from "./ui/input";
import { Typography } from "./ui/typography";
import { PageHeader } from "./layout";
import { TeamIcon } from "./TeamIcon";
import { PullRequestIconLink } from "./hunt/board/PullRequestIconLink";
import { relativeTime, localizeStatus } from "./hunt/model/formatters";
import { useI18n } from "../i18n";
import { formatIssueKey } from "../lib/issue-key";
import type { DashboardView } from "../state/board/filters";
import { runAtom } from "../state/entities/runs";
import {
  myIssuesRunProjectAtom,
  type MyIssuesGroup,
} from "../state/my-issues/atoms";
import type { MyIssueScope, MyIssuesGroupKey } from "../state/my-issues/model";
import type { HuntRun, OrganizationMember } from "../types";

export type { MyIssueScope } from "../state/my-issues/model";

/*
  The "내 이슈" list, drawn from ids.

  The page handed this component `{ project, run }` pairs, so an edit to one
  issue re-rendered every row on the page. It takes the grouped id lists now and
  each row subscribes to its own run and to the project that run is listed
  under: a `run-changed` for one issue rebuilds the derived groups, they come
  back element-wise identical, and the only component that commits is that row.
*/

function providerLabel(provider: string) {
  return provider.length === 0
    ? provider
    : provider.charAt(0).toUpperCase() + provider.slice(1);
}

function StatusIcon({ run }: { run: HuntRun }) {
  if (["blocked", "failed"].includes(run.status)) {
    return <TriangleAlert aria-hidden="true" size={15} />;
  }
  if (run.status === "paused") {
    return <AlertCircle aria-hidden="true" size={15} />;
  }
  if (["completed", "cancelled"].includes(run.status)) {
    return <CheckCircle2 aria-hidden="true" size={15} />;
  }
  if (run.status === "backlog") {
    return <BarChart3 aria-hidden="true" size={15} />;
  }
  return <span aria-hidden="true" className="my-issues-row-loading-dot" />;
}

function issueGroupLabel(
  t: ReturnType<typeof useI18n>["t"],
  group: MyIssuesGroupKey,
) {
  return t(`myIssues.group.${group}` as Parameters<typeof t>[0]);
}

/** One row, subscribed to its own run. */
const MyIssuesRow = memo(function MyIssuesRow({
  members,
  onOpen,
  runId,
}: {
  members: readonly OrganizationMember[];
  onOpen: (projectId: string, runId: string) => void;
  runId: string;
}) {
  const { t } = useI18n();
  const run = useAtomValue(runAtom(runId));
  const project = useAtomValue(myIssuesRunProjectAtom(runId));
  if (!run || !project) return null;
  const statusLabel = localizeStatus(
    t,
    run.status,
    run.workflowStage,
    t(`status.${run.status}` as Parameters<typeof t>[0]),
  );
  const projectKey = formatIssueKey(project.issueKeyPrefix, run.runNumber);
  const assignee = run.assigneeUserId
    ? members.find((member) => member.userId === run.assigneeUserId)?.name ??
      run.assigneeUserId
    : null;
  const open = () => onOpen(project.id, run.id);
  return (
    <div
      aria-label={t("run.details", { title: run.title })}
      className="my-issues-reference-row issue-list-row"
      data-keyboard-list-item=""
      data-run-id={run.id}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      }}
      role="row"
      tabIndex={0}
    >
      <span className={`my-issues-reference-status status-${run.status}`} role="cell">
        <StatusIcon run={run} />
      </span>
      <span className="my-issues-reference-key" role="cell">
        <TeamIcon className="issue-list-project-icon" project={project} />
        {projectKey}
      </span>
      <span className="my-issues-reference-copy" role="cell">
        <span className="my-issues-reference-kicker">
          <i className={`source-dot ${run.source}`} />
          {statusLabel}
        </span>
        <strong>{run.title}</strong>
        {run.detail || run.issueDescription ? (
          <small>{run.detail || run.issueDescription}</small>
        ) : null}
      </span>
      <span className="my-issues-reference-badges" role="cell">
        {run.preferredProvider ? (
          <span className="my-issues-reference-badge provider">
            {providerLabel(run.preferredProvider)}
          </span>
        ) : null}
        {assignee ? (
          <span className="my-issues-reference-badge assignee">{assignee}</span>
        ) : null}
        <span className={`my-issues-reference-badge source ${run.source}`}>
          {t(`source.${run.source}` as Parameters<typeof t>[0])}
        </span>
        <PullRequestIconLink urls={run.pullRequestUrls} />
      </span>
      <span className="my-issues-reference-updated" role="cell">
        {relativeTime(run.updatedAt, t)}
      </span>
      <ChevronRight aria-hidden="true" className="my-issues-reference-arrow" size={17} />
    </div>
  );
});

export function MyIssuesList({
  bodyBefore,
  count,
  emptyContent,
  filteredEmptyContent,
  groups,
  hasUnfilteredIssues,
  isLoading,
  loadingLabel,
  members,
  onOpen,
  onQueryChange,
  onRetry,
  onScopeChange,
  onViewChange,
  projectFilter,
  propertyFilter,
  query,
  scope,
  searchPlaceholder,
  sidebarClosed,
  title,
  view,
}: {
  bodyBefore?: ReactNode;
  count: number;
  emptyContent: ReactNode;
  filteredEmptyContent: ReactNode;
  groups: readonly MyIssuesGroup[];
  hasUnfilteredIssues: boolean;
  isLoading: boolean;
  loadingLabel: string;
  members: readonly OrganizationMember[];
  onOpen: (projectId: string, runId: string) => void;
  onQueryChange: (query: string) => void;
  onRetry: () => void;
  onScopeChange: (scope: MyIssueScope) => void;
  onViewChange: (view: DashboardView) => void;
  projectFilter: ReactNode;
  propertyFilter: ReactNode;
  query: string;
  scope: MyIssueScope;
  searchPlaceholder: string;
  sidebarClosed: boolean;
  title: ReactNode;
  view: DashboardView;
}) {
  const { t } = useI18n();
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<MyIssuesGroupKey>>(
    () => new Set(),
  );

  const toggleGroup = (group: MyIssuesGroupKey) => {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  };

  const scopeTabs: Array<{ label: string; value: MyIssueScope }> = useMemo(
    () => [
      { label: t("myIssues.scope.assigned"), value: "assigned" },
      { label: t("myIssues.scope.created"), value: "created" },
      { label: t("myIssues.scope.subscribed"), value: "subscribed" },
      { label: t("myIssues.scope.activity"), value: "activity" },
    ],
    [t],
  );

  return (
    <div
      className={`my-issues-reference${sidebarClosed ? " sidebar-closed" : ""}`}
      id="my-issues-reference"
    >
      <PageHeader
        className={`app-page-header${sidebarClosed ? " sidebar-closed" : ""}`}
        data-tauri-drag-region="deep"
        title={
          <span className="queue-heading-copy">
            <span>{title}</span>
            <Typography
              as="span"
              className="queue-task-count"
              tone="muted"
              variant="caption"
            >
              {t("myIssues.count", { count })}
            </Typography>
          </span>
        }
      />
      <span className="visually-hidden" aria-live="polite">
        {t("myIssues.count", { count })}
      </span>
      <div className="my-issues-reference-scroll">
        <div className="my-issues-reference-toolbar">
          <nav aria-label={t("myIssues.scopeLabel")} className="my-issues-scope-tabs">
            {scopeTabs.map((tab) => (
              <button
                aria-pressed={scope === tab.value}
                className={scope === tab.value ? "active" : ""}
                key={tab.value}
                onClick={() => onScopeChange(tab.value)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </nav>
          <div className="my-issues-reference-tools">
            {propertyFilter}
            {projectFilter}
            <button
              aria-expanded={searchOpen}
              aria-label={t("myIssues.openSearch")}
              className={`my-issues-reference-tool-button${query ? " active" : ""}`}
              onClick={() => setSearchOpen((current) => !current)}
              title={t("myIssues.openSearch")}
              type="button"
            >
              <Search aria-hidden="true" size={17} />
            </button>
            <div className="my-issues-reference-view-switch" aria-label={t("dashboard.viewMode")} role="group">
              <button
                aria-label={t("dashboard.kanbanView")}
                aria-pressed={view === "kanban"}
                className={view === "kanban" ? "active" : ""}
                onClick={() => onViewChange("kanban")}
                title={t("dashboard.kanbanView")}
                type="button"
              >
                <Columns3 aria-hidden="true" size={16} />
              </button>
              <button
                aria-label={t("dashboard.listView")}
                aria-pressed={view === "list"}
                className={view === "list" ? "active" : ""}
                onClick={() => onViewChange("list")}
                title={t("dashboard.listView")}
                type="button"
              >
                <List aria-hidden="true" size={16} />
              </button>
            </div>
            <button
              aria-label={t("myIssues.retry")}
              className="my-issues-reference-retry visually-hidden"
              onClick={onRetry}
              title={t("myIssues.retry")}
              type="button"
            />
          </div>
          <label className={`my-issues-reference-search${searchOpen ? " is-open" : ""}`}>
            <Search aria-hidden="true" size={15} />
            <Input
              aria-label={searchPlaceholder}
              className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              placeholder={searchPlaceholder}
              value={query}
            />
          </label>
        </div>
        {bodyBefore}
        {isLoading ? (
          <div aria-busy="true" aria-live="polite" className="issues-loading-overlay" role="status">
            {loadingLabel}
          </div>
        ) : count === 0 ? (
          hasUnfilteredIssues ? filteredEmptyContent : emptyContent
        ) : (
          <div aria-label={t("myIssues.listLabel")} className="my-issues-reference-list" role="table">
            {groups.map(({ group, runIds }) => {
              const isCollapsed = collapsedGroups.has(group);
              const groupId = `my-issues-group-${group}`;
              return (
                <section aria-labelledby={groupId} className="my-issues-reference-group" key={group}>
                  <div className="my-issues-reference-group-header">
                    <button
                      aria-controls={`${groupId}-rows`}
                      aria-expanded={!isCollapsed}
                      className="my-issues-reference-group-toggle"
                      onClick={() => toggleGroup(group)}
                      type="button"
                    >
                      {isCollapsed ? <ChevronRight aria-hidden="true" size={17} /> : <ChevronDown aria-hidden="true" size={17} />}
                      <strong id={groupId}>{issueGroupLabel(t, group)}</strong>
                      <span>{runIds.length}</span>
                    </button>
                    <button
                      aria-label={t("myIssues.addToGroup", { group: issueGroupLabel(t, group) })}
                      className="my-issues-reference-group-add"
                      disabled
                      title={t("myIssues.addToGroup", { group: issueGroupLabel(t, group) })}
                      type="button"
                    >
                      <Plus aria-hidden="true" size={17} />
                    </button>
                  </div>
                  {!isCollapsed ? (
                    <div className="my-issues-reference-group-rows" id={`${groupId}-rows`} role="rowgroup">
                      {runIds.map((runId) => (
                        <MyIssuesRow
                          key={runId}
                          members={members}
                          onOpen={onOpen}
                          runId={runId}
                        />
                      ))}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
