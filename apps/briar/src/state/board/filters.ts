import type { CompanionStatusFilter } from "../../components/CompanionBottomNavigation";
import { formatIssueKey } from "../../lib/issue-key";
import type { HuntRun, HuntSource } from "../../types";

/*
  What the issue board shows, as pure predicates.

  These used to live in `components/hunt/model/filters.ts` next to the board and
  ran inside a `useMemo` over the run objects the shell handed down. The derived
  atoms in `./atoms.ts` need the same rules over the normalized store, so the
  rules moved here and the components import them from the state layer. Nothing
  in this file reads an atom: everything takes the run and the criteria.
*/

export type SourceFilter = "all" | HuntSource;
export type StatusFilter = CompanionStatusFilter;
export type DashboardView = "kanban" | "list";

export interface IssuePropertyFilters {
  status: string[];
  source: string[];
  priority: string[];
  assignee: string[];
  agent: string[];
  creator: string[];
  /** {@link IssueUpdatedBucket} values, matched against `HuntRun.updatedAt`. */
  updated: string[];
}

export type IssuePropertyFilterKey = keyof IssuePropertyFilters;

export const unsetIssuePropertyFilterValue = "__unset__";

export function emptyIssuePropertyFilters(): IssuePropertyFilters {
  return {
    status: [],
    source: [],
    priority: [],
    assignee: [],
    agent: [],
    creator: [],
    updated: [],
  };
}

/*
  The "last updated" property filter. The buckets do not overlap, so they
  combine with OR like every other multi-select property: whole elapsed days
  since `updatedAt` decide the bucket, which keeps "1-7 days" and "8-30 days"
  apart at the day boundary.
*/
export const issueUpdatedBuckets = [
  "last24h",
  "days1to7",
  "days8to30",
  "over30d",
] as const;

export type IssueUpdatedBucket = (typeof issueUpdatedBuckets)[number];

const dayMs = 24 * 60 * 60 * 1000;

/**
 * The bucket `updatedAt` falls in as of `now`, or null when the timestamp does
 * not parse. A timestamp slightly in the future (clock skew) counts as the last
 * 24 hours.
 */
export function issueUpdatedBucketOf(
  updatedAt: string | null | undefined,
  now: number,
): IssueUpdatedBucket | null {
  if (!updatedAt) return null;
  const updated = Date.parse(updatedAt);
  if (Number.isNaN(updated)) return null;
  const elapsedDays = Math.floor(Math.max(0, now - updated) / dayMs);
  if (elapsedDays < 1) return "last24h";
  if (elapsedDays <= 7) return "days1to7";
  if (elapsedDays <= 30) return "days8to30";
  return "over30d";
}

export function propertyFilterMatches(
  selected: readonly string[],
  value: string | null | undefined,
) {
  return (
    selected.length === 0 ||
    selected.includes(value ?? unsetIssuePropertyFilterValue)
  );
}

export function runMatchesIssuePropertyFilters(
  run: HuntRun,
  filters: IssuePropertyFilters,
  now: number = Date.now(),
) {
  return (
    propertyFilterMatches(filters.status, run.status) &&
    propertyFilterMatches(filters.source, run.source) &&
    propertyFilterMatches(
      filters.priority,
      run.priority === null ? null : String(run.priority),
    ) &&
    propertyFilterMatches(filters.assignee, run.assigneeUserId) &&
    propertyFilterMatches(filters.agent, run.agentId) &&
    propertyFilterMatches(filters.creator, run.createdByUserId) &&
    (filters.updated.length === 0 ||
      filters.updated.includes(issueUpdatedBucketOf(run.updatedAt, now) ?? ""))
  );
}

export function selectedIssuePropertyFilterCount(filters: IssuePropertyFilters) {
  return Object.values(filters).reduce(
    (count, selected) => count + selected.length,
    0,
  );
}

export function toggleIssuePropertyFilterValue(
  filters: IssuePropertyFilters,
  key: IssuePropertyFilterKey,
  value: string,
) {
  const selected = filters[key];
  return {
    ...filters,
    [key]: selected.includes(value)
      ? selected.filter((candidate) => candidate !== value)
      : [...selected, value],
  };
}

/** Whether a run belongs to one of the four status tabs. */
export function statusFilterMatches(run: HuntRun, status: StatusFilter) {
  if (status === "active") {
    return !["completed", "cancelled"].includes(run.status);
  }
  if (status === "attention") {
    return ["paused", "blocked", "failed"].includes(run.status);
  }
  if (status === "completed") {
    return ["completed", "cancelled"].includes(run.status);
  }
  return true;
}

/**
 * The text the board's search box matches against. The fields and their order
 * are what the board joined inline, and empty ones are dropped so a missing
 * detail does not introduce a double space that a query could never match.
 */
export function runSearchText(run: HuntRun, issueKeyPrefix?: string) {
  return [
    run.title,
    run.detail,
    run.issueDescription,
    run.sourceKey,
    run.repository,
    formatIssueKey(issueKeyPrefix, run.runNumber),
  ]
    .filter(Boolean)
    .join(" ");
}

/** Everything the board narrows its runs by, in one value. */
export interface BoardFilterCriteria {
  /** The search box text, unnormalized. An empty string matches everything. */
  readonly query: string;
  readonly source: SourceFilter;
  readonly status: StatusFilter;
  readonly propertyFilters: IssuePropertyFilters;
  /** The team's issue key prefix, which the search text includes. */
  readonly issueKeyPrefix?: string | undefined;
}

/** `criteria.query` in the form {@link runMatchesBoardFilters} compares with. */
export const normalizeBoardQuery = (query: string) =>
  query.trim().toLocaleLowerCase();

/**
 * Whether one run survives every board filter. `normalizedQuery` is passed in
 * rather than derived so a list pass normalizes once.
 */
export function runMatchesBoardFilters(
  run: HuntRun,
  criteria: BoardFilterCriteria,
  normalizedQuery = normalizeBoardQuery(criteria.query),
) {
  if (criteria.source !== "all" && run.source !== criteria.source) return false;
  if (!runMatchesIssuePropertyFilters(run, criteria.propertyFilters)) {
    return false;
  }
  if (!statusFilterMatches(run, criteria.status)) return false;
  if (!normalizedQuery) return true;
  return runSearchText(run, criteria.issueKeyPrefix)
    .toLocaleLowerCase()
    .includes(normalizedQuery);
}

/**
 * The ids of `runIds` whose runs pass `criteria`, in the same order. Ids whose
 * run is not in the store are dropped, which is what resolving the list against
 * the store did before.
 */
export function filterRunIds(
  runsById: ReadonlyMap<string, HuntRun>,
  runIds: readonly string[],
  criteria: BoardFilterCriteria,
): string[] {
  const normalizedQuery = normalizeBoardQuery(criteria.query);
  const matched: string[] = [];
  for (const id of runIds) {
    const run = runsById.get(id);
    if (run && runMatchesBoardFilters(run, criteria, normalizedQuery)) {
      matched.push(id);
    }
  }
  return matched;
}

/**
 * Newest updated first, which is the order the companion Tasks list shows and
 * the only place the board re-sorts what the store handed it.
 */
export function sortRunIdsByUpdatedDesc(
  runsById: ReadonlyMap<string, HuntRun>,
  runIds: readonly string[],
): string[] {
  return [...runIds].sort((left, right) => {
    const leftRun = runsById.get(left);
    const rightRun = runsById.get(right);
    if (!leftRun || !rightRun) return 0;
    return rightRun.updatedAt.localeCompare(leftRun.updatedAt);
  });
}
