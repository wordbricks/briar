import type {
  AutoHuntWorkflow,
  AutoHuntWorkflowCheckpoint,
} from "../../lib/auto-hunt-contract";
import { runMeta } from "../../lib/stages";
import type { HuntRun, HuntRunPlacement, TeamSettings } from "../../types";
import type { StatusFilter } from "./filters";

/*
  The kanban columns, as data.

  The board built these inside a `useMemo` that also localized every label, so
  the whole thing depended on the translator and could not move into an atom.
  Splitting it in two fixes that: this module decides which columns exist, in
  what order, and which run belongs to which — all from the team's settings and
  the status tab — while the component turns the ids below into text. The rules
  are the ones `IssueCollection` applied to the team board, including the single
  workflow shortcut (unprefixed `stage:` ids) it took when a board renders one
  team's workflow.
*/

/** What a column is named after, left for the view to localize. */
export type BoardColumnLabel =
  | { readonly kind: "status"; readonly status: HuntRunPlacement["status"] }
  | {
      readonly kind: "stage";
      readonly stageId: string;
      readonly fallbackLabel: string;
    };

/** A pause boundary drawn before a column. */
export interface BoardCheckpointMarker {
  readonly stageId: string;
  readonly fallbackLabel: string;
  readonly position: "before" | "after";
}

/** One kanban column, without its runs. */
export interface BoardColumnDefinition {
  readonly id: string;
  readonly label: BoardColumnLabel;
  readonly tone: string;
  readonly placement: HuntRunPlacement;
  readonly checkpointsBefore: readonly BoardCheckpointMarker[];
}

const statusColumn = (
  status: Exclude<HuntRunPlacement["status"], "running">,
  tone: string,
): BoardColumnDefinition => ({
  id: `status:${status}`,
  label: { kind: "status", status },
  tone,
  placement: { status, workflowStage: null },
  checkpointsBefore: [],
});

const leadingStatusColumns = (): BoardColumnDefinition[] => [
  statusColumn("backlog", "slate"),
  statusColumn("queued", "slate"),
];

const trailingStatusColumns = (): BoardColumnDefinition[] => [
  statusColumn("blocked", "rose"),
  statusColumn("failed", "red"),
  statusColumn("completed", "emerald"),
  statusColumn("cancelled", "slate"),
];

/** The column id a workflow stage renders under on a single workflow board. */
export const stageColumnId = (stageId: string) => `stage:${stageId}`;

/**
 * The stage columns of one workflow, with the effective checkpoints attached to
 * the boundary each marks. A checkpoint `after` the last stage has no column to
 * move to, so it stays on that stage — the behaviour the board shipped.
 */
function stageColumns(
  workflow: AutoHuntWorkflow,
  effectiveCheckpoints: readonly AutoHuntWorkflowCheckpoint[],
): BoardColumnDefinition[] {
  const markers = new Map<string, BoardCheckpointMarker[]>();
  const stages = workflow.stages;
  for (const checkpoint of effectiveCheckpoints) {
    const index = stages.findIndex((stage) => stage.id === checkpoint.stage);
    if (index < 0) continue;
    const boundary =
      stages[index + (checkpoint.position === "after" ? 1 : 0)] ?? stages[index];
    if (!boundary) continue;
    const stage = stages[index]!;
    const marker: BoardCheckpointMarker = {
      stageId: checkpoint.stage,
      fallbackLabel: stage.label,
      position: checkpoint.position,
    };
    markers.set(boundary.id, [...(markers.get(boundary.id) ?? []), marker]);
  }
  return stages.map((stage) => ({
    id: stageColumnId(stage.id),
    label: { kind: "stage", stageId: stage.id, fallbackLabel: stage.label },
    tone: runMeta("running", stage.id, workflow).tone,
    placement: { status: "running" as const, workflowStage: stage.id },
    checkpointsBefore: markers.get(stage.id) ?? [],
  }));
}

/** Whether the status tab keeps a column on the board. */
function columnVisibleForStatus(columnId: string, status: StatusFilter) {
  if (status === "active") {
    return !["status:completed", "status:cancelled"].includes(columnId);
  }
  if (status === "attention") {
    return (
      columnId.startsWith("stage:") ||
      ["status:blocked", "status:failed"].includes(columnId)
    );
  }
  if (status === "completed") {
    return ["status:completed", "status:cancelled"].includes(columnId);
  }
  return true;
}

/**
 * Every column the board shows for `settings` under the `status` tab. A team
 * whose settings have not loaded gets the status columns only, which is what
 * the board rendered while its workflow context was still undefined.
 */
export function boardColumnDefinitions(
  settings: TeamSettings | null,
  status: StatusFilter,
): BoardColumnDefinition[] {
  const workflow = settings?.workflow;
  const definitions = [
    ...leadingStatusColumns(),
    ...(workflow
      ? stageColumns(
          workflow,
          settings?.checkpointPolicy?.effective ??
            workflow.execution.checkpoints,
        )
      : []),
    ...trailingStatusColumns(),
  ];
  return definitions.filter((column) =>
    columnVisibleForStatus(column.id, status),
  );
}

/**
 * The column a run belongs in. Running and paused runs go to their workflow
 * stage, falling back to the first stage when the run names one the workflow
 * dropped, and to the queued column when there is no workflow at all.
 */
export function boardColumnIdForRun(
  run: HuntRun,
  workflow: AutoHuntWorkflow | null | undefined,
) {
  if (run.status !== "running" && run.status !== "paused") {
    return `status:${run.status}`;
  }
  const stages = workflow?.stages ?? [];
  const stageId = stages.some((stage) => stage.id === run.workflowStage)
    ? run.workflowStage
    : stages[0]?.id;
  return workflow && stageId ? stageColumnId(stageId) : "status:queued";
}

/**
 * Groups `runIds` into `definitions` by column, preserving their order. Ids
 * whose column is hidden by the status tab are dropped, exactly as the board's
 * `grouped.get(columnId)?.push(run)` did.
 */
export function groupRunIdsByColumn(
  runsById: ReadonlyMap<string, HuntRun>,
  runIds: readonly string[],
  definitions: readonly BoardColumnDefinition[],
  workflow: AutoHuntWorkflow | null | undefined,
): ReadonlyMap<string, string[]> {
  const grouped = new Map<string, string[]>(
    definitions.map((column) => [column.id, []]),
  );
  for (const id of runIds) {
    const run = runsById.get(id);
    if (!run) continue;
    grouped.get(boardColumnIdForRun(run, workflow))?.push(id);
  }
  return grouped;
}

/**
 * The attention tab hides stage columns that hold nothing, so the board is not
 * a wall of empty workflow columns when only a few runs need a look.
 */
export function visibleColumnIds(
  definitions: readonly BoardColumnDefinition[],
  grouped: ReadonlyMap<string, readonly string[]>,
  status: StatusFilter,
): string[] {
  return definitions
    .filter(
      (column) =>
        status !== "attention" ||
        !column.id.startsWith("stage:") ||
        (grouped.get(column.id)?.length ?? 0) > 0,
    )
    .map((column) => column.id);
}
