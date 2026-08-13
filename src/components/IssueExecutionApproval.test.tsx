/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAgentProviderModelCatalog,
  loadAgentProviderModels,
} from "../lib/project-llm";
import type { ExecutionWorker, HuntRun } from "../types";
import {
  IssueExecutionApproval,
  type ExecutionApprovalContext,
  type ExecutionProposalView,
} from "./IssueExecutionApproval";

vi.mock("../lib/project-llm", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/project-llm")>();
  return {
    ...original,
    loadAgentProviderModels: vi.fn(async () =>
      original.defaultAgentProviderModelCatalog
    ),
  };
});

const worker: ExecutionWorker = {
  id: "worker-1",
  deviceId: "device-1",
  ownerUserId: "owner-1",
  label: "Build Mac",
  agentProvider: "codex",
  providers: ["codex", "claude"],
  versions: {},
  state: "online",
  readiness: "available",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: 1,
  lastHeartbeatAt: "2026-08-11T00:00:00.000Z",
  createdAt: "2026-08-11T00:00:00.000Z",
};

const backlogRun = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Ship approval flow",
  status: "backlog",
  executionReadiness: "ready",
  claimedBy: null,
  claimedAt: null,
  workerId: null,
  dispatchedAt: null,
  requestedByUserId: null,
  dispatchMode: null,
} as HuntRun;

const pendingProposal: ExecutionProposalView = {
  id: "22222222-2222-4222-8222-222222222222",
  status: "pending",
  projectId: "33333333-3333-4333-8333-333333333333",
  runId: backlogRun.id,
  title: backlogRun.title,
  createdAt: "2026-08-11T00:00:00.000Z",
  acceptedAt: null,
  requestedProvider: null,
  requestedModel: null,
  requestedEffort: null,
  requestedWorkerId: null,
  delegatedByAgentId: null,
  delegatedByAgentName: null,
};

const context = (run: HuntRun = backlogRun): ExecutionApprovalContext => ({
  run,
  workers: [worker],
});

const remotelyAcceptedProposal: ExecutionProposalView = {
  ...pendingProposal,
  status: "accepted",
  acceptedAt: "2026-08-11T00:06:00.000Z",
  requestedProvider: "codex",
};

describe("IssueExecutionApproval", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(loadAgentProviderModels).mockReset();
    vi.mocked(loadAgentProviderModels).mockResolvedValue({
      ...defaultAgentProviderModelCatalog,
      opencode: {
        models: [{ id: "openai/custom-agent", label: "Custom Agent" }],
        error: null,
      },
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("does not load or execute until both explicit approval steps are used", async () => {
    const loadExecutionContext = vi.fn(async () => context());
    const onAccept = vi.fn(async (input) => ({
      ...pendingProposal,
      status: "accepted" as const,
      acceptedAt: "2026-08-11T00:01:00.000Z",
      requestedProvider: input.provider,
      requestedModel: input.model,
      requestedEffort: input.effort,
      requestedWorkerId: input.workerId,
    }));

    await act(async () => {
      root.render(
        <IssueExecutionApproval
          loadExecutionContext={loadExecutionContext}
          onAccept={onAccept}
          onAccepted={vi.fn()}
          proposal={pendingProposal}
          surfaceKey="channel:root:message"
        />,
      );
    });

    expect(loadExecutionContext).not.toHaveBeenCalled();
    expect(onAccept).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    expect(loadExecutionContext).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("이슈 실행 승인");
    expect(onAccept).not.toHaveBeenCalled();

    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => approve?.click());

    expect(loadExecutionContext).toHaveBeenCalledTimes(2);
    expect(onAccept).toHaveBeenCalledWith({
      provider: "codex",
      model: null,
      effort: null,
      workerId: null,
    });
  });

  it("rechecks the current run and rejects a state change before mutation", async () => {
    let latestRun = backlogRun;
    const onAccept = vi.fn();
    await act(async () => {
      root.render(
        <IssueExecutionApproval
          loadExecutionContext={async () => context(latestRun)}
          onAccept={onAccept}
          onAccepted={vi.fn()}
          proposal={pendingProposal}
          surfaceKey="issue:message"
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    latestRun = {
      ...backlogRun,
      status: "queued",
      dispatchedAt: "2026-08-11T00:02:00.000Z",
    } as HuntRun;
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => approve?.click());

    expect(onAccept).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("상태 또는 배정이 변경");
    expect(document.body.textContent).not.toContain("이슈 실행 승인");
  });

  it("coalesces rapid final approval clicks into one mutation", async () => {
    let resolveAccept!: (proposal: ExecutionProposalView) => void;
    const onAccept = vi.fn(() => new Promise<ExecutionProposalView>((resolve) => {
      resolveAccept = resolve;
    }));
    await act(async () => {
      root.render(
        <IssueExecutionApproval
          executionContext={context()}
          onAccept={onAccept}
          onAccepted={vi.fn()}
          proposal={pendingProposal}
          surfaceKey="issue:double-submit"
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"))!;
    await act(async () => {
      approve.click();
      approve.click();
      await Promise.resolve();
    });
    expect(onAccept).toHaveBeenCalledTimes(1);
    await act(async () => resolveAccept({
      ...pendingProposal,
      status: "accepted",
      acceptedAt: "2026-08-11T00:03:00.000Z",
      requestedProvider: "codex",
    }));
  });

  it("ignores a delayed context after the surface unmounts", async () => {
    let resolveContext!: (value: ExecutionApprovalContext) => void;
    const loadExecutionContext = vi.fn(
      () => new Promise<ExecutionApprovalContext>((resolve) => {
        resolveContext = resolve;
      }),
    );
    const onAccept = vi.fn();
    await act(async () => {
      root.render(
        <IssueExecutionApproval
          loadExecutionContext={loadExecutionContext}
          onAccept={onAccept}
          onAccepted={vi.fn()}
          proposal={pendingProposal}
          surfaceKey="channel:before-back"
        />,
      );
    });
    act(() => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    await act(async () => root.unmount());
    await act(async () => resolveContext(context()));

    expect(onAccept).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("이슈 실행 승인");
    root = createRoot(container);
  });

  it("does not reopen after a delayed context load when the proposal is accepted remotely", async () => {
    let resolveContext!: (value: ExecutionApprovalContext) => void;
    const loadExecutionContext = vi.fn(
      () => new Promise<ExecutionApprovalContext>((resolve) => {
        resolveContext = resolve;
      }),
    );
    const onAccept = vi.fn();
    const render = (proposal: ExecutionProposalView) => (
      <IssueExecutionApproval
        loadExecutionContext={loadExecutionContext}
        onAccept={onAccept}
        onAccepted={vi.fn()}
        proposal={proposal}
        surfaceKey="channel:remote-open"
      />
    );

    await act(async () => root.render(render(pendingProposal)));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("실행 설정 확인 중");

    await act(async () => root.render(render(remotelyAcceptedProposal)));
    await act(async () => resolveContext(context()));

    expect(onAccept).not.toHaveBeenCalled();
    expect(container.textContent).toContain("실행이 명시적으로 승인");
    expect(document.body.textContent).not.toContain("이슈 실행 승인");
  });

  it("does not submit after delayed preflight when the proposal is accepted remotely", async () => {
    let resolvePreflight!: (value: ExecutionApprovalContext) => void;
    let loadCount = 0;
    const loadExecutionContext = vi.fn(() => {
      loadCount += 1;
      if (loadCount === 1) return Promise.resolve(context());
      return new Promise<ExecutionApprovalContext>((resolve) => {
        resolvePreflight = resolve;
      });
    });
    const onAccept = vi.fn();
    const render = (proposal: ExecutionProposalView) => (
      <IssueExecutionApproval
        loadExecutionContext={loadExecutionContext}
        onAccept={onAccept}
        onAccepted={vi.fn()}
        proposal={proposal}
        surfaceKey="channel:remote-preflight"
      />
    );

    await act(async () => root.render(render(pendingProposal)));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => {
      approve?.click();
      await Promise.resolve();
    });
    expect(loadExecutionContext).toHaveBeenCalledTimes(2);

    await act(async () => root.render(render(remotelyAcceptedProposal)));
    await act(async () => resolvePreflight(context()));

    expect(onAccept).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("이슈 실행 승인");
  });

  it("resets a delayed opening request when approval becomes disabled", async () => {
    let resolveFirstContext!: (value: ExecutionApprovalContext) => void;
    let loadCount = 0;
    const loadExecutionContext = vi.fn(() => {
      loadCount += 1;
      if (loadCount === 1) {
        return new Promise<ExecutionApprovalContext>((resolve) => {
          resolveFirstContext = resolve;
        });
      }
      return Promise.resolve(context());
    });
    const render = (disabledReason: string | null) => (
      <IssueExecutionApproval
        disabledReason={disabledReason}
        loadExecutionContext={loadExecutionContext}
        onAccept={vi.fn()}
        onAccepted={vi.fn()}
        proposal={pendingProposal}
        surfaceKey="channel:disable-boundary"
      />
    );

    await act(async () => root.render(render(null)));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
      await Promise.resolve();
    });
    await act(async () => root.render(render("채널이 보관되었습니다.")));
    await act(async () => resolveFirstContext(context()));

    expect(document.body.textContent).not.toContain("이슈 실행 승인");
    expect(container.textContent).toContain("채널이 보관되었습니다.");

    await act(async () => root.render(render(null)));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    expect(loadExecutionContext).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("이슈 실행 승인");
  });

  it("preserves valid execution choices across preflight refresh and a failed retry", async () => {
    const openCodeWorker = {
      ...worker,
      id: "worker-opencode",
      label: "OpenCode Mac",
      agentProvider: "opencode" as const,
      providers: ["opencode"] as ExecutionWorker["providers"],
    };
    const refreshedContext = (): ExecutionApprovalContext => ({
      run: { ...backlogRun },
      workers: [{ ...worker }, { ...openCodeWorker }],
    });
    let resolvePreflight!: (value: ExecutionApprovalContext) => void;
    let loadCount = 0;
    const loadExecutionContext = vi.fn(() => {
      loadCount += 1;
      if (loadCount === 2) {
        return new Promise<ExecutionApprovalContext>((resolve) => {
          resolvePreflight = resolve;
        });
      }
      return Promise.resolve(refreshedContext());
    });
    const accepted = {
      ...remotelyAcceptedProposal,
      requestedProvider: "opencode" as const,
      requestedModel: "openai/custom-agent",
      requestedEffort: "high" as const,
      requestedWorkerId: openCodeWorker.id,
    };
    let rejectFirstAccept!: (reason: Error) => void;
    const onAccept = vi.fn()
      .mockImplementationOnce(() => new Promise<ExecutionProposalView>(
        (_resolve, reject) => {
          rejectFirstAccept = reject;
        },
      ))
      .mockResolvedValueOnce(accepted);

    await act(async () => {
      root.render(
        <IssueExecutionApproval
          loadExecutionContext={loadExecutionContext}
          onAccept={onAccept}
          onAccepted={vi.fn()}
          proposal={pendingProposal}
          surfaceKey="issue:preserve-selection"
        />,
      );
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="실행 프로바이더"]')
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="opencode"]',
        )
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="선호 모델"]')
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="openai/custom-agent"]',
        )
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Effort"]')
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="high"]',
        )
        ?.click();
    });
    const workerCard = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        ".worker-readiness-row",
      ),
    ).find((button) => button.textContent?.includes("OpenCode Mac"))!;
    await act(async () => workerCard.click());

    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"))!;
    await act(async () => {
      approve.click();
      await Promise.resolve();
    });
    await act(async () => {
      resolvePreflight(refreshedContext());
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      document.body.querySelector<HTMLButtonElement>(
        '[aria-label="실행 프로바이더"]',
      )?.textContent,
    ).toContain("OpenCode");
    expect(
      document.body.querySelector<HTMLButtonElement>(
        '[aria-label="선호 모델"]',
      )?.textContent,
    ).toContain("Custom Agent");
    expect(workerCard.getAttribute("aria-pressed")).toBe("true");
    expect(onAccept).toHaveBeenCalledTimes(1);

    await act(async () => rejectFirstAccept(new Error("일시적인 승인 충돌")));
    expect(document.body.textContent).toContain("일시적인 승인 충돌");
    expect(
      document.body.querySelector<HTMLButtonElement>(
        '[aria-label="선호 모델"]',
      )?.textContent,
    ).toContain("Custom Agent");
    expect(workerCard.getAttribute("aria-pressed")).toBe("true");

    const retry = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"))!;
    await act(async () => retry.click());

    const expectedInput = {
      provider: "opencode",
      model: "openai/custom-agent",
      effort: "high",
      workerId: openCodeWorker.id,
    };
    expect(onAccept).toHaveBeenNthCalledWith(1, expectedInput);
    expect(onAccept).toHaveBeenNthCalledWith(2, expectedInput);
  });

  it("ignores a delayed approval result after channel or thread navigation", async () => {
    let resolveAccept!: (proposal: ExecutionProposalView) => void;
    const onAccept = vi.fn(() => new Promise<ExecutionProposalView>((resolve) => {
      resolveAccept = resolve;
    }));
    const onAccepted = vi.fn();
    const render = (surfaceKey: string) => (
      <IssueExecutionApproval
        executionContext={context()}
        onAccept={onAccept}
        onAccepted={onAccepted}
        proposal={pendingProposal}
        surfaceKey={surfaceKey}
      />
    );
    await act(async () => root.render(render("channel-a:thread-a")));
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-approve",
      )?.click();
    });
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"))!;
    await act(async () => {
      approve.click();
      await Promise.resolve();
    });
    expect(onAccept).toHaveBeenCalledTimes(1);

    await act(async () => root.render(render("channel-a:root")));
    await act(async () => resolveAccept({
      ...pendingProposal,
      status: "accepted",
      acceptedAt: "2026-08-11T00:05:00.000Z",
      requestedProvider: "codex",
    }));

    expect(onAccepted).not.toHaveBeenCalled();
    expect(container.textContent).toContain("실행 설정을 검토");
  });

  it("shows accepted settings and trusted delegation attribution", async () => {
    const onIssueOpen = vi.fn();
    await act(async () => {
      root.render(
        <IssueExecutionApproval
          executionContext={context()}
          onAccept={vi.fn()}
          onAccepted={vi.fn()}
          onIssueOpen={onIssueOpen}
          projectName="Briar"
          proposal={{
            ...pendingProposal,
            status: "accepted",
            acceptedAt: "2026-08-11T00:04:00.000Z",
            requestedProvider: "codex",
            requestedModel: "gpt-5.6-sol",
            requestedEffort: "high",
            requestedWorkerId: worker.id,
            delegatedByAgentId: "44444444-4444-4444-8444-444444444444",
            delegatedByAgentName: "Bumble",
          }}
          surfaceKey="channel:accepted"
        />,
      );
    });
    expect(container.textContent).toContain("Organization Agent Bumble의 위임");
    expect(container.textContent).toContain("codex · gpt-5.6-sol · high");
    expect(container.textContent).toContain("Build Mac");
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".execution-proposal-view",
      )?.click();
    });
    expect(onIssueOpen).toHaveBeenCalledWith(pendingProposal.runId);
  });

  it("resolves an accepted Worker label without reopening the approval dialog", async () => {
    const loadExecutionContext = vi.fn(async () => context());
    await act(async () => {
      root.render(
        <IssueExecutionApproval
          loadExecutionContext={loadExecutionContext}
          onAccept={vi.fn()}
          onAccepted={vi.fn()}
          proposal={{
            ...pendingProposal,
            status: "accepted",
            acceptedAt: "2026-08-11T00:04:00.000Z",
            requestedProvider: "codex",
            requestedWorkerId: worker.id,
          }}
          surfaceKey="channel:accepted-loader"
        />,
      );
      await Promise.resolve();
    });

    expect(loadExecutionContext).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Build Mac");
    expect(document.body.textContent).not.toContain("이슈 실행 승인");
  });

  it("does not show a pending-only disabled reason on accepted history", async () => {
    await act(async () => {
      root.render(
        <IssueExecutionApproval
          disabledReason="보관된 채널에서는 실행을 승인할 수 없습니다."
          executionContext={context()}
          onAccept={vi.fn()}
          onAccepted={vi.fn()}
          proposal={{
            ...pendingProposal,
            status: "accepted",
            acceptedAt: "2026-08-11T00:04:00.000Z",
            requestedProvider: "codex",
          }}
          surfaceKey="channel:archived-accepted"
        />,
      );
    });

    expect(container.textContent).not.toContain("보관된 채널");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
