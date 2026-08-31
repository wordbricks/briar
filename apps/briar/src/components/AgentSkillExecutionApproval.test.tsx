/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  ExecutionWorker,
} from "../types";
import { AgentSkillExecutionApproval } from "./AgentSkillExecutionApproval";

const proposal = (
  id = "proposal-1",
  status: "pending" | "accepted" = "pending",
): AgentSkillExecutionProposal => ({
  id,
  type: "request_agent_skill_execute",
  status,
  projectId: "11111111-1111-4111-8111-111111111111",
  agentId: "22222222-2222-4222-8222-222222222222",
  agentName: "Release Agent",
  skillId: "33333333-3333-4333-8333-333333333333",
  skillName: "iOS 배포",
  request: "iOS 앱을 TestFlight에 배포해 주세요.",
  provider: "codex",
  model: "gpt-5.6-sol",
  effort: "high",
  executionMode: "task",
  approvalPolicy: "explicit",
  executionStatus: status === "accepted" ? "running" : "waiting",
  createdAt: "2026-08-11T00:00:00.000Z",
  acceptedAt: status === "accepted" ? "2026-08-11T00:01:00.000Z" : null,
  requestedWorkerId: status === "accepted" ? "worker-1" : null,
  requestedWorkerLabel: status === "accepted" ? "Build Mac" : null,
  resultSessionId: status === "accepted" ? "session-1" : null,
  resultMessageId: null,
  error: null,
  delegatedByAgentId: null,
  delegatedByAgentName: null,
});

const worker = (
  id: string,
  readiness: ExecutionWorker["readiness"] = "available",
): ExecutionWorker => ({
  id,
  deviceId: `device-${id}`,
  ownerUserId: "owner-1",
  label: id === "worker-1" ? "Build Mac" : "Other Mac",
  agentProvider: "codex",
  providers: ["codex"],
  versions: {},
  state: readiness === "offline" ? "stale" : "online",
  readiness,
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: readiness === "available" ? 1 : 0,
  lastHeartbeatAt: "2026-08-11T00:00:00.000Z",
  createdAt: "2026-08-11T00:00:00.000Z",
});

async function chooseWorker(label = "Build Mac") {
  const select = document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="실행할 정확한 Worker"]',
  );
  await act(async () => select?.click());
  const option = Array.from(
    document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
  ).find((item) => item.textContent?.includes(label));
  await act(async () => option?.click());
}

describe("AgentSkillExecutionApproval", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: ReturnType<typeof createReactTestRoot>["root"];

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    document.body.innerHTML = "";
  });

  it("keeps runtime immutable and requires an exact Worker plus final approval", async () => {
    const pending = proposal();
    const loadExecutionContext = vi.fn(async () => ({
      workers: [worker("worker-1")],
    }));
    const onAccepted = vi.fn();
    const onAccept = vi.fn(async (
      { workerId }: AgentSkillExecutionApprovalInput,
    ) => ({
      ...pending,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:01:00.000Z",
      requestedWorkerId: workerId!,
      requestedWorkerLabel: "Build Mac",
      resultSessionId: "session-1",
    }));

    await renderReactTestRoot(
      root,
      <AgentSkillExecutionApproval
        loadExecutionContext={loadExecutionContext}
        onAccept={onAccept}
        onAccepted={onAccepted}
        proposal={pending}
        surfaceKey="channel:root:message"
      />,
    );
    expect(loadExecutionContext).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".skill-execution-proposal-card footer button",
      )?.click();
    });
    expect(loadExecutionContext).toHaveBeenCalledTimes(1);
    expect(onAccept).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("gpt-5.6-sol");
    expect(document.body.textContent).toContain("high");
    expect(document.body.querySelectorAll("input")).toHaveLength(0);
    expect(document.body.querySelectorAll('[role="combobox"]')).toHaveLength(1);

    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 Skill 실행"));
    expect(approve?.disabled).toBe(true);
    await chooseWorker();
    expect(approve?.disabled).toBe(false);
    await act(async () => approve?.click());

    expect(loadExecutionContext).toHaveBeenCalledTimes(2);
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith({ workerId: "worker-1" });
    expect(onAccepted).toHaveBeenCalledWith(expect.objectContaining({
      resultSessionId: "session-1",
      status: "accepted",
    }));
  });

  it("disables Worker selection and explains when no compatible Worker is selectable", async () => {
    const onAccept = vi.fn();
    const notAccepting = {
      ...worker("worker-2"),
      acceptingWork: false,
    };
    await renderReactTestRoot(
      root,
      <AgentSkillExecutionApproval
        loadExecutionContext={async () => ({
          workers: [worker("worker-1", "offline"), notAccepting],
        })}
        onAccept={onAccept}
        onAccepted={vi.fn()}
        proposal={proposal()}
        surfaceKey="channel:no-selectable-worker"
      />,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".skill-execution-proposal-card footer button",
      )?.click();
    });

    const select = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="실행할 정확한 Worker"]',
    );
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 Skill 실행"));
    const alerts = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="alert"]'),
    );

    expect(select?.disabled).toBe(true);
    expect(approve?.disabled).toBe(true);
    expect(alerts.some((alert) =>
      alert.textContent?.includes("사용 가능한 Worker가 없습니다."),
    )).toBe(true);
    await act(async () => select?.click());
    expect(document.body.querySelector('[role="listbox"]')).toBeNull();
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("approves conversation execution without exposing a Worker choice", async () => {
    const pending = {
      ...proposal(),
      executionMode: "conversation" as const,
    };
    const loadExecutionContext = vi.fn(async () => ({
      workers: [worker("worker-1")],
    }));
    const onAccept = vi.fn(async () => ({
      ...pending,
      status: "accepted" as const,
      executionStatus: "running" as const,
      acceptedAt: "2026-08-11T00:01:00.000Z",
      requestedWorkerId: "worker-1",
      requestedWorkerLabel: "Build Mac",
      resultSessionId: "channel-session-1",
      resultMessageId: "result-message-1",
    }));
    await renderReactTestRoot(
      root,
      <AgentSkillExecutionApproval
        loadExecutionContext={loadExecutionContext}
        onAccept={onAccept}
        onAccepted={vi.fn()}
        proposal={pending}
        surfaceKey="channel:conversation:message"
      />,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".skill-execution-proposal-card footer button",
      )?.click();
    });
    expect(loadExecutionContext).not.toHaveBeenCalled();
    expect(document.body.querySelector('[role="combobox"]')).toBeNull();
    expect(document.body.textContent).toContain("기존 Agent 대화");
    expect(document.body.textContent).toContain("원래 대화에서 실행을 이어가는 중");
    expect(document.body.textContent).not.toContain("gpt-5.6-sol");
    expect(document.body.textContent).not.toContain("high");
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 Skill 실행"));
    expect(approve?.disabled).toBe(false);
    await act(async () => approve?.click());
    expect(onAccept).toHaveBeenCalledWith({});
  });

  it("shows a completed conversation result in the original thread", async () => {
    const result = document.createElement("div");
    result.dataset.channelMessageId = "result-message-1";
    result.tabIndex = -1;
    result.scrollIntoView = vi.fn();
    document.body.append(result);
    await renderReactTestRoot(
      root,
      <AgentSkillExecutionApproval
        loadExecutionContext={vi.fn()}
        onAccept={vi.fn()}
        onAccepted={vi.fn()}
        proposal={{
          ...proposal("proposal-completed", "accepted"),
          executionMode: "conversation",
          executionStatus: "completed",
          resultSessionId: "channel-session-1",
          resultMessageId: "result-message-1",
        }}
        surfaceKey="channel:conversation:completed"
      />,
    );

    expect(document.body.textContent).toContain("완료");
    expect(document.body.textContent).not.toContain("channel-session-1");
    const viewResult = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("결과 보기"));
    await act(async () => viewResult?.click());
    expect(result.scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });
    expect(document.activeElement).toBe(result);
  });


  it("fails closed when the selected Worker changes before final approval", async () => {
    let latestWorkers = [worker("worker-1")];
    const onAccept = vi.fn();
    await renderReactTestRoot(
      root,
      <AgentSkillExecutionApproval
        loadExecutionContext={async () => ({ workers: latestWorkers })}
        onAccept={onAccept}
        onAccepted={vi.fn()}
        proposal={proposal()}
        surfaceKey="issue:message"
      />,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".skill-execution-proposal-card footer button",
      )?.click();
    });
    await chooseWorker();
    latestWorkers = [worker("worker-1", "offline")];
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 Skill 실행"));
    await act(async () => approve?.click());

    expect(onAccept).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("상태 또는 프로젝트 권한이 변경");
  });

  it("drops a slow open result when navigation changes the proposal surface", async () => {
    let resolveContext!: (value: { workers: ExecutionWorker[] }) => void;
    const loadExecutionContext = vi.fn(() =>
      new Promise<{ workers: ExecutionWorker[] }>((resolve) => {
        resolveContext = resolve;
      }));
    const onAccept = vi.fn();
    await renderReactTestRoot(
      root,
      <AgentSkillExecutionApproval
        loadExecutionContext={loadExecutionContext}
        onAccept={onAccept}
        onAccepted={vi.fn()}
        proposal={proposal("proposal-old")}
        surfaceKey="channel:old"
      />,
    );
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".skill-execution-proposal-card footer button",
      )?.click();
    });
    await act(async () => {
      root.render(
        <AgentSkillExecutionApproval
          loadExecutionContext={loadExecutionContext}
          onAccept={onAccept}
          onAccepted={vi.fn()}
          proposal={proposal("proposal-new")}
          surfaceKey="channel:new"
        />,
      );
      resolveContext({ workers: [worker("worker-1")] });
      await Promise.resolve();
    });
    expect(document.body.textContent).not.toContain("Agent Skill 실행 승인");
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("renders immutable Worker and session history without loading current state", async () => {
    const loadExecutionContext = vi.fn();
    await renderReactTestRoot(
      root,
      <AgentSkillExecutionApproval
        loadExecutionContext={loadExecutionContext}
        onAccept={vi.fn()}
        onAccepted={vi.fn()}
        proposal={proposal("proposal-accepted", "accepted")}
        surfaceKey="history"
      />,
    );
    expect(document.body.textContent).toContain("Build Mac");
    expect(document.body.textContent).toContain("session-1");
    expect(loadExecutionContext).not.toHaveBeenCalled();
  });
});
