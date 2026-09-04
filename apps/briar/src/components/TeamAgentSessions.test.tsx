/** @vitest-environment jsdom */

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { testAgentSession } from "../test/agent-sessions";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { createRenderCounter } from "../test/render-count";
import {
  agentSessionAtom,
  agentSessionRowIdsAtom,
  agentSessionsKey,
} from "../state/agent-sessions/atoms";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { applySyncEvent } from "../state/sync/apply";
import type { AutoHuntSession, ProjectAgent } from "../types";
import { TeamAgentSessions } from "./TeamAgentSessions";

const agent: ProjectAgent = {
  id: "agent-1",
  teamId: "project-1",
  name: "Release agent",
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Review the release.",
  skill: "# Release agent",
  skills: [],
  calendarColor: "#3275d5",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

const taskSession = (overrides: Partial<AutoHuntSession> = {}) =>
  testAgentSession("task-session", {
    agentId: agent.id,
    request: "Review the current release status.",
    status: "completed",
    completedAt: "2026-07-28T01:01:00.000Z",
    updatedAt: "2026-07-28T01:01:00.000Z",
    conversationId: "thread-1",
    workspaceRoot: "/repo",
    summary: "The release is ready.",
    localOwner: undefined,
    ...overrides,
  });

const registryWith = (sessions: AutoHuntSession[]): AtomRegistry => {
  const registry = createTestRegistry();
  applySyncEvent(registry, { kind: "agent-sessions-changed", sessions });
  return registry;
};

const render = async (
  registry: AtomRegistry,
  node: React.ReactNode,
) => {
  const view = createReactTestRoot({ attachToDocument: true });
  await renderReactTestRoot(
    view.root,
    <RegistryContext.Provider value={registry}>{node}</RegistryContext.Provider>,
  );
  return view;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.clear();
});

describe("TeamAgentSessions", () => {
  it("shows direct task sessions for only the selected agent", async () => {
    const onSessionOpen = vi.fn();
    const registry = registryWith([
      taskSession(),
      taskSession({
        id: "scheduled-session",
        dispatchGroupId: "scheduled-session",
        trigger: "scheduled",
        request: "Daily repository audit",
        status: "skipped",
        summary: "대기 상태인 이슈가 없어 세션을 건너뛰었습니다.",
        events: [{
          id: "scheduled-session-skipped",
          type: "skipped",
          occurredAt: "2026-07-28T01:01:00.000Z",
        }],
      }),
      taskSession({
        id: "other-agent-session",
        dispatchGroupId: "other-agent-session",
        agentId: "agent-2",
        request: "Do not show this task.",
      }),
    ]);
    const { cleanup, container } = await render(
      registry,
      <TeamAgentSessions
        agent={agent}
        onSessionOpen={onSessionOpen}
        projectId="project-1"
      />,
    );

    expect(container.textContent).toContain(
      "Review the current release status.",
    );
    expect(container.textContent).toContain("스케줄 실행");
    expect(container.textContent).toContain("Daily repository audit");
    expect(container.textContent).toContain("건너뜀");
    expect(container.textContent).not.toContain("Do not show this task.");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".auto-hunt-session-row")
        ?.click();
    });
    expect(onSessionOpen).toHaveBeenCalledWith("task-session");
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await cleanup();
  });

  it("shows a task and its Auto Hunt dispatch as one session", async () => {
    const onSessionOpen = vi.fn();
    const registry = registryWith([
      taskSession({
        id: "dispatch-session",
        dispatchGroupId: "dispatch-session",
        sessionType: "dispatch",
        parentSessionId: "task-session",
        status: "running",
        completedAt: null,
        conversationId: null,
        summary: null,
        issues: [{
          runId: "run-1",
          runNumber: 1,
          sourceKey: "issue-1",
          title: "Queued issue",
          outcome: "pending",
          summary: null,
        }],
      }),
      taskSession(),
    ]);
    const { cleanup, container } = await render(
      registry,
      <TeamAgentSessions
        agent={agent}
        onSessionOpen={onSessionOpen}
        projectId="project-1"
      />,
    );

    expect(container.querySelectorAll(".auto-hunt-session-row")).toHaveLength(1);
    expect(container.textContent).toContain(
      "Review the current release status.",
    );
    expect(container.textContent).toContain("1개 이슈");

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".auto-hunt-session-row")
        ?.click();
    });
    expect(onSessionOpen).toHaveBeenCalledWith("dispatch-session");

    await cleanup();
  });

  it("stops a running session this device owns", async () => {
    const onStopSession = vi.fn().mockResolvedValue(true);
    const registry = registryWith([
      taskSession({
        id: "running-session",
        dispatchGroupId: "running-session",
        status: "running",
        completedAt: null,
        localOwner: true,
      }),
    ]);
    const { cleanup, container } = await render(
      registry,
      <TeamAgentSessions
        agent={agent}
        onSessionOpen={vi.fn()}
        onStopSession={onStopSession}
        projectId="project-1"
      />,
    );

    const stopButton = container.querySelector<HTMLButtonElement>(
      ".auto-hunt-session-row-stop",
    );
    expect(stopButton?.getAttribute("aria-label")).toBe("세션 정지");

    await act(async () => {
      stopButton?.click();
    });
    expect(onStopSession).toHaveBeenCalledWith("running-session");

    await cleanup();
  });

  it("stops a remote worker task session", async () => {
    const onStopSession = vi.fn().mockResolvedValue(true);
    const registry = registryWith([
      taskSession({
        id: "remote-worker-session",
        dispatchGroupId: "remote-worker-session",
        status: "running",
        completedAt: null,
        localOwner: false,
        requestedWorkerId: "worker-1",
        workerId: "worker-1",
      }),
    ]);
    const { cleanup, container } = await render(
      registry,
      <TeamAgentSessions
        agent={agent}
        onSessionOpen={vi.fn()}
        onStopSession={onStopSession}
        projectId="project-1"
      />,
    );

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>(".auto-hunt-session-row-stop")
        ?.click();
    });
    expect(onStopSession).toHaveBeenCalledWith("remote-worker-session");

    await cleanup();
  });

  it("does not offer to stop a settled or unclaimed remote session", async () => {
    const registry = registryWith([
      taskSession(),
      taskSession({
        id: "remote-running-session",
        dispatchGroupId: "remote-running-session",
        status: "running",
        completedAt: null,
        localOwner: false,
      }),
    ]);
    const { cleanup, container } = await render(
      registry,
      <TeamAgentSessions
        agent={agent}
        onSessionOpen={vi.fn()}
        onStopSession={vi.fn()}
        projectId="project-1"
      />,
    );

    expect(
      container.querySelectorAll(".auto-hunt-session-row-stop"),
    ).toHaveLength(0);

    await cleanup();
  });

  it("commits only the row whose session changed status", async () => {
    const renders = createRenderCounter();
    const registry = registryWith([
      taskSession({
        id: "session-a",
        dispatchGroupId: "session-a",
        status: "running",
        completedAt: null,
      }),
      taskSession({ id: "session-b", dispatchGroupId: "session-b" }),
    ]);

    /*
      `profile` counts a whole subtree, so the boundaries are measured with probe
      components that read the same atoms and are siblings of the real list. The
      list itself renders alongside them and is asserted through the DOM.
    */
    function RowIdsProbe() {
      useAtomValue(
        agentSessionRowIdsAtom(agentSessionsKey("project-1", agent.id)),
      );
      return null;
    }
    function SessionProbe({ sessionId }: { readonly sessionId: string }) {
      useAtomValue(agentSessionAtom(sessionId));
      return null;
    }

    const { cleanup, container } = await render(
      registry,
      <>
        {renders.profile("row-ids", <RowIdsProbe />)}
        {renders.profile("row-a", <SessionProbe sessionId="session-a" />)}
        {renders.profile("row-b", <SessionProbe sessionId="session-b" />)}
        <TeamAgentSessions
          agent={agent}
          onSessionOpen={vi.fn()}
          projectId="project-1"
        />
      </>,
    );
    expect(container.textContent).toContain("진행 중");
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "agent-sessions-changed",
        sessions: [
          {
            ...registry.get(agentSessionAtom("session-a"))!,
            status: "completed",
            updatedAt: "2026-07-28T02:00:00.000Z",
          },
        ],
      });
    });

    renders.expectRenderCounts({ "row-a": 1 });
    expect(container.textContent).not.toContain("진행 중");

    await cleanup();
  });
});
