import * as Atom from "effect/unstable/reactivity/Atom";

import type { HuntRun } from "../../types";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { teamEntityAtom } from "../entities/teams";
import { sameReferences, shallowArrayEqual } from "../entities/upsert";
import { activePlanningProjectIdAtom } from "../dialogs/atoms";
import { companionStatusAtom } from "../navigation/atoms";
import { companionMode } from "../platform";
import type { AtomRegistry } from "../registry";
import {
  teamLoadedAtom,
  teamSettingsAtom,
} from "../team/atoms";
import {
  boardColumnDefinitions,
  groupRunIdsByColumn,
  visibleColumnIds,
  type BoardColumnDefinition,
} from "./columns";
import {
  emptyIssuePropertyFilters,
  filterRunIds,
  selectedIssuePropertyFilterCount,
  sortRunIdsByUpdatedDesc,
  statusFilterMatches,
  type BoardFilterCriteria,
  type DashboardView,
  type IssuePropertyFilters,
  type SourceFilter,
  type StatusFilter,
} from "./filters";

/*
  What the issue board shows, derived from the store instead of from run props.

  The board used to filter, sort, group and count a `HuntRun[]` the shell handed
  it, so every run edit rebuilt the whole board. The atoms here do the same work
  over `entities/runs`, and each one publishes only ids: a run's title changing
  recomputes them and produces arrays that are element-wise identical, so the
  equalities below stop the notification before it reaches a column. The cards
  read `runAtom(runId)` themselves, which is what makes an edit reach one card
  and nothing else.

  Scope. The board is one screen per window, so the view state below is global
  rather than a per-team family. That matches what it replaced — plain
  `useState` in a component that is unmounted when another page is shown and
  remounted with its defaults — which is why `resetBoardViewState` exists and
  the board calls it on mount. The property filters had a second rule of their
  own: an effect keyed on the team id cleared them on every team switch, so
  `resetBoardPropertyFilters` keeps that and the board calls it per team.
*/

/** The board's search box text. */
export const boardQueryAtom = Atom.make("").pipe(
  Atom.keepAlive,
  Atom.withLabel("board/query"),
);

/** The selected issue source tab, shared by the desktop and companion boards. */
export const boardSourceAtom = Atom.make<SourceFilter>("all").pipe(
  Atom.keepAlive,
  Atom.withLabel("board/source"),
);

/** The property filter menu's selection. */
export const boardPropertyFiltersAtom = Atom.make<IssuePropertyFilters>(
  emptyIssuePropertyFilters(),
).pipe(Atom.keepAlive, Atom.withLabel("board/propertyFilters"));

/** Kanban or list. Companion mode has neither and ignores this. */
export const boardViewAtom = Atom.make<DashboardView>("kanban").pipe(
  Atom.keepAlive,
  Atom.withLabel("board/view"),
);

/**
 * The desktop status tab. The companion board has its own, which lives in
 * `state/navigation` because the bottom bar sets it, so the two boards read
 * different atoms rather than one of them mirroring a prop into the other.
 */
export const boardStatusAtom = Atom.make<StatusFilter>("all").pipe(
  Atom.keepAlive,
  Atom.withLabel("board/status"),
);

/** The defaults a freshly mounted board starts from. */
const defaultView: DashboardView = "kanban";
const defaultStatus: StatusFilter = "all";
const defaultSource: SourceFilter = "all";

/**
 * Clears the property filter selection, which the board did on every team
 * switch. A selection that is already empty is left alone so the write does not
 * notify anybody with an equal value.
 */
export function resetBoardPropertyFilters(registry: AtomRegistry) {
  if (
    selectedIssuePropertyFilterCount(registry.get(boardPropertyFiltersAtom)) ===
    0
  ) {
    return;
  }
  registry.set(boardPropertyFiltersAtom, emptyIssuePropertyFilters());
}

/*
  Reload persistence.

  Mounting used to wipe the search box, the tabs and the kanban/list toggle,
  so a reload or a board refresh lost the slice of the list the user was
  looking at. The four fields are mirrored into localStorage per team and
  restored on mount instead of reset; a team switch still clears the property
  filters exactly as before. Storage failures (private mode, quota) are
  ignored: persistence is a convenience, never a reason to break the board.
*/
export type StoredBoardViewState = {
  readonly query: string;
  readonly source: SourceFilter;
  readonly status: StatusFilter;
  readonly view: DashboardView;
  readonly propertyFilters: IssuePropertyFilters;
};

const boardViewStorageKey = (teamId: string) => `briar:board-view:${teamId}`;

const storedSources: readonly SourceFilter[] = [
  "all",
  "issue",
  "error",
  "feedback",
];
const storedStatuses: readonly StatusFilter[] = [
  "all",
  "active",
  "attention",
  "completed",
];
const storedViews: readonly DashboardView[] = ["kanban", "list"];

const storedPropertyFilterKeys = [
  "status",
  "source",
  "priority",
  "assignee",
  "agent",
  "creator",
  "updated",
] as const;

function readStoredPropertyFilters(
  value: unknown,
): IssuePropertyFilters | null {
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  const filters = emptyIssuePropertyFilters();
  for (const key of storedPropertyFilterKeys) {
    const entries = candidate[key];
    if (
      !Array.isArray(entries) ||
      entries.some((entry) => typeof entry !== "string")
    ) {
      return null;
    }
    filters[key] = entries as string[];
  }
  return filters;
}

export function readStoredBoardViewState(
  teamId: string,
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): StoredBoardViewState | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(boardViewStorageKey(teamId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.query !== "string") return null;
    if (!storedSources.includes(candidate.source as SourceFilter)) return null;
    if (!storedStatuses.includes(candidate.status as StatusFilter)) {
      return null;
    }
    if (!storedViews.includes(candidate.view as DashboardView)) return null;
    const propertyFilters = readStoredPropertyFilters(
      candidate.propertyFilters,
    );
    if (!propertyFilters) return null;
    return {
      query: candidate.query,
      source: candidate.source as SourceFilter,
      status: candidate.status as StatusFilter,
      view: candidate.view as DashboardView,
      propertyFilters,
    };
  } catch {
    return null;
  }
}

/** Remembers the board's current view state for the team's next mount. */
export function persistBoardViewState(
  registry: AtomRegistry,
  teamId: string,
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): void {
  if (!storage || !teamId) return;
  const state: StoredBoardViewState = {
    query: registry.get(boardQueryAtom),
    source: registry.get(boardSourceAtom),
    status: registry.get(boardStatusAtom),
    view: registry.get(boardViewAtom),
    propertyFilters: registry.get(boardPropertyFiltersAtom),
  };
  try {
    storage.setItem(boardViewStorageKey(teamId), JSON.stringify(state));
  } catch {
    // Storage is best effort; the board keeps working without it.
  }
}

/**
 * Applies the team's remembered view state. Returns false when nothing was
 * stored, so the caller can fall back to the defaults.
 */
export function restoreBoardViewState(
  registry: AtomRegistry,
  teamId: string,
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): boolean {
  const stored = readStoredBoardViewState(teamId, storage);
  if (!stored) return false;
  if (registry.get(boardQueryAtom) !== stored.query) {
    registry.set(boardQueryAtom, stored.query);
  }
  if (registry.get(boardSourceAtom) !== stored.source) {
    registry.set(boardSourceAtom, stored.source);
  }
  if (registry.get(boardStatusAtom) !== stored.status) {
    registry.set(boardStatusAtom, stored.status);
  }
  if (registry.get(boardViewAtom) !== stored.view) {
    registry.set(boardViewAtom, stored.view);
  }
  if (
    selectedIssuePropertyFilterCount(
      registry.get(boardPropertyFiltersAtom),
    ) !==
      selectedIssuePropertyFilterCount(stored.propertyFilters) ||
    JSON.stringify(registry.get(boardPropertyFiltersAtom)) !==
      JSON.stringify(stored.propertyFilters)
  ) {
    registry.set(boardPropertyFiltersAtom, stored.propertyFilters);
  }
  return true;
}

/**
 * Puts the board's view state back to its defaults, which is what mounting the
 * board used to do by construction. Fields that already hold their default are
 * left alone.
 */
export function resetBoardViewState(registry: AtomRegistry) {
  if (registry.get(boardQueryAtom) !== "") registry.set(boardQueryAtom, "");
  if (registry.get(boardSourceAtom) !== defaultSource) {
    registry.set(boardSourceAtom, defaultSource);
  }
  if (registry.get(boardStatusAtom) !== defaultStatus) {
    registry.set(boardStatusAtom, defaultStatus);
  }
  if (registry.get(boardViewAtom) !== defaultView) {
    registry.set(boardViewAtom, defaultView);
  }
  resetBoardPropertyFilters(registry);
}

/** Whether the team's payload has arrived; `false` is the board's loading state. */
export const boardLoadedAtom = Atom.family((teamId: string) =>
  Atom.make(
    (get) =>
      get(teamLoadedAtom(teamId)) &&
      get(teamRunIdsAtom(teamId)) !== null,
  ).pipe(Atom.withLabel(`board/${teamId}/loaded`)),
);

/**
 * The team's run ids narrowed to the selected planning project, which is the
 * list the status tab counts and every filter starts from.
 */
export const boardScopedRunIdsAtom = Atom.family((teamId: string) =>
  Atom.make((get): string[] => {
    const ids = get(teamRunIdsAtom(teamId));
    if (!ids) return [];
    const projectId = get(activePlanningProjectIdAtom);
    if (!projectId) return ids;
    const runs = get(runsByIdAtom);
    return ids.filter((id) => runs.get(id)?.projectId === projectId);
  }).pipe(
    Atom.withEquality<string[]>(sameReferences),
    Atom.withLabel(`board/${teamId}/scopedIds`),
  ),
);

/** The counts behind the four status tabs. */
export interface BoardStatusCounts {
  readonly all: number;
  readonly active: number;
  readonly attention: number;
  readonly completed: number;
}

const sameCounts = (left: BoardStatusCounts, right: BoardStatusCounts) =>
  left.all === right.all &&
  left.active === right.active &&
  left.attention === right.attention &&
  left.completed === right.completed;

export const boardStatusCountsAtom = Atom.family((teamId: string) =>
  Atom.make((get): BoardStatusCounts => {
    const ids = get(boardScopedRunIdsAtom(teamId));
    const runs = get(runsByIdAtom);
    let active = 0;
    let attention = 0;
    let completed = 0;
    for (const id of ids) {
      const run = runs.get(id);
      if (!run) continue;
      if (statusFilterMatches(run, "active")) active += 1;
      if (statusFilterMatches(run, "attention")) attention += 1;
      if (statusFilterMatches(run, "completed")) completed += 1;
    }
    return { all: ids.length, active, attention, completed };
  }).pipe(
    Atom.withEquality<BoardStatusCounts>(sameCounts),
    Atom.withLabel(`board/${teamId}/counts`),
  ),
);

/** The criteria the desktop board narrows by. */
export const boardCriteriaAtom = Atom.family((teamId: string) =>
  Atom.make(
    (get): BoardFilterCriteria => ({
      query: get(boardQueryAtom),
      source: get(boardSourceAtom),
      status: get(boardStatusAtom),
      propertyFilters: get(boardPropertyFiltersAtom),
      issueKeyPrefix: get(teamEntityAtom(teamId))?.issueKeyPrefix,
    }),
  ).pipe(Atom.withLabel(`board/${teamId}/criteria`)),
);

/**
 * The ids the desktop board renders, filtered but in store order. This is the
 * atom the board's "N tasks" count and its list view read.
 */
export const boardRunIdsAtom = Atom.family((teamId: string) =>
  Atom.make((get): string[] =>
    filterRunIds(
      get(runsByIdAtom),
      get(boardScopedRunIdsAtom(teamId)),
      get(boardCriteriaAtom(teamId)),
    ),
  ).pipe(
    Atom.withEquality<string[]>(sameReferences),
    Atom.withLabel(`board/${teamId}/runIds`),
  ),
);

/** How many issues survive the filters, for the header count. */
export const boardRunCountAtom = Atom.family((teamId: string) =>
  Atom.map(boardRunIdsAtom(teamId), (ids) => ids.length).pipe(
    Atom.withLabel(`board/${teamId}/runCount`),
  ),
);

/**
 * The companion Tasks stream: the same source and property filters, the status
 * the bottom bar picked, no search box, and newest updated first.
 */
export const companionRunIdsAtom = Atom.family((teamId: string) =>
  Atom.make((get): string[] => {
    const runs = get(runsByIdAtom);
    const ids = filterRunIds(runs, get(boardScopedRunIdsAtom(teamId)), {
      query: "",
      source: get(boardSourceAtom),
      status: get(companionStatusAtom),
      propertyFilters: get(boardPropertyFiltersAtom),
    });
    // The paged mobile endpoint already returns its keyset order. Sorting the
    // accumulated ids again would let a later page move earlier rows around.
    return companionMode ? ids : sortRunIdsByUpdatedDesc(runs, ids);
  }).pipe(
    Atom.withEquality<string[]>(sameReferences),
    Atom.withLabel(`board/${teamId}/companionRunIds`),
  ),
);

/*
  Every field a column renders is compared, the stage's own label included: two
  workflows can name the same stage id differently, and a comparison that
  stopped at the id would leave the old name on the column header.
*/
const sameLabel = (
  left: BoardColumnDefinition["label"],
  right: BoardColumnDefinition["label"],
) =>
  left.kind === "status"
    ? right.kind === "status" && left.status === right.status
    : right.kind === "stage" &&
      left.stageId === right.stageId &&
      left.fallbackLabel === right.fallbackLabel;

const sameDefinitions = (
  left: readonly BoardColumnDefinition[],
  right: readonly BoardColumnDefinition[],
) =>
  left.length === right.length &&
  left.every((column, index) => {
    const other = right[index]!;
    return (
      column.id === other.id &&
      column.tone === other.tone &&
      sameLabel(column.label, other.label) &&
      column.checkpointsBefore.length === other.checkpointsBefore.length &&
      column.checkpointsBefore.every((marker, markerIndex) => {
        const otherMarker = other.checkpointsBefore[markerIndex]!;
        return (
          marker.stageId === otherMarker.stageId &&
          marker.position === otherMarker.position &&
          marker.fallbackLabel === otherMarker.fallbackLabel
        );
      })
    );
  });

/**
 * Every kanban column of the desktop board, in order and before the attention
 * tab drops the empty stage ones. It depends on the team's settings and the
 * status tab only, so no run change rebuilds it.
 */
export const boardColumnDefinitionsAtom = Atom.family((teamId: string) =>
  Atom.make((get): BoardColumnDefinition[] =>
    boardColumnDefinitions(get(teamSettingsAtom(teamId)), get(boardStatusAtom)),
  ).pipe(
    Atom.withEquality<BoardColumnDefinition[]>(sameDefinitions),
    Atom.withLabel(`board/${teamId}/columns`),
  ),
);

/*
  The grouping is rebuilt whenever any run changes, because a run's status is
  what decides its column. Comparing it column by column is what keeps a run
  edit that moved nothing from reaching the kanban, whose keyboard order is this
  map flattened.
*/
const sameGrouping = (
  left: ReadonlyMap<string, string[]>,
  right: ReadonlyMap<string, string[]>,
) => {
  if (left.size !== right.size) return false;
  for (const [columnId, ids] of left) {
    const other = right.get(columnId);
    if (!other || !sameReferences(ids, other)) return false;
  }
  return true;
};

/** The filtered ids grouped by column id. */
export const boardGroupedRunIdsAtom = Atom.family((teamId: string) =>
  Atom.make((get): ReadonlyMap<string, string[]> =>
    groupRunIdsByColumn(
      get(runsByIdAtom),
      get(boardRunIdsAtom(teamId)),
      get(boardColumnDefinitionsAtom(teamId)),
      get(teamSettingsAtom(teamId))?.workflow,
    ),
  ).pipe(
    Atom.withEquality<ReadonlyMap<string, string[]>>(sameGrouping),
    Atom.withLabel(`board/${teamId}/grouped`),
  ),
);

/** The column ids the board draws, after the attention tab's empty-stage rule. */
export const boardVisibleColumnIdsAtom = Atom.family((teamId: string) =>
  Atom.make((get): string[] =>
    visibleColumnIds(
      get(boardColumnDefinitionsAtom(teamId)),
      get(boardGroupedRunIdsAtom(teamId)),
      get(boardStatusAtom),
    ),
  ).pipe(
    Atom.withEquality<string[]>(sameReferences),
    Atom.withLabel(`board/${teamId}/visibleColumnIds`),
  ),
);

/*
  `Atom.family` keys on one argument, and the two families below are keyed by a
  team plus a second id. A separator neither id can hold joins them, so the
  first occurrence always splits the pair back apart.
*/
const keySeparator = "\u0000";

/** The `boardColumnRunIdsAtom` key for one column of one team's board. */
export const boardColumnKey = (teamId: string, columnId: string) =>
  `${teamId}${keySeparator}${columnId}`;

/** Splits a key made by {@link boardColumnKey} or {@link boardRunKey}. */
export function splitBoardKey(key: string): [teamId: string, id: string] {
  const separator = key.indexOf(keySeparator);
  return [key.slice(0, separator), key.slice(separator + 1)];
}

const emptyRunIds: readonly string[] = [];

/**
 * One column's run ids. Each column subscribes to its own, so a run that moves
 * between two columns re-renders those two and leaves the rest alone.
 */
export const boardColumnRunIdsAtom = Atom.family((key: string) => {
  const [teamId, columnId] = splitBoardKey(key);
  return Atom.map(
    boardGroupedRunIdsAtom(teamId),
    (grouped): readonly string[] => grouped.get(columnId) ?? emptyRunIds,
  ).pipe(
    Atom.withEquality<readonly string[]>(shallowArrayEqual),
    Atom.withLabel(`board/${teamId}/column/${columnId}`),
  );
});

/** The `boardRunAtom` key for one run on one team's board. */
export const boardRunKey = (teamId: string, runId: string) =>
  `${teamId}${keySeparator}${runId}`;

/**
 * One run, resolved only while the board's scope still holds it. The board
 * looked its open issue up with `runs.find(...)` over the same scoped list, so
 * an issue that leaves the team or the selected planning project closes.
 */
export const boardRunAtom = Atom.family((key: string) => {
  const [teamId, runId] = splitBoardKey(key);
  return Atom.make((get): HuntRun | null => {
    if (!get(boardScopedRunIdsAtom(teamId)).includes(runId)) return null;
    return get(runsByIdAtom).get(runId) ?? null;
  }).pipe(Atom.withLabel(`board/${teamId}/run/${runId}`));
});
