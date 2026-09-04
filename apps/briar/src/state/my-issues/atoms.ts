import * as Atom from "effect/unstable/reactivity/Atom";

import type { HuntRun, OrganizationMember, Project } from "../../types";
import {
  emptyIssuePropertyFilters,
  runMatchesIssuePropertyFilters,
  selectedIssuePropertyFilterCount,
  statusFilterMatches,
  type DashboardView,
  type IssuePropertyFilters,
  type SourceFilter,
  type StatusFilter,
} from "../board/filters";
import { teamMembersAtom } from "../entities/members";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { teamEntityAtom } from "../entities/teams";
import { sameReferences, shallowArrayEqual } from "../entities/upsert";
import type { AtomRegistry } from "../registry";
import { userAtom } from "../session/atoms";
import {
  myIssuesGroupForRun,
  myIssuesGroupOrder,
  myIssuesSearchText,
  runBelongsToUser,
  runMatchesMyIssueScope,
  type MyIssueScope,
  type MyIssuesGroupKey,
} from "./model";

/*
  What "내 이슈" shows, derived from the store instead of from a record of
  payloads.

  The page loaded a `DashboardPayload` per project of the organization into a
  `useState` record and rendered run objects out of it, so a realtime edit to one
  issue rebuilt every list on the page and a run it had already drawn once lived
  in two places at the same time. `useMyIssuesSync` applies those responses
  through `applySyncEvent` now, and the atoms below publish ids: a run's title
  changing recomputes them into arrays that are element-wise identical, and the
  equalities stop the notification before it reaches the list. Each row reads
  `runAtom(runId)` itself.

  Scope. Like the board's, this view state is global rather than a family: there
  is one My issues page per window, it is unmounted when another page is shown,
  and it used to start from `useState` defaults every time — which is what
  `resetMyIssuesViewState` keeps.
*/

/** The search box text. */
export const myIssuesQueryAtom = Atom.make("").pipe(
  Atom.keepAlive,
  Atom.withLabel("myIssues/query"),
);

/** The issue source tab, shared with the board's filter vocabulary. */
export const myIssuesSourceAtom = Atom.make<SourceFilter>("all").pipe(
  Atom.keepAlive,
  Atom.withLabel("myIssues/source"),
);

/** The status tab. */
export const myIssuesStatusAtom = Atom.make<StatusFilter>("all").pipe(
  Atom.keepAlive,
  Atom.withLabel("myIssues/status"),
);

/** List or kanban. The page opens on the list. */
export const myIssuesViewAtom = Atom.make<DashboardView>("list").pipe(
  Atom.keepAlive,
  Atom.withLabel("myIssues/view"),
);

/** The scope tab: assigned, created, subscribed or activity. */
export const myIssuesScopeAtom = Atom.make<MyIssueScope>("assigned").pipe(
  Atom.keepAlive,
  Atom.withLabel("myIssues/scope"),
);

/** The property filter menu's selection. */
export const myIssuesPropertyFiltersAtom = Atom.make<IssuePropertyFilters>(
  emptyIssuePropertyFilters(),
).pipe(Atom.keepAlive, Atom.withLabel("myIssues/propertyFilters"));

/** The projects the filter menu selected. Empty means every project. */
export const myIssuesSelectedProjectIdsAtom = Atom.make<string[]>([]).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("myIssues/selectedProjectIds"),
);

/**
 * The organization's project ids the page covers, in the order the sidebar
 * lists them. Written by `useMyIssuesSync`, which also pins them against the
 * entity retention limit while the page is mounted.
 */
export const myIssuesTeamIdsAtom = Atom.make<string[]>([]).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("myIssues/teamIds"),
);

/** Projects whose board failed to load, which the page offers to retry. */
export const myIssuesFailedTeamIdsAtom = Atom.make<string[]>([]).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("myIssues/failedTeamIds"),
);

/** Whether a load pass is in flight. */
export const myIssuesLoadingAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("myIssues/loading"),
);

/**
 * The project composition the last completed pass loaded, so the page can tell
 * "still loading the first list" from "refreshing one it already drew".
 */
export const myIssuesLoadedKeyAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("myIssues/loadedKey"),
);

/** Bumped by the retry button to run another load pass over the same projects. */
export const myIssuesRetryAtom = Atom.make(0).pipe(
  Atom.keepAlive,
  Atom.withLabel("myIssues/retry"),
);

const defaultView: DashboardView = "list";
const defaultScope: MyIssueScope = "assigned";
const defaultStatus: StatusFilter = "all";
const defaultSource: SourceFilter = "all";

/**
 * Puts the page's view state back to the defaults mounting it used to produce
 * by construction. Fields already holding their default are left alone, so the
 * reset notifies nobody on a page that was never touched.
 */
export function resetMyIssuesViewState(registry: AtomRegistry) {
  if (registry.get(myIssuesQueryAtom) !== "") registry.set(myIssuesQueryAtom, "");
  if (registry.get(myIssuesSourceAtom) !== defaultSource) {
    registry.set(myIssuesSourceAtom, defaultSource);
  }
  if (registry.get(myIssuesStatusAtom) !== defaultStatus) {
    registry.set(myIssuesStatusAtom, defaultStatus);
  }
  if (registry.get(myIssuesViewAtom) !== defaultView) {
    registry.set(myIssuesViewAtom, defaultView);
  }
  if (registry.get(myIssuesScopeAtom) !== defaultScope) {
    registry.set(myIssuesScopeAtom, defaultScope);
  }
  if (registry.get(myIssuesSelectedProjectIdsAtom).length > 0) {
    registry.set(myIssuesSelectedProjectIdsAtom, []);
  }
  if (
    selectedIssuePropertyFilterCount(registry.get(myIssuesPropertyFiltersAtom)) >
    0
  ) {
    registry.set(myIssuesPropertyFiltersAtom, emptyIssuePropertyFilters());
  }
}

/** The project ids the current filter selection draws from. */
export const myIssuesVisibleTeamIdsAtom = Atom.make((get): string[] => {
  const teamIds = get(myIssuesTeamIdsAtom);
  const selected = get(myIssuesSelectedProjectIdsAtom);
  if (selected.length === 0) return teamIds;
  const selection = new Set(selected);
  return teamIds.filter((teamId) => selection.has(teamId));
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("myIssues/visibleTeamIds"),
);

const sameRunTeamIds = (
  left: ReadonlyMap<string, string>,
  right: ReadonlyMap<string, string>,
) => {
  if (left.size !== right.size) return false;
  for (const [runId, teamId] of left) {
    if (right.get(runId) !== teamId) return false;
  }
  return true;
};

/**
 * Which project each visible run belongs to.
 *
 * `HuntRun.teamId` is optional on the wire, so this is read from the stored
 * per-team id indexes rather than from the runs — the same reason
 * `entities/runs.ts` stores those indexes at all. It changes when a board gains
 * or loses a run, not when one is edited.
 */
export const myIssuesRunTeamIdsAtom = Atom.make(
  (get): ReadonlyMap<string, string> => {
    const byRunId = new Map<string, string>();
    for (const teamId of get(myIssuesVisibleTeamIdsAtom)) {
      for (const runId of get(teamRunIdsAtom(teamId)) ?? []) {
        if (!byRunId.has(runId)) byRunId.set(runId, teamId);
      }
    }
    return byRunId;
  },
).pipe(
  Atom.keepAlive,
  Atom.withEquality<ReadonlyMap<string, string>>(sameRunTeamIds),
  Atom.withLabel("myIssues/runTeamIds"),
);

/** The project one run is listed under, for its icon, key prefix and workflow. */
export const myIssuesRunProjectAtom = Atom.family((runId: string) =>
  Atom.make((get): Project | null => {
    const teamId = get(myIssuesRunTeamIdsAtom).get(runId);
    return teamId ? get(teamEntityAtom(teamId)) : null;
  }).pipe(Atom.withLabel(`myIssues/run/${runId}/project`)),
);

/**
 * Every run of the account across the visible projects, newest updated first
 * and narrowed by the scope tab. This is the list the "N issues" count and the
 * "you have nothing at all" empty state read.
 */
export const myIssuesScopedRunIdsAtom = Atom.make((get): string[] => {
  const userId = get(userAtom)?.id ?? null;
  if (!userId) return [];
  const scope = get(myIssuesScopeAtom);
  const runs = get(runsByIdAtom);
  const matched: HuntRun[] = [];
  for (const runId of get(myIssuesRunTeamIdsAtom).keys()) {
    const run = runs.get(runId);
    if (!run) continue;
    if (!runBelongsToUser(run, userId)) continue;
    if (!runMatchesMyIssueScope(run, scope, userId)) continue;
    matched.push(run);
  }
  return matched
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((run) => run.id);
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(sameReferences),
  Atom.withLabel("myIssues/scopedRunIds"),
);

/** Everything the search box, the source tab, the status tab and the menu narrow by. */
interface MyIssuesCriteria {
  readonly query: string;
  readonly source: SourceFilter;
  readonly status: StatusFilter;
  readonly propertyFilters: IssuePropertyFilters;
}

const myIssuesCriteriaAtom = Atom.make(
  (get): MyIssuesCriteria => ({
    query: get(myIssuesQueryAtom),
    source: get(myIssuesSourceAtom),
    status: get(myIssuesStatusAtom),
    propertyFilters: get(myIssuesPropertyFiltersAtom),
  }),
).pipe(Atom.keepAlive, Atom.withLabel("myIssues/criteria"));

/** The ids the list draws, filtered but in scope order. */
export const myIssuesFilteredRunIdsAtom = Atom.make((get): string[] => {
  const criteria = get(myIssuesCriteriaAtom);
  const normalizedQuery = criteria.query.trim().toLocaleLowerCase();
  const runs = get(runsByIdAtom);
  const teamIds = get(myIssuesRunTeamIdsAtom);
  const matched: string[] = [];
  for (const runId of get(myIssuesScopedRunIdsAtom)) {
    const run = runs.get(runId);
    if (!run) continue;
    if (criteria.source !== "all" && run.source !== criteria.source) continue;
    if (!runMatchesIssuePropertyFilters(run, criteria.propertyFilters)) continue;
    if (!statusFilterMatches(run, criteria.status)) continue;
    if (normalizedQuery) {
      const teamId = teamIds.get(runId);
      const project = teamId ? get(teamEntityAtom(teamId)) : null;
      if (
        !myIssuesSearchText(run, project)
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      ) {
        continue;
      }
    }
    matched.push(runId);
  }
  return matched;
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<string[]>(sameReferences),
  Atom.withLabel("myIssues/filteredRunIds"),
);

/** How many rows the list is showing, for the header count. */
export const myIssuesCountAtom = Atom.map(
  myIssuesFilteredRunIdsAtom,
  (runIds) => runIds.length,
).pipe(Atom.keepAlive, Atom.withLabel("myIssues/count"));

/** One section of the list: a bucket and the ids in it. */
export interface MyIssuesGroup {
  readonly group: MyIssuesGroupKey;
  readonly runIds: readonly string[];
}

const sameGroups = (
  left: readonly MyIssuesGroup[],
  right: readonly MyIssuesGroup[],
) =>
  left.length === right.length &&
  left.every(
    (section, index) =>
      section.group === right[index]!.group &&
      sameReferences(section.runIds, right[index]!.runIds),
  );

/**
 * The filtered ids grouped into the four sections, empty sections dropped. A
 * run whose status moves between buckets rebuilds two of them and leaves the
 * others identical.
 */
export const myIssuesGroupedRunIdsAtom = Atom.make(
  (get): readonly MyIssuesGroup[] => {
    const runs = get(runsByIdAtom);
    const buckets = new Map<MyIssuesGroupKey, string[]>(
      myIssuesGroupOrder.map((group) => [group, []]),
    );
    for (const runId of get(myIssuesFilteredRunIdsAtom)) {
      const run = runs.get(runId);
      if (!run) continue;
      buckets.get(myIssuesGroupForRun(run))?.push(runId);
    }
    return myIssuesGroupOrder.flatMap((group) => {
      const runIds = buckets.get(group) ?? [];
      return runIds.length > 0 ? [{ group, runIds }] : [];
    });
  },
).pipe(
  Atom.keepAlive,
  Atom.withEquality<readonly MyIssuesGroup[]>(sameGroups),
  Atom.withLabel("myIssues/groupedRunIds"),
);

/**
 * Every member of every visible project, deduplicated by user id. The page
 * resolves assignee names against it and the property filter menu offers it.
 */
export const myIssuesMembersAtom = Atom.make((get): OrganizationMember[] => {
  const byUserId = new Map<string, OrganizationMember>();
  for (const teamId of get(myIssuesVisibleTeamIdsAtom)) {
    for (const member of get(teamMembersAtom(teamId)) ?? []) {
      byUserId.set(member.userId, member);
    }
  }
  return [...byUserId.values()];
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<OrganizationMember[]>(shallowArrayEqual),
  Atom.withLabel("myIssues/members"),
);

/*
  What the kanban view needs and the list view does not.

  The kanban is `IssueCollection`, which still filters and groups a `HuntRun[]`
  of its own across several workflows at once. It is mounted only while that
  view is selected, so the list view — the one the page opens on — subscribes to
  ids alone and a run edit reaches one row.
*/

/** The account's runs as objects, for the kanban that still takes them. */
export const myIssuesScopedRunsAtom = Atom.make((get): HuntRun[] => {
  const runs = get(runsByIdAtom);
  const resolved: HuntRun[] = [];
  for (const runId of get(myIssuesScopedRunIdsAtom)) {
    const run = runs.get(runId);
    if (run) resolved.push(run);
  }
  return resolved;
}).pipe(
  Atom.withEquality<HuntRun[]>(shallowArrayEqual),
  Atom.withLabel("myIssues/scopedRuns"),
);

/** The project each listed run belongs to, for its icon and issue key. */
export const myIssuesRunProjectsAtom = Atom.make(
  (get): ReadonlyMap<string, Project> => {
    const teamIds = get(myIssuesRunTeamIdsAtom);
    const byRunId = new Map<string, Project>();
    for (const runId of get(myIssuesScopedRunIdsAtom)) {
      const teamId = teamIds.get(runId);
      const project = teamId ? get(teamEntityAtom(teamId)) : null;
      if (project) byRunId.set(runId, project);
    }
    return byRunId;
  },
).pipe(Atom.withLabel("myIssues/runProjects"));

/** The project ids that contributed a row, in list order. */
export const myIssuesRunProjectIdsAtom = Atom.make((get): string[] => {
  const teamIds = get(myIssuesRunTeamIdsAtom);
  const seen: string[] = [];
  const known = new Set<string>();
  for (const runId of get(myIssuesScopedRunIdsAtom)) {
    const teamId = teamIds.get(runId);
    if (!teamId || known.has(teamId)) continue;
    known.add(teamId);
    seen.push(teamId);
  }
  return seen;
}).pipe(
  Atom.withEquality<string[]>(shallowArrayEqual),
  Atom.withLabel("myIssues/runProjectIds"),
);
