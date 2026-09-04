import * as Atom from "effect/unstable/reactivity/Atom";

import type { AutoHuntSession } from "../../types";
import { shallowArrayEqual } from "../entities/upsert";
import type { TeamRealtimeTarget } from "../../lib/team-realtime-refresh";
import { readStoredAgentSessions } from "./persistence";

/*
  Agent sessions, normalized the way runs and channels are: one map by id and
  one stored array of ids for the order.

  The order is stored rather than derived because the four writes disagree about
  it. A session this device starts is prepended; a reconciliation pass leaves
  every position alone; a server merge re-sorts the whole list by `startedAt`.
  A `Map`'s insertion order is none of those, so `state/sync/apply.ts` owns both
  halves and writes them in one batch.

  The stored sessions are read on first access rather than on mount. The read is
  the lazy body of the two writable atoms below, so whichever of them a boot
  touches first parses `localStorage` once, and every consumer — including one
  that renders before any effect has run — sees yesterday's sessions on its
  first read. `useAgentSessionPersistence` only writes.
*/

/**
 * The stored sessions of this registry, parsed once. Both writable atoms below
 * take their initial value from it, which is what makes the parse happen once
 * per registry instead of once per atom.
 */
const restoredAgentSessionsAtom = Atom.make(() => readStoredAgentSessions()).pipe(
  Atom.keepAlive,
  Atom.withLabel("agentSessions/restored"),
);

/** Every session this device knows about, keyed by session id. */
export const agentSessionsByIdAtom = Atom.writable<
  ReadonlyMap<string, AutoHuntSession>,
  ReadonlyMap<string, AutoHuntSession>
>(
  (get) =>
    new Map(
      get(restoredAgentSessionsAtom).map((session) => [session.id, session]),
    ),
  (ctx, value) => ctx.setSelf(value),
).pipe(Atom.keepAlive, Atom.withLabel("agentSessions/byId"));

/** Every session id in render order: newest first, as the list has always been. */
export const agentSessionIdsAtom = Atom.writable<
  readonly string[],
  readonly string[]
>(
  (get) => get(restoredAgentSessionsAtom).map((session) => session.id),
  (ctx, value) => ctx.setSelf(value),
).pipe(
  Atom.keepAlive,
  Atom.withEquality<readonly string[]>(shallowArrayEqual),
  Atom.withLabel("agentSessions/ids"),
);

/** One session, or `null` when it is not in the store. */
export const agentSessionAtom = Atom.family((sessionId: string) =>
  Atom.map(
    agentSessionsByIdAtom,
    (sessions) => sessions.get(sessionId) ?? null,
  ).pipe(Atom.withLabel(`agentSessions/${sessionId}`)),
);

/**
 * The whole list, resolved against the store. The array keeps its reference
 * while every session in it keeps theirs, so a write that changed nothing
 * notifies nobody.
 */
export const agentSessionsAtom = Atom.make((get): AutoHuntSession[] => {
  const sessions = get(agentSessionsByIdAtom);
  const resolved: AutoHuntSession[] = [];
  for (const id of get(agentSessionIdsAtom)) {
    const session = sessions.get(id);
    if (session) resolved.push(session);
  }
  return resolved;
}).pipe(
  Atom.keepAlive,
  Atom.withEquality<AutoHuntSession[]>(shallowArrayEqual),
  Atom.withLabel("agentSessions/list"),
);

/**
 * One team's session ids, in the same order the whole list has them. A list
 * view subscribes to this and each row to its own session, so a status change
 * commits that row and nothing above it.
 */
export const teamAgentSessionIdsAtom = Atom.family((teamId: string) =>
  Atom.make((get): string[] => {
    const sessions = get(agentSessionsByIdAtom);
    const ids: string[] = [];
    for (const id of get(agentSessionIdsAtom)) {
      if (sessions.get(id)?.projectId === teamId) ids.push(id);
    }
    return ids;
  }).pipe(
    Atom.withEquality<string[]>(shallowArrayEqual),
    Atom.withLabel(`agentSessions/team/${teamId}/ids`),
  ),
);

/** One team's sessions, resolved against the store. */
export const teamAgentSessionsAtom = Atom.family((teamId: string) =>
  Atom.make((get): AutoHuntSession[] => {
    const sessions = get(agentSessionsByIdAtom);
    const resolved: AutoHuntSession[] = [];
    for (const id of get(teamAgentSessionIdsAtom(teamId))) {
      const session = sessions.get(id);
      if (session) resolved.push(session);
    }
    return resolved;
  }).pipe(
    Atom.withEquality<AutoHuntSession[]>(shallowArrayEqual),
    Atom.withLabel(`agentSessions/team/${teamId}`),
  ),
);

/** The token and the teams the session sync is currently subscribed for. */
export interface AgentSessionSyncContext {
  readonly token: string;
  readonly targets: readonly TeamRealtimeTarget[];
}

/**
 * What the realtime session sync is configured with, or `null` while there is
 * no signed-in account to sync for. Stopping a remote worker task reads the
 * token from here, exactly as it did when this was the hook's state: a session
 * whose project is not being synced has no server to cancel against.
 */
export const agentSessionSyncContextAtom =
  Atom.make<AgentSessionSyncContext | null>(null).pipe(
    Atom.keepAlive,
    Atom.withLabel("agentSessions/syncContext"),
  );

/**
 * The teams whose server sessions have been fetched at least once. A local
 * session is only uploaded for a team on this list, so a failed first fetch
 * never causes this device to push over what it could not read.
 */
export const synchronizedTeamIdsAtom = Atom.make<ReadonlySet<string>>(
  new Set<string>(),
).pipe(Atom.keepAlive, Atom.withLabel("agentSessions/synchronizedTeams"));
