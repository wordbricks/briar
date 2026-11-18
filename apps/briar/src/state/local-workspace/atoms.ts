import * as Atom from "effect/unstable/reactivity/Atom";

import type { AutoHuntHealth, RepositoryReadiness } from "../../generated/tauri";
import { demoDashboard, demoRepositoryReadiness } from "../../lib/demo-data";
import {
  localTeamConnectionState,
  type LocalProjectInventoryObservation,
  type LocalTeamConnectionState,
  type LocalTeamReadinessObservation,
} from "../../lib/local-team-connection";
import { demoMode } from "../platform";
import type { AtomRegistry } from "../registry";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";

/*
  What this machine knows about the repositories behind the account's teams.

  A team is account state; a repository connection is device state. These four
  atoms are the device half: which teams this desktop has connected, whether
  reading that list failed, the health of the connected team's local install,
  and the readiness of each team's checkout.

  They were seven `useState`s in `useBriar` — `health` / `healthError` /
  `healthLoading` and `projectReadiness` / `projectReadinessError` /
  `projectReadinessLoadingProjects` were separate containers that always moved
  together, so a probe wrote three of them and every intermediate render showed
  a combination the code never intended. Each is one value now, and the readiness
  triple is a family keyed by team so one team's probe cannot re-render the views
  watching another's.
*/

const demoTeamId = demoMode ? demoDashboard.team.id : null;

/**
 * Teams whose repository is connected to this device, or `null` while the
 * inventory is unknown — before the first read, on a platform that has no local
 * inventory, or after one failed. `null` is not "none": the difference decides
 * whether the UI may claim a team is disconnected.
 */
export const connectedTeamIdsAtom = Atom.make<string[] | null>(
  demoMode ? [demoDashboard.team.id] : null,
).pipe(Atom.keepAlive, Atom.withLabel("workspace/connectedTeamIds"));

/**
 * Why the local inventory could not be read. The facade folds it into
 * `appErrorAtom` together with the session error.
 */
export const localInventoryErrorAtom = Atom.make<string | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("workspace/localInventoryError"),
);

/** The local install probe for the selected team, as one value. */
export type WorkspaceHealth = {
  /** `loading` keeps the previous value on screen, exactly as the flag did. */
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly value: AutoHuntHealth | null;
  readonly error: string | null;
};

/** Nothing probed: no team selected, or none connected to this device. */
export const idleWorkspaceHealth: WorkspaceHealth = {
  status: "idle",
  value: null,
  error: null,
};

const sameHealth = (left: WorkspaceHealth, right: WorkspaceHealth) =>
  left.status === right.status &&
  left.value === right.value &&
  left.error === right.error;

/** The health probe for the selected team. */
export const healthAtom = Atom.make<WorkspaceHealth>(idleWorkspaceHealth).pipe(
  Atom.keepAlive,
  Atom.withEquality<WorkspaceHealth>(sameHealth),
  Atom.withLabel("workspace/health"),
);

/** One team's repository readiness probe. */
export type TeamReadiness = {
  readonly readiness: RepositoryReadiness | null;
  readonly error: string | null;
  readonly loading: boolean;
};

/** Never probed, or probed and cleared. */
export const idleTeamReadiness: TeamReadiness = {
  readiness: null,
  error: null,
  loading: false,
};

const sameReadiness = (left: TeamReadiness, right: TeamReadiness) =>
  left.readiness === right.readiness &&
  left.error === right.error &&
  left.loading === right.loading;

/**
 * A team's repository readiness, its last probe error and whether a probe is in
 * flight. Keyed by team, so the settings dialog of one team is untouched by a
 * probe of another — the three record-shaped `useState`s it replaces notified
 * every reader on every probe.
 */
export const teamReadinessAtom = Atom.family((teamId: string) =>
  Atom.make<TeamReadiness>(
    teamId === demoTeamId
      ? { readiness: demoRepositoryReadiness, error: null, loading: false }
      : idleTeamReadiness,
  ).pipe(
    Atom.keepAlive,
    Atom.withEquality<TeamReadiness>(sameReadiness),
    Atom.withLabel(`workspace/${teamId}/readiness`),
  ),
);

/**
 * Whether the selected team's repository is connected to this device. `unknown`
 * covers both "no team selected" and "inventory not read yet".
 */
export const activeTeamConnectionStateAtom = Atom.make(
  (get): LocalTeamConnectionState =>
    localTeamConnectionState(get(connectedTeamIdsAtom), get(activeTeamIdAtom)),
).pipe(Atom.keepAlive, Atom.withLabel("workspace/activeConnectionState"));

/*
  The three record shaped projections the readiness views read. They exist only
  so `App.tsx` keeps compiling while its views move to the family above one at a
  time, and they die with the facade. Each keeps its previous instance when the
  contents did not change, because `App.tsx` lists them in dependency arrays.
*/

const sameRecord = <T>(
  left: Readonly<Record<string, T>>,
  right: Readonly<Record<string, T>>,
) => {
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => left[key] === right[key])
  );
};

/** Readiness values keyed by team id, as the facade returns them. */
export type TeamReadinessRecord = Readonly<Record<string, RepositoryReadiness>>;
/** Readiness probe failures keyed by team id, as the facade returns them. */
export type TeamReadinessErrorRecord = Readonly<Record<string, string>>;

/** Every team with a known repository readiness, keyed by team id. */
export const teamReadinessRecordAtom = Atom.make((get) => {
  const record: Record<string, RepositoryReadiness> = {};
  for (const team of get(teamsAtom)) {
    const readiness = get(teamReadinessAtom(team.id)).readiness;
    if (readiness) record[team.id] = readiness;
  }
  return record satisfies TeamReadinessRecord;
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<TeamReadinessRecord>(sameRecord),
  Atom.withLabel("workspace/readinessRecord"),
);

/** Every team whose last readiness probe failed, keyed by team id. */
export const teamReadinessErrorRecordAtom = Atom.make((get) => {
  const record: Record<string, string> = {};
  for (const team of get(teamsAtom)) {
    const error = get(teamReadinessAtom(team.id)).error;
    if (error !== null) record[team.id] = error;
  }
  return record satisfies TeamReadinessErrorRecord;
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<TeamReadinessErrorRecord>(sameRecord),
  Atom.withLabel("workspace/readinessErrorRecord"),
);

const sameIdSet = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left.size === right.size && [...left].every((id) => right.has(id));

/** Every team with a readiness probe in flight. */
export const readinessLoadingTeamIdsAtom = Atom.make(
  (get): ReadonlySet<string> => {
    const loading = new Set<string>();
    for (const team of get(teamsAtom)) {
      if (get(teamReadinessAtom(team.id)).loading) loading.add(team.id);
    }
    return loading;
  },
).pipe(
  Atom.keepAlive,
  Atom.withEquality<ReadonlySet<string>>(sameIdSet),
  Atom.withLabel("workspace/readinessLoadingTeamIds"),
);

/*
  Writers. They are plain registry functions rather than actions because the
  sync hook, the readiness coordinator and the workspace actions all perform the
  same transitions, and the identity preserving rules below have to be the same
  wherever they happen.
*/

/**
 * Replaces the inventory, keeping the previous array when it lists the same
 * teams. `connectedTeamIds` is a dependency of the schedule runner and the
 * workflow mirror, so a re-read that changed nothing must not restart them.
 */
export function setConnectedTeamIds(
  registry: AtomRegistry,
  next: string[] | null,
): string[] | null {
  const current = registry.get(connectedTeamIdsAtom);
  if (current === next) return current;
  if (
    current &&
    next &&
    current.length === next.length &&
    current.every((teamId) => next.includes(teamId))
  ) {
    return current;
  }
  registry.set(connectedTeamIdsAtom, next);
  return next;
}

/** Applies one inventory read, error message included. */
export function applyInventoryObservation(
  registry: AtomRegistry,
  observation: LocalProjectInventoryObservation,
): string[] | null {
  const connectedTeamIds = setConnectedTeamIds(
    registry,
    observation.connectedTeamIds,
  );
  registry.set(
    localInventoryErrorAtom,
    observation.status === "error"
      ? `로컬 프로젝트 연결 목록을 읽지 못했습니다: ${
          observation.error instanceof Error
            ? observation.error.message
            : String(observation.error)
        }`
      : null,
  );
  return connectedTeamIds;
}

/** Clears the inventory and its error, as a sign-out does. */
export function clearWorkspaceInventory(registry: AtomRegistry): void {
  Atom.batch(() => {
    registry.set(connectedTeamIdsAtom, null);
    registry.set(localInventoryErrorAtom, null);
  });
}

/** Marks a team's readiness probe as running or finished. */
export function setTeamReadinessLoading(
  registry: AtomRegistry,
  teamId: string,
  loading: boolean,
): void {
  registry.update(teamReadinessAtom(teamId), (current) =>
    current.loading === loading ? current : { ...current, loading },
  );
}

/** Drops a team's last probe error, leaving the readiness it found in place. */
export function clearTeamReadinessError(
  registry: AtomRegistry,
  teamId: string,
): void {
  registry.update(teamReadinessAtom(teamId), (current) =>
    current.error === null ? current : { ...current, error: null },
  );
}

/** Drops a team's readiness value and error, leaving the loading flag alone. */
export function clearTeamReadiness(
  registry: AtomRegistry,
  teamId: string,
): void {
  registry.update(teamReadinessAtom(teamId), (current) =>
    current.readiness === null && current.error === null
      ? current
      : { ...current, readiness: null, error: null },
  );
}

/** Records a successful probe. */
export function setTeamReadiness(
  registry: AtomRegistry,
  teamId: string,
  readiness: RepositoryReadiness,
): void {
  registry.update(teamReadinessAtom(teamId), (current) => ({
    ...current,
    readiness,
    error: null,
  }));
}

/** Records a failed probe. */
export function setTeamReadinessError(
  registry: AtomRegistry,
  teamId: string,
  error: string,
): void {
  registry.update(teamReadinessAtom(teamId), (current) => ({
    ...current,
    error,
  }));
}

/** Forgets a team entirely, as deleting it does. */
export function forgetTeamReadiness(
  registry: AtomRegistry,
  teamId: string,
): void {
  registry.set(teamReadinessAtom(teamId), idleTeamReadiness);
}

/**
 * Applies one readiness observation: the inventory it carries and the readiness
 * or error for that team. Returns the readiness when the probe succeeded.
 */
export function applyReadinessObservation(
  registry: AtomRegistry,
  teamId: string,
  observation: LocalTeamReadinessObservation<RepositoryReadiness>,
): RepositoryReadiness | null {
  if (observation.status === "superseded") return null;
  let readiness: RepositoryReadiness | null = null;
  Atom.batch(() => {
    applyInventoryObservation(
      registry,
      observation.status === "unknown"
        ? { status: "error", connectedTeamIds: null, error: observation.error }
        : {
            status: "loaded",
            connectedTeamIds: observation.connectedTeamIds,
            error: null,
          },
    );
    if (observation.status === "ready") {
      readiness = observation.readiness;
      setTeamReadiness(registry, teamId, observation.readiness);
      return;
    }
    registry.update(teamReadinessAtom(teamId), (current) => ({
      ...current,
      readiness: null,
      error:
        observation.status === "unknown" || observation.status === "error"
          ? observation.error instanceof Error
            ? observation.error.message
            : String(observation.error)
          : null,
    }));
  });
  return readiness;
}

/*
  Health transitions. `loading` deliberately keeps the previous value and error:
  the boolean flag it replaces did not clear either, so the panel kept showing
  the last probe while the next one ran.
*/

/** A probe started. */
export function beginHealthProbe(
  registry: AtomRegistry,
  options: { readonly clearError?: boolean } = {},
): void {
  registry.update(
    healthAtom,
    (current): WorkspaceHealth => ({
      status: "loading",
      value: current.value,
      error: options.clearError ? null : current.error,
    }),
  );
}

/** A probe finished. */
export function setHealthResult(
  registry: AtomRegistry,
  value: AutoHuntHealth | null,
): void {
  registry.set(healthAtom, { status: "ready", value, error: null });
}

/** A probe failed. `keepValue` matches repair, which leaves the last health up. */
export function setHealthError(
  registry: AtomRegistry,
  error: string,
  options: { readonly keepValue?: boolean } = {},
): void {
  registry.update(
    healthAtom,
    (current): WorkspaceHealth => ({
      status: "error",
      value: options.keepValue ? current.value : null,
      error,
    }),
  );
}

/** There is nothing to probe: no team, or none connected to this device. */
export function resetHealth(registry: AtomRegistry): void {
  registry.set(healthAtom, idleWorkspaceHealth);
}
