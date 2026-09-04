import { useAtomValue } from "@effect/atom-react";
import { useCallback, useEffect, useRef } from "react";
import * as Atom from "effect/unstable/reactivity/Atom";

import {
  dispatchHuntRun,
  loadDashboard,
  retryHuntRun,
  runProjectAgentTaskOnWorker,
} from "../lib/api";
import { dispatchAutoHuntToWorkers } from "../lib/auto-hunt-worker-dispatch";
import { isDesktopTauri } from "../lib/platform";
import {
  recoveryAgent,
  takePlannedUpdateAgentRecoveries,
} from "../lib/planned-update-recovery";
import { executeTeamAgentTask } from "../lib/team-agent-execution";
import { runTeamAgent } from "../lib/team-llm";
import type { TeamAgentRunInput } from "../lib/team-llm";
import {
  teamSupportsExecutionSelection,
  teamWorkerCapabilityCatalog,
} from "../lib/team-worker-capabilities";
import {
  completedDispatchRunIdAtom,
  dispatchRunAtom,
  quickProcessErrorAtom,
  quickStartingRunIdAtom,
} from "../state/dialogs/atoms";
import { useRegistry } from "../state/registry";
import { tokenAtom } from "../state/session/atoms";
import { teamWorkersAtom } from "../state/entities/workers";
import {
  activeTeamIdAtom,
  loadedTeamIdAtom,
  teamExecutionPolicyAtom,
} from "../state/team/atoms";
import { useSyncActions } from "../state/sync/actions";
import type { AutoHuntSession, HuntRun, Project, ProjectAgent } from "../types";

/*
  Handing work to an agent: the auto hunt dispatch, the remote worker task, and
  the recovery pass that resumes whatever a planned app update interrupted.

  All three need the same three things — the session token, the team's worker
  capabilities and the auto hunt session bookkeeping — which is why they moved
  out of the shell together rather than one per surface.
*/

export type AgentAutoHuntOptions = {
  coordinatorConversationId?: string | null;
  parentSessionId?: string;
  maxIssues?: number;
  targetRunIds?: string[];
  retryReason?: string | null;
};

/** The auto hunt session bookkeeping this hook drives. */
export interface AgentDispatchSessions {
  readonly adoptRemoteSession: (session: AutoHuntSession) => void;
  readonly settleTaskSession: (
    sessionId: string,
    input: {
      status: "completed" | "failed" | "skipped";
      conversationId: string | null;
      workspaceRoot: string | null;
      summary: string | null;
      error: string | null;
    },
  ) => void;
  readonly startTaskSession: (
    teamId: string,
    agentId: string,
    session: {
      sessionId?: string;
      request: string;
      agentName?: string | null;
      startedAt: string;
    },
  ) => string;
  readonly startWorkerDispatchSession: (
    teamId: string,
    agent: TeamAgentRunInput["agent"],
    runs: readonly HuntRun[],
    dispatch: {
      dispatchId: string;
      runIds: readonly string[];
      parentSessionId?: string;
      coordinatorConversationId?: string | null;
    },
  ) => void;
}

/** The writes this hook performs, so tests can supply in-memory ones. */
export interface AgentDispatchDeps {
  readonly dispatchRun?: typeof dispatchHuntRun;
  readonly loadTeamDashboard?: typeof loadDashboard;
  readonly retryRun?: typeof retryHuntRun;
  readonly runTeamAgentTaskOnWorker?: typeof runProjectAgentTaskOnWorker;
  readonly takeRecoveries?: typeof takePlannedUpdateAgentRecoveries;
  /** Whether the recovery pass runs at all; only the desktop app has one. */
  readonly desktopTauri?: boolean;
}

export interface AgentDispatchInput {
  /** The selected team, as the shell resolved it. */
  readonly activeTeam: Project | undefined;
  /** Set in a team window, which never runs the recovery pass. */
  readonly teamWindowTeamId: string | null;
  /** Records an agent the dispatch just started, for the run labels. */
  readonly rememberAgent: (agent: ProjectAgent) => void;
  readonly sessions: AgentDispatchSessions;
  readonly deps?: AgentDispatchDeps;
}

export interface AgentDispatch {
  /** Dispatches an auto hunt for an explicit team. */
  readonly dispatchAgentAutoHunt: (
    teamId: string,
    agent: TeamAgentRunInput["agent"],
    runs: HuntRun[],
    options?: AgentAutoHuntOptions,
  ) => Promise<string>;
  /** Dispatches an auto hunt for the selected team, remembering the agent. */
  readonly startAgentAutoHunt: (
    agent: ProjectAgent,
    runs: HuntRun[],
    options?: AgentAutoHuntOptions,
  ) => Promise<string>;
  /** Runs one agent task on a worker and adopts the session it reports. */
  readonly startTeamAgentTask: (
    agent: ProjectAgent,
    input: { request: string; workerId: string; skillId: string },
  ) => Promise<string>;
}

export function useAgentDispatch({
  activeTeam,
  deps,
  rememberAgent,
  sessions,
  teamWindowTeamId,
}: AgentDispatchInput): AgentDispatch {
  const registry = useRegistry();
  const { refreshActiveTeam: refresh } = useSyncActions();
  const token = useAtomValue(tokenAtom);
  const activeTeamId = useAtomValue(activeTeamIdAtom);
  const recoveryRef = useRef<Promise<void> | null>(null);
  const dispatchRun = deps?.dispatchRun ?? dispatchHuntRun;
  const loadTeamDashboard = deps?.loadTeamDashboard ?? loadDashboard;
  const retryRun = deps?.retryRun ?? retryHuntRun;
  const runTeamAgentTaskOnWorker =
    deps?.runTeamAgentTaskOnWorker ?? runProjectAgentTaskOnWorker;
  const takeRecoveries =
    deps?.takeRecoveries ?? takePlannedUpdateAgentRecoveries;
  const runsOnDesktopTauri = deps?.desktopTauri ?? isDesktopTauri();

  const dispatchAgentAutoHunt = useCallback(async (
    teamId: string,
    agent: TeamAgentRunInput["agent"],
    runs: HuntRun[],
    options?: AgentAutoHuntOptions,
  ) => {
    if (!token) throw new Error("로그인이 필요합니다.");
    /*
      What a dispatch needs from the team it targets is the two execution
      projections, and only for the team it is dispatching to. The store has
      them for the team on screen; any other team is fetched, exactly as before.
    */
    const onScreen = registry.get(loadedTeamIdAtom) === teamId;
    const execution = onScreen
      ? {
          workers: registry.get(teamWorkersAtom(teamId)),
          executionPolicy: registry.get(teamExecutionPolicyAtom(teamId)),
        }
      : await loadTeamDashboard(token, teamId);
    const result = await dispatchAutoHuntToWorkers(
      {
        dispatch: (run, input) => dispatchRun(token, teamId, run.id, input),
        retry: (run, reason) => retryRun(token, teamId, run.id, reason),
      },
      {
        agent,
        runs,
        providerModels: teamWorkerCapabilityCatalog(
          execution.workers ?? [],
          execution.executionPolicy ?? undefined,
        ),
        selectionAvailable: (selection) =>
          teamSupportsExecutionSelection(
            execution.workers ?? [],
            execution.executionPolicy ?? undefined,
            selection.provider,
            selection.model,
            selection.effort,
          ),
        maxIssues: options?.maxIssues,
        targetRunIds: options?.targetRunIds,
        retryReason: options?.retryReason,
      },
    );
    sessions.startWorkerDispatchSession(teamId, agent, runs, {
      dispatchId: result.dispatchId,
      runIds: result.runIds,
      parentSessionId: options?.parentSessionId,
      coordinatorConversationId: options?.coordinatorConversationId,
    });
    if (activeTeam?.id === teamId) await refresh();
    return result.dispatchId;
  }, [
    activeTeam?.id,
    registry,
    sessions.startWorkerDispatchSession,
    token,
  ]);

  const startAgentAutoHunt = useCallback(async (
    agent: ProjectAgent,
    runs: HuntRun[],
    options?: AgentAutoHuntOptions,
  ) => {
    if (!activeTeam) throw new Error("프로젝트를 선택해 주세요.");
    rememberAgent(agent);
    return dispatchAgentAutoHunt(activeTeam.id, agent, runs, options);
  }, [activeTeam, dispatchAgentAutoHunt, rememberAgent]);

  const startTeamAgentTask = useCallback(async (
    agent: ProjectAgent,
    input: { request: string; workerId: string; skillId: string },
  ) => {
    if (!activeTeam || !token) {
      throw new Error("로그인이 필요합니다.");
    }
    const session = await runTeamAgentTaskOnWorker(token, activeTeam.id, {
      agentId: agent.id,
      request: input.request,
      workerId: input.workerId,
      skillId: input.skillId,
    });
    sessions.adoptRemoteSession(session);
    if (activeTeam.id === activeTeamId) {
      await refresh();
    }
    return session.id;
  }, [
    activeTeam,
    sessions.adoptRemoteSession,
    activeTeamId,
      token,
  ]);

  useEffect(() => {
    if (
      !runsOnDesktopTauri ||
      teamWindowTeamId ||
      !token ||
      recoveryRef.current
    ) {
      return;
    }
    const sessionToken = token;
    recoveryRef.current = (async () => {
      const recoveries = await takeRecoveries();
      for (const recovery of recoveries) {
        try {
          const dashboard = await loadTeamDashboard(
            sessionToken,
            recovery.projectId,
          );
          const agent = recoveryAgent(recovery);
          await executeTeamAgentTask(
            {
              runAgent: runTeamAgent,
              startSession: (session) =>
                sessions.startTaskSession(
                  recovery.projectId,
                  recovery.request.agentId,
                  { ...session, agentName: agent.name },
                ),
              settleSession: sessions.settleTaskSession,
              startAutoHunt: (runs, options) =>
                dispatchAgentAutoHunt(
                  recovery.projectId,
                  agent,
                  runs,
                  options,
                ),
            },
            {
              agent,
              board: dashboard,
              message: recovery.request.message,
              sessionId: recovery.request.sessionId,
              startedAt: recovery.startedAt,
              conversationId: recovery.request.conversationId,
              recoveringAfterUpdate: true,
            },
          );
        } catch (caught) {
          registry.set(
            quickProcessErrorAtom,
            caught instanceof Error ? caught.message : String(caught),
          );
        }
      }
    })().catch((caught) => {
      registry.set(
        quickProcessErrorAtom,
        caught instanceof Error ? caught.message : String(caught),
      );
    });
  }, [
    sessions.settleTaskSession,
    sessions.startTaskSession,
    token,
    dispatchAgentAutoHunt,
    teamWindowTeamId,
    runsOnDesktopTauri,
  ]);

  // Switching teams abandons whatever dispatch was on screen for the old one.
  useEffect(() => {
    Atom.batch(() => {
      registry.set(quickProcessErrorAtom, null);
      registry.set(quickStartingRunIdAtom, null);
      registry.set(completedDispatchRunIdAtom, null);
      registry.set(dispatchRunAtom, null);
    });
  }, [activeTeamId, registry]);

  return { dispatchAgentAutoHunt, startAgentAutoHunt, startTeamAgentTask };
}
