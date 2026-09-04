import * as Atom from "effect/unstable/reactivity/Atom";

import type { AutoHuntSession } from "../../types";
import { quickStartingRunIdAtom } from "../dialogs/atoms";
import { shallowArrayEqual } from "../entities/upsert";
import type { TeamRealtimeTarget } from "../../lib/team-realtime-refresh";
import { collapseLinkedAutoHuntSessions } from "./model";
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

/*
  The key of an atom that answers for one agent on one team. `Atom.family` takes
  one key, so the two ids are joined with a NUL — the same separator and the
  same reason as `state/board/atoms.ts`.
*/
const keySeparator = "\u0000";

/** The key {@link agentSessionRowIdsAtom} takes. */
export const agentSessionsKey = (teamId: string, agentId: string) =>
  `${teamId}${keySeparator}${agentId}`;

const splitAgentSessionsKey = (key: string): [string, string] => {
  const separator = key.indexOf(keySeparator);
  return [key.slice(0, separator), key.slice(separator + 1)];
};

/**
 * The session ids one agent's list renders: that agent's sessions on that team,
 * newest first, with a task collapsed into the worker dispatch it spawned.
 *
 * A row reads its own session, so this array is what a status change must *not*
 * move — and it does not, which is the whole point of keeping the list on ids.
 */
export const agentSessionRowIdsAtom = Atom.family((key: string) => {
  const [teamId, agentId] = splitAgentSessionsKey(key);
  return Atom.make((get): string[] => {
    const sessions = get(agentSessionsByIdAtom);
    const own: AutoHuntSession[] = [];
    for (const id of get(teamAgentSessionIdsAtom(teamId))) {
      const session = sessions.get(id);
      if (session?.agentId === agentId) own.push(session);
    }
    return collapseLinkedAutoHuntSessions(own).map((session) => session.id);
  }).pipe(
    Atom.withEquality<string[]>(shallowArrayEqual),
    Atom.withLabel(`agentSessions/team/${teamId}/agent/${agentId}/ids`),
  );
});

const sameIds = (left: ReadonlySet<string>, right: ReadonlySet<string>) =>
  left === right ||
  (left.size === right.size && [...left].every((id) => right.has(id)));

/** The agents of one team with a session running right now. */
export const teamRunningAgentIdsAtom = Atom.family((teamId: string) =>
  Atom.make((get): ReadonlySet<string> => {
    const running = new Set<string>();
    for (const session of get(teamAgentSessionsAtom(teamId))) {
      if (session.status === "running" && session.agentId) {
        running.add(session.agentId);
      }
    }
    return running;
  }).pipe(
    Atom.withEquality<ReadonlySet<string>>(sameIds),
    Atom.withLabel(`agentSessions/team/${teamId}/runningAgents`),
  ),
);

/**
 * The worker dispatch a task session spawned, if it has one. The agent detail
 * page follows it so opening a task lands on the dispatch that is doing the
 * work. The empty key is how "nothing is open" is spelled.
 */
export const agentDispatchSessionIdAtom = Atom.family(
  (parentSessionId: string) =>
    Atom.make((get): string | null => {
      if (parentSessionId === "") return null;
      for (const session of get(agentSessionsByIdAtom).values()) {
        if (session.parentSessionId === parentSessionId) return session.id;
      }
      return null;
    }).pipe(Atom.withLabel(`agentSessions/${parentSessionId}/dispatch`)),
);

/**
 * Every running session, newest first, with linked ones collapsed — or nothing
 * under the empty key. The command palette lists them only while it is open, and
 * reading the family under the empty key is how it subscribes to no session at
 * all without a conditional hook.
 */
export const runningAgentSessionsAtom = Atom.family((key: string) =>
  Atom.make((get): AutoHuntSession[] =>
    key === ""
      ? []
      : collapseLinkedAutoHuntSessions(get(agentSessionsAtom))
          .filter((session) => session.status === "running")
          .sort((left, right) =>
            right.startedAt.localeCompare(left.startedAt)
          )
  ).pipe(
    Atom.withEquality<AutoHuntSession[]>(shallowArrayEqual),
    Atom.withLabel(`agentSessions/running/${key}`),
  ),
);

/**
 * The runs an agent is working on right now: every issue of a running session,
 * plus the one a quick dispatch has just been asked to start.
 *
 * It was a `useMemo` in `useIssueAgents`, which is what made the app shell
 * subscribe to the session list. Views that need the whole set at once still
 * read it; a card reads {@link runIsProcessingAtom} for its own run instead.
 */
export const processingIssueIdsAtom = Atom.make(
  (get): ReadonlySet<string> => {
    const runIds = new Set<string>();
    const quickStartingRunId = get(quickStartingRunIdAtom);
    if (quickStartingRunId) runIds.add(quickStartingRunId);
    for (const session of get(agentSessionsAtom)) {
      if (session.status !== "running") continue;
      for (const issue of session.issues) runIds.add(issue.runId);
    }
    return runIds;
  },
).pipe(
  Atom.keepAlive,
  Atom.withEquality<ReadonlySet<string>>(sameIds),
  Atom.withLabel("agentSessions/processingIssueIds"),
);

/**
 * Whether one run has an agent on it.
 *
 * The board threaded the whole set down as a prop, through the card context, so
 * a session starting anywhere in the organization gave every card a new context
 * object and re-rendered the board. Each card subscribes to its own answer
 * instead: a session that starts on one issue notifies that issue's card and
 * leaves the rest of the board asleep.
 */
export const runIsProcessingAtom = Atom.family((runId: string) =>
  Atom.map(processingIssueIdsAtom, (runIds) => runIds.has(runId)).pipe(
    Atom.withLabel(`agentSessions/processing/${runId}`),
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
