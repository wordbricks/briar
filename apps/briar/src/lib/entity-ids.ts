/**
 * Nominal (branded) id types for the two entities that PR #1490 left sharing
 * the word "project".
 *
 * - {@link TeamId} is an execution boundary: `briar_teams.id`. It is still
 *   stored in columns literally named `project_id` (for example
 *   `briar_hunt_runs.project_id`, `briar_project_agents.project_id`) and is
 *   also exposed as the newer `team_id` alias.
 * - {@link PlanningProjectId} is a lightweight planning entity:
 *   `briar_planning_projects.id`, stored in
 *   `briar_hunt_runs.planning_project_id`.
 *
 * `briar_hunt_runs` carries all three columns side by side, so the two
 * concepts are one typo apart. Branding them makes the compiler tell them
 * apart without renaming the ~5,300 `projectId` identifiers in the codebase.
 *
 * Both brands erase to a plain `string` at runtime: the brand lives only in
 * the type system, so there is no wrapper, no allocation, and no protobuf or
 * D1 change.
 */

declare const teamIdBrand: unique symbol;
declare const planningProjectIdBrand: unique symbol;

/** `briar_teams.id` — the execution boundary, a.k.a. the legacy "project". */
export type TeamId = string & { readonly [teamIdBrand]: true };

/** `briar_planning_projects.id` — the post-#1490 planning "project". */
export type PlanningProjectId = string & {
  readonly [planningProjectIdBrand]: true;
};

/**
 * The optional-`never` members stop an already-branded id of the *other*
 * concept from being laundered through the constructor: `asTeamId(planningId)`
 * is a compile error, while `asTeamId(rawString)` and `asTeamId(teamId)` are
 * both fine.
 */
type NotPlanningProjectId = { readonly [planningProjectIdBrand]?: never };
type NotTeamId = { readonly [teamIdBrand]?: never };

/**
 * A parameter position that means "Team id" but is still reached by plenty of
 * unbranded `string` call sites. It accepts a plain `string` and a
 * {@link TeamId}, and rejects a {@link PlanningProjectId}.
 *
 * Use it where tightening the parameter all the way to `TeamId` would force a
 * cascade through hundreds of call sites in one change: the direction that
 * actually causes bugs — a planning Project id landing in a Team slot — is
 * still a compile error.
 */
export type TeamIdLike = string & NotPlanningProjectId;

/** The mirror of {@link TeamIdLike} for planning Project id parameters. */
export type PlanningProjectIdLike = string & NotTeamId;

/**
 * Narrow construction point for a Team id. Call this at a true system edge —
 * a decoded protobuf request field, a D1 row that is not yet typed — rather
 * than scattering `as TeamId` casts.
 */
export const asTeamId = (value: string & NotPlanningProjectId): TeamId =>
  value as TeamId;

/** Narrow construction point for a planning Project id. See {@link asTeamId}. */
export const asPlanningProjectId = (
  value: string & NotTeamId,
): PlanningProjectId => value as PlanningProjectId;

/** Nullable convenience wrappers for D1 columns and optional request fields. */
export const asTeamIdOrNull = <T extends string & NotPlanningProjectId>(
  value: T | null | undefined,
): TeamId | null => (value == null ? null : asTeamId(value));

export const asPlanningProjectIdOrNull = <T extends string & NotTeamId>(
  value: T | null | undefined,
): PlanningProjectId | null => (value == null ? null : asPlanningProjectId(value));
