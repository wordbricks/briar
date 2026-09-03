/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import {
  completedDispatchRunIdAtom,
  dispatchRunAtom,
  quickProcessErrorAtom,
  quickStartingRunIdAtom,
} from "../state/dialogs/atoms";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { tokenAtom } from "../state/session/atoms";
import { applySyncEvent } from "../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../state/team/atoms";
import { createReactTestRoot } from "../test/react";
import type {
  AutoHuntSession,
  DashboardPayload,
  HuntRun,
  Project,
  ProjectAgent,
} from "../types";
import {
  useAgentDispatch,
  type AgentDispatch,
  type AgentDispatchDeps,
  type AgentDispatchSessions,
} from "./useAgentDispatch";

/*
  What the dispatch hook owes its callers.

  The payload it reads worker capabilities from is the one already on screen
  when it belongs to the team being dispatched, and a fetched one otherwise —
  that branch is the reason the shell used to hand it the whole dashboard. The
  team-switch reset is here too: whatever dialog the previous team left open
  must not reopen against the new one.
*/

const teamOf = (id: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
});
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const agent: ProjectAgent = {
  id: "agent-1",
  teamId: teamA.id,
  name: "Release agent",
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "",
  skill: "",
  skills: [],
  calendarColor: "#3275d5",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

const runOf = (id: string): HuntRun => ({
  ...demoDashboard.runs[0]!,
  id,
  title: id,
  status: "queued",
});

const payloadFor = (team: Project): DashboardPayload => ({
  ...demoDashboard,
  team,
  runs: [],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

class DispatchBridge {
  readonly dispatched: { teamId: string; runId: string }[] = [];
  readonly dashboardLoads: string[] = [];
  readonly workerTasks: { teamId: string; agentId: string }[] = [];
  readonly startedDispatches: string[] = [];
  readonly adopted: string[] = [];
  refreshes = 0;

  sessions: AgentDispatchSessions = {
    adoptRemoteSession: (session) => {
      this.adopted.push(session.id);
    },
    settleTaskSession: () => undefined,
    startTaskSession: () => "session-task",
    startWorkerDispatchSession: (teamId) => {
      this.startedDispatches.push(teamId);
    },
  };

  deps: AgentDispatchDeps = {
    desktopTauri: false,
    dispatchRun: ((
      _token: string,
      teamId: string,
      runId: string,
    ) => {
      this.dispatched.push({ teamId, runId });
      return Promise.resolve({ outcome: "dispatched", runId });
    }) as unknown as AgentDispatchDeps["dispatchRun"],
    loadTeamDashboard: (async (_token: string, teamId: string) => {
      this.dashboardLoads.push(teamId);
      return payloadFor(teamOf(teamId));
    }) as AgentDispatchDeps["loadTeamDashboard"],
    retryRun: (() =>
      Promise.resolve({ status: "ok" })) as unknown as
        AgentDispatchDeps["retryRun"],
    runTeamAgentTaskOnWorker: ((
      _token: string,
      teamId: string,
      input: { agentId: string },
    ) => {
      this.workerTasks.push({ teamId, agentId: input.agentId });
      return Promise.resolve({ id: "session-remote" } as AutoHuntSession);
    }) as unknown as AgentDispatchDeps["runTeamAgentTaskOnWorker"],
  };

  refresh = () => {
    this.refreshes += 1;
  };
}

let latest: AgentDispatch;

function Harness({
  activeTeam,
  bridge,
}: {
  readonly activeTeam: Project | undefined;
  readonly bridge: DispatchBridge;
}) {
  latest = useAgentDispatch({
    activeTeam,
    deps: bridge.deps,
    refresh: bridge.refresh,
    rememberAgent: () => undefined,
    sessions: bridge.sessions,
    teamWindowTeamId: null,
  });
  return null;
}

const flush = async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const mount = async (
  registry: AtomRegistry,
  props: Parameters<typeof Harness>[0],
) => {
  const view = createReactTestRoot();
  const render = (next: Parameters<typeof Harness>[0]) =>
    view.render(
      <RegistryContext.Provider value={registry}>
        <I18nProvider>
          <Harness {...next} />
        </I18nProvider>
      </RegistryContext.Provider>,
    );
  await render(props);
  await flush();
  return { render, view };
};

const harness = (): AtomRegistry => {
  const registry = createTestRegistry([
    [tokenAtom, "token-1"],
    [teamsAtom, [teamA, teamB]],
    [activeTeamIdAtom, teamA.id],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: teamA.id,
    payload: payloadFor(teamA),
  });
  return registry;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
});

describe("useAgentDispatch", () => {
  it("reads the open payload for the selected team and fetches for another", async () => {
    const registry = harness();
    const bridge = new DispatchBridge();
    const { view } = await mount(registry, { activeTeam: teamA, bridge });

    await act(async () => {
      await latest.startAgentAutoHunt(agent, [runOf("run-1")]);
    });
    // The team on screen: no round trip, and the write is followed by a refresh.
    expect(bridge.dashboardLoads).toEqual([]);
    expect(bridge.dispatched).toEqual([{ teamId: teamA.id, runId: "run-1" }]);
    expect(bridge.startedDispatches).toEqual([teamA.id]);
    expect(bridge.refreshes).toBe(1);

    await act(async () => {
      await latest.dispatchAgentAutoHunt(teamB.id, agent, [runOf("run-2")]);
    });
    expect(bridge.dashboardLoads).toEqual([teamB.id]);
    expect(bridge.dispatched.at(-1)).toEqual({
      teamId: teamB.id,
      runId: "run-2",
    });
    // Another team's dispatch leaves the open board alone.
    expect(bridge.refreshes).toBe(1);
    await view.cleanup();
  });

  it("refuses to dispatch without a session token", async () => {
    const registry = createTestRegistry([
      [teamsAtom, [teamA]],
      [activeTeamIdAtom, teamA.id],
    ]);
    const bridge = new DispatchBridge();
    const { view } = await mount(registry, { activeTeam: teamA, bridge });

    await expect(
      latest.startAgentAutoHunt(agent, [runOf("run-1")]),
    ).rejects.toThrow("로그인이 필요합니다.");
    expect(bridge.dispatched).toEqual([]);
    await view.cleanup();
  });

  it("adopts the session a worker task reports", async () => {
    const registry = harness();
    const bridge = new DispatchBridge();
    const { view } = await mount(registry, { activeTeam: teamA, bridge });

    await act(async () => {
      const sessionId = await latest.startTeamAgentTask(agent, {
        request: "Ship it",
        workerId: "worker-1",
        skillId: "skill-1",
      });
      expect(sessionId).toBe("session-remote");
    });
    expect(bridge.workerTasks).toEqual([
      { teamId: teamA.id, agentId: agent.id },
    ]);
    expect(bridge.adopted).toEqual(["session-remote"]);
    expect(bridge.refreshes).toBe(1);
    await view.cleanup();
  });

  it("abandons the previous team's dispatch when the selection changes", async () => {
    const registry = harness();
    const bridge = new DispatchBridge();
    const { view } = await mount(registry, { activeTeam: teamA, bridge });

    await act(async () => {
      registry.set(dispatchRunAtom, runOf("run-1"));
      registry.set(quickStartingRunIdAtom, "run-1");
      registry.set(completedDispatchRunIdAtom, "run-1");
      registry.set(quickProcessErrorAtom, "boom");
    });
    expect(registry.get(dispatchRunAtom)).not.toBeNull();

    await act(async () => {
      registry.set(activeTeamIdAtom, teamB.id);
    });
    await flush();
    expect(registry.get(dispatchRunAtom)).toBeNull();
    expect(registry.get(quickStartingRunIdAtom)).toBeNull();
    expect(registry.get(completedDispatchRunIdAtom)).toBeNull();
    expect(registry.get(quickProcessErrorAtom)).toBeNull();
    await view.cleanup();
  });
});
