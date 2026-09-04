/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { testAgentSession } from "../../test/agent-sessions";
import { createReactTestRoot } from "../../test/react";
import type { AutoHuntSession, HuntRun, Project } from "../../types";
import { runsByIdAtom, teamRunIdsAtom } from "../entities/runs";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import type { AgentSessionApi } from "./actions";
import {
  agentSessionSyncContextAtom,
  agentSessionsAtom,
  synchronizedTeamIdsAtom,
} from "./atoms";
import { useAgentSessionSync } from "./useAgentSessionSync";

const team = (id: string): Project =>
  ({ id, name: id, organizationId: "org-1" }) as Project;

const run = (id: string, overrides: Partial<HuntRun> = {}) =>
  ({
    id,
    runNumber: 1,
    sourceKey: "BRIAR-1",
    title: "세션 로그 복구",
    status: "running",
    ...overrides,
  }) as HuntRun;

/** One subscription the realtime refresh opened. */
interface Subscription {
  readonly token: string;
  readonly teamIds: string[];
  refresh: (projectIds: readonly string[]) => void;
  stopped: boolean;
}

class SessionServer {
  readonly subscriptions: Subscription[] = [];
  readonly pages = new Map<string, AutoHuntSession[]>();
  readonly uploads: AutoHuntSession[] = [];
  failingProjectIds = new Set<string>();

  get openSubscriptions() {
    return this.subscriptions.filter((subscription) => !subscription.stopped);
  }

  readonly api: Partial<AgentSessionApi> = {
    loadProjectAgentSessionChanges: async (_token, projectId) => {
      if (this.failingProjectIds.has(projectId)) {
        throw new Error("session page unavailable");
      }
      return {
        state: { cursor: 1 },
        hasMore: false,
        reset: false,
        notModified: false,
        sessions: this.pages.get(projectId) ?? [],
        deletedSessionIds: [],
      };
    },
    upsertProjectAgentSession: async (_token, session) => {
      this.uploads.push(session);
      return { ...session, localOwner: false, detailLoaded: false };
    },
  };

  readonly startRealtimeRefresh: NonNullable<
    Parameters<typeof useAgentSessionSync>[0]
  >["startRealtimeRefresh"] = ({ token, targets, refresh }) => {
    const subscription: Subscription = {
      token,
      teamIds: targets.map((target) => target.id),
      refresh,
      stopped: false,
    };
    this.subscriptions.push(subscription);
    return () => {
      subscription.stopped = true;
    };
  };
}

const quietDeps = (server: SessionServer) => ({
  api: server.api,
  startRealtimeRefresh: server.startRealtimeRefresh,
  listenToDispatchEvents: async () => () => undefined,
  loadDispatch: async () => null,
});

function Effects({ server }: { readonly server: SessionServer }) {
  useAgentSessionSync(quietDeps(server));
  return null;
}

const mount = async (registry: AtomRegistry, server: SessionServer) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Effects server={server} />
    </RegistryContext.Provider>,
  );
  return view;
};

const settle = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
});

describe("useAgentSessionSync", () => {
  it("subscribes for the signed-in account's teams", async () => {
    const server = new SessionServer();
    const registry = createTestRegistry([
      [tokenAtom, "token-1"],
      [teamsAtom, [team("project-1"), team("project-2")]],
    ]);
    const view = await mount(registry, server);

    expect(server.openSubscriptions).toHaveLength(1);
    expect(server.openSubscriptions[0]).toMatchObject({
      token: "token-1",
      teamIds: ["project-1", "project-2"],
    });
    expect(registry.get(agentSessionSyncContextAtom)).toMatchObject({
      token: "token-1",
    });

    await view.cleanup();
  });

  it("does not resubscribe when the team list is rebuilt unchanged", async () => {
    const server = new SessionServer();
    const registry = createTestRegistry([
      [tokenAtom, "token-1"],
      [teamsAtom, [team("project-1")]],
    ]);
    const view = await mount(registry, server);
    await act(async () => {
      registry.set(teamsAtom, [team("project-1")]);
    });

    expect(server.subscriptions).toHaveLength(1);
    expect(server.openSubscriptions).toHaveLength(1);

    await view.cleanup();
  });

  it("resubscribes for a new token and for a team that appeared", async () => {
    const server = new SessionServer();
    const registry = createTestRegistry([
      [tokenAtom, "token-1"],
      [teamsAtom, [team("project-1")]],
    ]);
    const view = await mount(registry, server);
    await act(async () => {
      registry.set(tokenAtom, "token-2");
    });
    await act(async () => {
      registry.set(teamsAtom, [team("project-1"), team("project-2")]);
    });

    expect(server.subscriptions.map((s) => [s.token, s.teamIds.length])).toEqual(
      [["token-1", 1], ["token-2", 1], ["token-2", 2]],
    );
    expect(server.openSubscriptions).toHaveLength(1);

    await view.cleanup();
  });

  it("unsubscribes when the account signs out and when it unmounts", async () => {
    const server = new SessionServer();
    const registry = createTestRegistry([
      [tokenAtom, "token-1"],
      [teamsAtom, [team("project-1")]],
    ]);
    const view = await mount(registry, server);
    await act(async () => {
      registry.set(tokenAtom, null);
    });

    expect(server.openSubscriptions).toHaveLength(0);
    expect(registry.get(agentSessionSyncContextAtom)).toBeNull();

    await view.cleanup();
    expect(server.openSubscriptions).toHaveLength(0);
  });

  it("applies the pages a realtime notification pulls", async () => {
    const server = new SessionServer();
    server.pages.set("project-1", [
      testAgentSession("remote-1", { localOwner: false, status: "completed" }),
    ]);
    const registry = createTestRegistry([
      [tokenAtom, "token-1"],
      [teamsAtom, [team("project-1")]],
    ]);
    const view = await mount(registry, server);

    await act(async () => {
      server.openSubscriptions[0]?.refresh(["project-1", "unknown-project"]);
    });
    await settle();

    expect(registry.get(agentSessionsAtom).map((s) => s.id)).toEqual([
      "remote-1",
    ]);
    expect([...registry.get(synchronizedTeamIdsAtom)]).toEqual(["project-1"]);

    await view.cleanup();
  });

  it("uploads a local session once the team's server copy has been read", async () => {
    const server = new SessionServer();
    const registry = createTestRegistry([
      [tokenAtom, "token-1"],
      [teamsAtom, [team("project-1")]],
    ]);
    const view = await mount(registry, server);
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [testAgentSession("local-1", { status: "completed" })],
    });

    // Nothing is pushed before the first page has been read back.
    await settle();
    expect(server.uploads).toEqual([]);

    await act(async () => {
      server.openSubscriptions[0]?.refresh(["project-1"]);
    });
    await settle();

    expect(server.uploads.map((session) => session.id)).toEqual(["local-1"]);

    await view.cleanup();
  });

  it("reconciles the open team's dispatches against its board", async () => {
    const server = new SessionServer();
    const registry = createTestRegistry([
      [tokenAtom, "token-1"],
      [teamsAtom, [team("project-1")]],
      [activeTeamIdAtom, "project-1"],
      [teamRunIdsAtom("project-1"), ["run-1"]],
      [runsByIdAtom, new Map([["run-1", run("run-1")]])],
    ]);
    applySyncEvent(registry, {
      kind: "agent-sessions-changed",
      sessions: [
        testAgentSession("dispatch-1", {
          sessionType: "dispatch",
          issues: [{
            runId: "run-1",
            runNumber: 1,
            sourceKey: "BRIAR-1",
            title: "세션 로그 복구",
            outcome: "pending",
            summary: null,
          }],
        }),
      ],
    });
    const view = await mount(registry, server);

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        teamId: "project-1",
        run: run("run-1", { status: "completed", resultSummary: "끝났습니다." }),
      });
    });

    expect(registry.get(agentSessionsAtom)[0]).toMatchObject({
      status: "completed",
      summary: "BRIAR-1: 끝났습니다.",
    });

    await view.cleanup();
  });
});
