import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect } from "react";

import type { ProjectAgentSessionSyncState } from "../../lib/api";
import {
  listenToAutoHuntDispatchEvents,
  loadAutoHuntDispatch,
} from "../../lib/auto-hunt-agent";
import {
  startTeamRealtimeRefresh,
  type TeamRealtimeTarget,
} from "../../lib/team-realtime-refresh";
import type { AutoHuntSession } from "../../types";
import { teamRunsAtom } from "../entities/runs";
import { useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import {
  agentSessionSyncContextAtom,
  agentSessionsAtom,
  synchronizedTeamIdsAtom,
} from "./atoms";
import {
  createAgentSessionActions,
  resolveAgentSessionApi,
  type AgentSessionApi,
} from "./actions";
import {
  reconcileDispatchSession,
  sessionSyncKey,
  sessionVersion,
} from "./model";

/*
  The agent session transport: what keeps this device's session log and the
  server's copy of it in step, plus the two native listeners that fold a running
  dispatch back into the session that started it.

  It is a hook rather than a subscription atom because the lifecycle is a chain
  of `useEffect` teardowns over three different sources — an organization
  socket, a Tauri event stream and a one-shot recovery pass — and because the
  reconciliation at the end subscribes to whichever team is on screen. Nothing
  here renders, so `AppEffects` is the only component that commits for it.
*/

/** How long the socket may be silent before a project is refreshed anyway. */
const PROJECT_SESSION_REALTIME_FALLBACK_MS = 5 * 60_000;

/** The transports this hook opens, so a test can hand over quiet ones. */
export interface AgentSessionSyncDeps {
  readonly api?: Partial<AgentSessionApi> | undefined;
  readonly startRealtimeRefresh?: typeof startTeamRealtimeRefresh | undefined;
  readonly listenToDispatchEvents?:
    | typeof listenToAutoHuntDispatchEvents
    | undefined;
  readonly loadDispatch?: typeof loadAutoHuntDispatch | undefined;
}

/*
  The bookkeeping the upload and the refresh share, one instance per registry.

  Neither is state a view can render: the uploaded versions decide whether this
  device has already pushed a session, and the cursors decide where its next
  page starts. They were refs on the hook and their lifetime is the registry's.
*/
interface AgentSessionSyncBookkeeping {
  /** The `updatedAt` this device last pushed, per `projectId:sessionId`. */
  readonly uploadedVersions: Map<string, string>;
  /** Where each project's next page of session changes starts. */
  readonly syncStates: Map<string, ProjectAgentSessionSyncState>;
}

const bookkeeping = new WeakMap<AtomRegistry, AgentSessionSyncBookkeeping>();

function syncBookkeeping(registry: AtomRegistry): AgentSessionSyncBookkeeping {
  let current = bookkeeping.get(registry);
  if (!current) {
    current = { uploadedVersions: new Map(), syncStates: new Map() };
    bookkeeping.set(registry, current);
  }
  return current;
}

/** The targets the account's teams make, as `configureSync` takes them. */
const realtimeTargets = (
  teams: readonly { id: string; organizationId?: string | null }[],
): TeamRealtimeTarget[] =>
  teams.map((team) => ({
    id: team.id,
    organizationId: team.organizationId,
  }));

export function useAgentSessionSync(deps: AgentSessionSyncDeps = {}): void {
  const registry = useRegistry();
  const token = useAtomValue(tokenAtom);
  const teams = useAtomValue(teamsAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const syncContext = useAtomValue(agentSessionSyncContextAtom);
  const sessions = useAtomValue(agentSessionsAtom);
  const synchronizedTeamIds = useAtomValue(synchronizedTeamIdsAtom);
  const startRealtimeRefresh =
    deps.startRealtimeRefresh ?? startTeamRealtimeRefresh;
  const listenToDispatchEvents =
    deps.listenToDispatchEvents ?? listenToAutoHuntDispatchEvents;
  const loadDispatch = deps.loadDispatch ?? loadAutoHuntDispatch;

  // Which account and which teams the sync is for. `configureSync` keeps the
  // context object identical when the answer did not change, so the transport
  // below is not torn down for a team list that merely re-rendered.
  useEffect(() => {
    createAgentSessionActions(registry, { api: deps.api }).configureSync(
      token,
      realtimeTargets(teams),
    );
  }, [deps.api, registry, teams, token]);

  /*
    One subscription per account: the organization socket says which projects
    changed and this pulls their session pages. Requests are coalesced, because
    a burst of publishes for the same project must not become a burst of pages.
  */
  useEffect(() => {
    const { syncStates, uploadedVersions } = syncBookkeeping(registry);
    uploadedVersions.clear();
    syncStates.clear();
    registry.set(synchronizedTeamIdsAtom, new Set<string>());
    if (!syncContext || syncContext.targets.length === 0) return;
    const api = resolveAgentSessionApi(registry, deps.api);
    let active = true;
    let refreshing = false;
    const pendingProjectIds = new Set<string>();
    const knownProjectIds = new Set(
      syncContext.targets.map((target) => target.id),
    );

    const refreshRemoteSessions = async (projectIds: readonly string[]) => {
      const loaded = await Promise.allSettled(
        projectIds.map(async (projectId) => {
          let state = syncStates.get(projectId) ?? null;
          const projectSessions: AutoHuntSession[] = [];
          const deletedSessionIds = new Set<string>();
          let reset = false;
          let notModified = false;
          do {
            const page = await api.loadProjectAgentSessionChanges(
              syncContext.token,
              projectId,
              state,
            );
            state = page.state;
            reset ||= page.reset;
            notModified ||= page.notModified;
            projectSessions.push(...page.sessions);
            for (const id of page.deletedSessionIds) deletedSessionIds.add(id);
            if (!page.hasMore) break;
          } while (active);
          if (state) syncStates.set(projectId, state);
          return {
            projectId,
            sessions: projectSessions,
            deletedSessionIds: [...deletedSessionIds],
            reset,
            notModified,
          };
        }),
      );
      if (!active) return;
      // One batch for the whole round, so a subscriber is notified once no
      // matter how many projects answered — which is what the single list
      // update this replaced did.
      Atom.batch(() => {
        const successfulProjectIds = new Set<string>();
        for (const result of loaded) {
          if (result.status !== "fulfilled") continue;
          successfulProjectIds.add(result.value.projectId);
          for (const session of result.value.sessions) {
            uploadedVersions.set(
              sessionSyncKey(session),
              sessionVersion(session),
            );
          }
          if (result.value.notModified) continue;
          applySyncEvent(registry, {
            kind: "agent-sessions-synced",
            teamId: result.value.projectId,
            sessions: result.value.sessions,
            deletedSessionIds: result.value.deletedSessionIds,
            reset: result.value.reset,
          });
        }
        registry.set(
          synchronizedTeamIdsAtom,
          new Set([
            ...registry.get(synchronizedTeamIdsAtom),
            ...successfulProjectIds,
          ]),
        );
      });
    };

    const drainRefreshes = async () => {
      if (refreshing || !active) return;
      refreshing = true;
      try {
        while (active && pendingProjectIds.size > 0) {
          const projectIds = [...pendingProjectIds];
          pendingProjectIds.clear();
          await refreshRemoteSessions(projectIds);
        }
      } finally {
        refreshing = false;
      }
    };
    const requestRefresh = (projectIds: readonly string[]) => {
      for (const projectId of projectIds) {
        if (knownProjectIds.has(projectId)) pendingProjectIds.add(projectId);
      }
      void drainRefreshes();
    };
    const stopRealtimeRefresh = startRealtimeRefresh({
      token: syncContext.token,
      targets: syncContext.targets,
      refresh: requestRefresh,
      fallbackMs: PROJECT_SESSION_REALTIME_FALLBACK_MS,
    });
    return () => {
      active = false;
      stopRealtimeRefresh();
    };
  }, [deps.api, registry, startRealtimeRefresh, syncContext]);

  /*
    Pushes the sessions this device owns for a project whose server copy has
    been read at least once. The version is recorded before the request so a
    second pass does not push the same session twice, and released again when
    the push fails so the next change retries it.
  */
  useEffect(() => {
    if (!syncContext || synchronizedTeamIds.size === 0) return;
    const { uploadedVersions } = syncBookkeeping(registry);
    const api = resolveAgentSessionApi(registry, deps.api);
    for (const session of sessions) {
      if (session.localOwner === false) continue;
      if (!synchronizedTeamIds.has(session.projectId)) continue;
      const key = sessionSyncKey(session);
      const version = sessionVersion(session);
      if (uploadedVersions.get(key) === version) continue;
      uploadedVersions.set(key, version);
      void api.upsertProjectAgentSession(syncContext.token, session)
        .then((remote) => {
          uploadedVersions.set(
            sessionSyncKey(remote),
            sessionVersion(remote),
          );
          applySyncEvent(registry, {
            kind: "agent-sessions-merged",
            sessions: [remote],
          });
        })
        .catch(() => {
          if (uploadedVersions.get(key) === version) {
            uploadedVersions.delete(key);
          }
        });
    }
  }, [deps.api, registry, sessions, syncContext, synchronizedTeamIds]);

  /*
    What the native side knows about the dispatches that were in flight when the
    app stopped. Runs once, against whatever the store restored: a dispatch the
    native side has no record of keeps its interrupted snapshot, and a new
    session is never inferred from a missing one.
  */
  useEffect(() => {
    const recoverable = registry
      .get(agentSessionsAtom)
      .filter(
        (session) =>
          session.sessionType !== "task" &&
          (session.status === "running" || session.status === "interrupted"),
      );
    if (recoverable.length === 0) return;
    let active = true;
    void Promise.all(recoverable.map(async (session) => ({
      sessionId: session.id,
      dispatch: await loadDispatch(session.dispatchGroupId),
    }))).then((loaded) => {
      if (!active) return;
      const dispatches = new Map(
        loaded
          .filter((entry) => entry.dispatch !== null)
          .map((entry) => [entry.sessionId, entry.dispatch!]),
      );
      if (dispatches.size === 0) return;
      const reconciled: AutoHuntSession[] = [];
      for (const session of registry.get(agentSessionsAtom)) {
        const dispatch = dispatches.get(session.id);
        if (dispatch) {
          reconciled.push(reconcileDispatchSession(session, dispatch));
        }
      }
      if (reconciled.length > 0) {
        applySyncEvent(registry, {
          kind: "agent-sessions-changed",
          sessions: reconciled,
        });
      }
    }).catch(() => {
      // The interrupted local snapshot remains visible when native recovery
      // state is unavailable; starting a new session is never inferred here.
    });
    return () => {
      active = false;
    };
  }, [loadDispatch, registry]);

  /** Every native dispatch event re-reads that dispatch and folds it in. */
  useEffect(() => {
    let active = true;
    let unlisten: () => void = () => undefined;
    void listenToDispatchEvents((event) => {
      if (!active) return;
      const session = registry
        .get(agentSessionsAtom)
        .find((candidate) => candidate.dispatchGroupId === event.dispatchGroupId);
      if (!session) return;
      void loadDispatch(event.dispatchGroupId, 0).then((dispatch) => {
        if (!active || !dispatch) return;
        const reconciled: AutoHuntSession[] = [];
        for (const candidate of registry.get(agentSessionsAtom)) {
          if (candidate.dispatchGroupId !== event.dispatchGroupId) continue;
          reconciled.push(reconcileDispatchSession(candidate, dispatch));
        }
        if (reconciled.length > 0) {
          applySyncEvent(registry, {
            kind: "agent-sessions-changed",
            sessions: reconciled,
          });
        }
      });
    }).then((stop) => {
      if (!active) {
        stop();
        return;
      }
      unlisten = stop;
    });
    return () => {
      active = false;
      unlisten();
    };
  }, [listenToDispatchEvents, loadDispatch, registry]);

  /*
    The dispatch reconciliation, which needs *every* run of the open team and
    needs it only to call an action. It subscribes in an effect rather than
    during render, so a board change costs no commit here. `immediate` delivers
    the board this team already has and builds the derived atom's dependency
    graph, without which nothing would arrive later.
  */
  useEffect(() => {
    if (!activeTeamId) return;
    const actions = createAgentSessionActions(registry, { api: deps.api });
    return registry.subscribe(
      teamRunsAtom(activeTeamId),
      (runs) => {
        if (runs) actions.reconcileWorkerDispatches(activeTeamId, runs);
      },
      { immediate: true },
    );
  }, [activeTeamId, deps.api, registry]);
}
