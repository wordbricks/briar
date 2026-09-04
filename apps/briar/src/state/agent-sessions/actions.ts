import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import {
  cancelHuntRun,
  cancelProjectAgentTask,
  loadProjectAgentSessionChanges,
  upsertProjectAgentSession,
} from "../../lib/api";
import { stopTeamAgentSession } from "../../lib/team-llm";
import type { TeamRealtimeTarget } from "../../lib/team-realtime-refresh";
import type {
  AutoHuntSession,
  HuntRun,
  ProjectAgent,
} from "../../types";
import { useRegistry, type AtomRegistry } from "../registry";
import { applySyncEvent } from "../sync/apply";
import {
  agentSessionSyncContextAtom,
  agentSessionsAtom,
} from "./atoms";
import {
  agentSessionEvent,
  isRemoteAutoHuntTaskSession,
  reconcileWorkerDispatchSession,
} from "./model";

/*
  Everything that changes an agent session, bound to one registry.

  Each action reads the list it needs through the registry at call time and
  describes what it did as a `SyncEvent`, so there is no dependency array and no
  ref holding a stale copy of the list — the two things the hook these came from
  spent most of its length on.
*/

/** Everything these actions and the session sync reach outside the store. */
export interface AgentSessionApi {
  readonly cancelHuntRun: typeof cancelHuntRun;
  readonly cancelProjectAgentTask: typeof cancelProjectAgentTask;
  readonly loadProjectAgentSessionChanges: typeof loadProjectAgentSessionChanges;
  readonly stopTeamAgentSession: typeof stopTeamAgentSession;
  readonly upsertProjectAgentSession: typeof upsertProjectAgentSession;
}

export const liveAgentSessionApi: AgentSessionApi = {
  cancelHuntRun,
  cancelProjectAgentTask,
  loadProjectAgentSessionChanges,
  stopTeamAgentSession,
  upsertProjectAgentSession,
};

/**
 * The overrides in force for this registry. It replaces the two stopper
 * parameters the hook took: a test seeds this once and every caller — the
 * actions and the session sync alike — picks the same implementations up.
 */
export const agentSessionApiAtom = Atom.make<Partial<AgentSessionApi>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("agentSessions/api"),
);

/** The API in force for this registry, resolved at call time. */
export function resolveAgentSessionApi(
  registry: AtomRegistry,
  overrides?: Partial<AgentSessionApi> | undefined,
): AgentSessionApi {
  return {
    ...liveAgentSessionApi,
    ...registry.get(agentSessionApiAtom),
    ...overrides,
  };
}

export interface AgentSessionActionDeps {
  readonly api?: Partial<AgentSessionApi> | undefined;
}

/** What starting a task session needs to know. */
export interface StartAgentTaskSessionInput {
  readonly sessionId?: string;
  readonly request: string;
  readonly agentName?: string | null;
  readonly skillId?: string | null;
  readonly startedAt: string;
  readonly trigger?: "manual" | "scheduled";
  readonly scheduleId?: string;
  readonly scheduleRunId?: string;
  readonly isFollowUp?: boolean;
}

/** How a task session ended. */
export interface SettleAgentTaskSessionInput {
  readonly status: "completed" | "failed" | "skipped";
  readonly conversationId: string | null;
  readonly workspaceRoot: string | null;
  readonly summary: string | null;
  readonly error: string | null;
}

/** What a worker dispatch session is started from. */
export interface StartAgentWorkerDispatchInput {
  readonly dispatchId: string;
  readonly runIds: readonly string[];
  readonly parentSessionId?: string;
  readonly coordinatorConversationId?: string | null;
  readonly startedAt?: string;
}

export interface AgentSessionActions {
  readonly adoptRemoteSession: (session: AutoHuntSession) => string;
  readonly configureSync: (
    token: string | null,
    targets: readonly TeamRealtimeTarget[],
  ) => void;
  readonly reconcileWorkerDispatches: (
    teamId: string,
    runs: readonly HuntRun[],
  ) => void;
  readonly removeTeamSessions: (teamId: string) => void;
  readonly settleTaskSession: (
    sessionId: string,
    input: SettleAgentTaskSessionInput,
  ) => void;
  readonly startTaskSession: (
    teamId: string,
    agentId: string,
    input: StartAgentTaskSessionInput,
  ) => string;
  readonly startWorkerDispatchSession: (
    teamId: string,
    agent: Pick<ProjectAgent, "id" | "name">,
    runs: readonly HuntRun[],
    input: StartAgentWorkerDispatchInput,
  ) => string;
  readonly stopSession: (sessionId: string) => Promise<boolean>;
}

/** Builds the agent session actions for one registry. */
export function createAgentSessionActions(
  registry: AtomRegistry,
  deps: AgentSessionActionDeps = {},
): AgentSessionActions {
  const api = () => resolveAgentSessionApi(registry, deps.api);
  const sessions = () => registry.get(agentSessionsAtom);
  const changed = (...changedSessions: AutoHuntSession[]) =>
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: changedSessions,
    });
  const merged = (...remote: AutoHuntSession[]) =>
    applySyncEvent(registry, {
      kind: "agent-sessions-merged",
      sessions: remote,
    });

  /**
   * Points the session sync at an account and its teams. Targets are
   * deduplicated and ordered so an unchanged set of teams produces the very
   * same context object, which is what stops the transport from tearing down
   * and resubscribing on every render of the team list.
   */
  const configureSync = (
    token: string | null,
    targets: readonly TeamRealtimeTarget[],
  ) => {
    const normalizedTargets = [...new Map(
      targets.map((target) => [target.id, {
        id: target.id,
        organizationId: target.organizationId ?? null,
      }]),
    ).values()].sort((left, right) => left.id.localeCompare(right.id));
    const current = registry.get(agentSessionSyncContextAtom);
    if (!token) {
      if (current !== null) registry.set(agentSessionSyncContextAtom, null);
      return;
    }
    if (
      current?.token === token &&
      current.targets.length === normalizedTargets.length &&
      current.targets.every(
        (target, index) =>
          target.id === normalizedTargets[index]?.id &&
          target.organizationId === normalizedTargets[index]?.organizationId,
      )
    ) {
      return;
    }
    registry.set(agentSessionSyncContextAtom, {
      token,
      targets: normalizedTargets,
    });
  };

  /**
   * Starts a task session, or restarts the one this request already has. A
   * follow-up keeps the original request and start time and appends to the
   * conversation; anything else replaces them.
   */
  const startTaskSession = (
    teamId: string,
    agentId: string,
    input: StartAgentTaskSessionInput,
  ): string => {
    const current = sessions();
    const existing = current.find(
      (session) =>
        (input.scheduleRunId &&
          session.scheduleRunId === input.scheduleRunId) ||
        (input.sessionId && session.id === input.sessionId),
    );
    if (existing) {
      if (existing.status !== "running") {
        changed({
          ...existing,
          request: input.isFollowUp ? existing.request : input.request,
          ...(input.agentName !== undefined
            ? { agentName: input.agentName }
            : {}),
          ...(input.skillId !== undefined ? { skillId: input.skillId } : {}),
          followUps: input.isFollowUp
            ? [
                ...(existing.followUps ?? []),
                {
                  id: crypto.randomUUID(),
                  message: input.request,
                  sentAt: input.startedAt,
                },
              ]
            : existing.followUps ?? [],
          status: "running",
          startedAt: input.isFollowUp ? existing.startedAt : input.startedAt,
          completedAt: null,
          conversationId: input.isFollowUp ? existing.conversationId : null,
          workspaceRoot: input.isFollowUp ? existing.workspaceRoot : null,
          summary: null,
          error: null,
          updatedAt: input.startedAt,
          localOwner: true,
          events: [
            ...existing.events,
            agentSessionEvent("started", input.startedAt),
          ],
        });
      }
      return existing.id;
    }
    const sessionId = input.sessionId ?? crypto.randomUUID();
    const session: AutoHuntSession = {
      id: sessionId,
      dispatchGroupId: sessionId,
      projectId: teamId,
      agentId,
      agentName: input.agentName ?? null,
      ...(input.skillId !== undefined ? { skillId: input.skillId } : {}),
      sessionType: "task",
      trigger: input.trigger ?? "manual",
      scheduleId: input.scheduleId,
      scheduleRunId: input.scheduleRunId,
      request: input.request,
      followUps: [],
      status: "running",
      issues: [],
      startedAt: input.startedAt,
      completedAt: null,
      conversationId: null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [agentSessionEvent("started", input.startedAt)],
      workers: [],
      dispatchEvents: [],
      updatedAt: input.startedAt,
      localOwner: true,
    };
    changed(session);
    return session.id;
  };

  /** Records the dispatch of a set of issues to the execution workers. */
  const startWorkerDispatchSession = (
    teamId: string,
    agent: Pick<ProjectAgent, "id" | "name">,
    runs: readonly HuntRun[],
    input: StartAgentWorkerDispatchInput,
  ): string => {
    const current = sessions();
    const existing = current.find((session) => session.id === input.dispatchId);
    if (existing) return existing.id;
    const selectedRunIds = new Set(input.runIds);
    const selectedRuns = runs.filter((run) => selectedRunIds.has(run.id));
    if (selectedRuns.length !== selectedRunIds.size) {
      throw new Error("전송한 이슈를 처리 세션에 연결하지 못했습니다.");
    }
    const startedAt = input.startedAt ?? new Date().toISOString();
    const parent = input.parentSessionId
      ? current.find((session) => session.id === input.parentSessionId)
      : undefined;
    const session: AutoHuntSession = {
      id: input.dispatchId,
      dispatchGroupId: input.dispatchId,
      projectId: teamId,
      agentId: agent.id,
      agentName: agent.name,
      sessionType: "dispatch",
      trigger: parent?.trigger ?? "manual",
      scheduleId: parent?.scheduleId,
      scheduleRunId: parent?.scheduleRunId,
      parentSessionId: parent?.id,
      requestedByUserId: parent?.requestedByUserId ?? null,
      request: parent?.request,
      status: "running",
      issues: selectedRuns.map((run) => ({
        runId: run.id,
        runNumber: run.runNumber,
        sourceKey: run.sourceKey,
        title: run.title,
        outcome: "pending",
        summary: null,
      })),
      startedAt,
      completedAt: null,
      conversationId:
        input.coordinatorConversationId ?? parent?.conversationId ?? null,
      workspaceRoot: null,
      summary: null,
      error: null,
      events: [agentSessionEvent("started", startedAt)],
      workers: [],
      dispatchEvents: [],
      updatedAt: startedAt,
      localOwner: true,
    };
    changed(session);
    return session.id;
  };

  /** Takes in a session an agent started on the server. */
  const adoptRemoteSession = (remote: AutoHuntSession): string => {
    merged({ ...remote, localOwner: false });
    return remote.id;
  };

  /**
   * Re-points one team's worker dispatches at the runs on the board. Only the
   * sessions the pass actually changed are written back.
   */
  const reconcileWorkerDispatches = (
    teamId: string,
    runs: readonly HuntRun[],
  ) => {
    const now = new Date().toISOString();
    const reconciled: AutoHuntSession[] = [];
    for (const session of sessions()) {
      if (session.projectId !== teamId) continue;
      const next = reconcileWorkerDispatchSession(session, runs, now);
      if (next !== session) reconciled.push(next);
    }
    if (reconciled.length > 0) changed(...reconciled);
  };

  /** Closes out a running task session. A settled one is left alone. */
  const settleTaskSession = (
    sessionId: string,
    input: SettleAgentTaskSessionInput,
  ) => {
    const session = sessions().find(
      (candidate) => candidate.id === sessionId,
    );
    if (!session || session.status !== "running") return;
    const completedAt = new Date().toISOString();
    changed({
      ...session,
      status: input.status,
      completedAt,
      conversationId: input.conversationId,
      workspaceRoot: input.workspaceRoot,
      summary: input.summary,
      error: input.error,
      updatedAt: completedAt,
      events: [
        ...session.events,
        agentSessionEvent(input.status, completedAt),
      ],
    });
  };

  /**
   * Stops a running session by whichever route can reach it: the app server for
   * a remote worker task, the queued runs for a dispatch, and the desktop stop
   * command for everything this device is running itself.
   */
  const stopSession = async (sessionId: string): Promise<boolean> => {
    const session = sessions().find(
      (candidate) => candidate.id === sessionId,
    );
    if (!session || session.status !== "running") return false;
    const syncContext = registry.get(agentSessionSyncContextAtom);
    if (isRemoteAutoHuntTaskSession(session) && syncContext) {
      const remote = await api().cancelProjectAgentTask(
        syncContext.token,
        session.projectId,
        session.id,
      );
      merged({ ...remote, localOwner: false });
      return true;
    }
    const pendingRunIds = session.sessionType === "dispatch"
      ? session.issues
          .filter((issue) => issue.outcome === "pending")
          .map((issue) => issue.runId)
      : [];
    let stopped: boolean;
    if (pendingRunIds.length > 0 && syncContext) {
      await Promise.all(
        pendingRunIds.map((runId) =>
          api().cancelHuntRun(
            syncContext.token,
            session.projectId,
            runId,
            "Agent 세션에서 실행을 중지했습니다.",
          )
        ),
      );
      stopped = true;
    } else {
      stopped = await api().stopTeamAgentSession(sessionId);
    }
    if (!stopped) return false;
    // The list is read again: awaiting the stop gave everything else a turn.
    const running = sessions().find(
      (candidate) => candidate.id === sessionId && candidate.status === "running",
    );
    if (!running) return true;
    const completedAt = new Date().toISOString();
    changed({
      ...running,
      status: "interrupted",
      completedAt,
      error: null,
      updatedAt: completedAt,
      events: [...running.events, agentSessionEvent("stopped", completedAt)],
    });
    return true;
  };

  /** Drops every session of a team that is being deleted. */
  const removeTeamSessions = (teamId: string) =>
    applySyncEvent(registry, { kind: "agent-sessions-removed", teamId });

  return {
    adoptRemoteSession,
    configureSync,
    reconcileWorkerDispatches,
    removeTeamSessions,
    settleTaskSession,
    startTaskSession,
    startWorkerDispatchSession,
    stopSession,
  };
}

/** The agent session actions for the registry this tree renders in. */
export function useAgentSessionActions(
  deps: AgentSessionActionDeps = {},
): AgentSessionActions {
  const registry = useRegistry();
  const { api } = deps;
  return useMemo(
    () => createAgentSessionActions(registry, { api }),
    [api, registry],
  );
}
