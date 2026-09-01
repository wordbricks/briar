/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAgentProviderModelCatalog,
} from "../lib/project-llm";
import type { AgentProviderCapabilityCatalog } from "../lib/agent-provider-contract";
import type { ExecutionWorker } from "../types";
import { WorkerDispatchDialog } from "./WorkerDispatchDialog";

const workerCatalog = (): AgentProviderCapabilityCatalog => ({
  ...defaultAgentProviderModelCatalog,
  codex: {
    models: [{
      id: "gpt-5.6-sol",
      label: "GPT-5.6 Sol",
      efforts: [{ id: "high", label: "high" }],
    }],
    defaultEfforts: [],
    allowCustomModels: false,
    error: null,
  },
  claude: {
    models: [{
      id: "opus",
      label: "Claude Opus",
      efforts: [{ id: "high", label: "high" }],
    }],
    defaultEfforts: [],
    allowCustomModels: true,
    error: null,
  },
});

const worker = (
  id: string,
  label: string,
  providerCapabilities = workerCatalog(),
): ExecutionWorker => ({
  id,
  deviceId: `device-${id}`,
  ownerUserId: "owner",
  label,
  agentProvider: "codex",
  providers: ["codex", "claude", "grok"],
  versions: {},
  state: "online",
  readiness: "available",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: { providerCapabilities },
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: 1,
  lastHeartbeatAt: "2026-07-29T00:00:00Z",
  createdAt: "2026-07-29T00:00:00Z",
});

describe("WorkerDispatchDialog", () => {
  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
  });


  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses explicit approval language without changing the selected execution input", async () => {
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        intent="approve_execution"
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={{ title: "Approval boundary" } as never}
        workers={[worker("worker-approval", "Approval Mac")]}
      />,
    );

    expect(document.body.textContent).toContain("이슈 실행 승인");
    expect(document.body.textContent).toContain("명시적으로 승인");
    const approveButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => approveButton?.click());
    expect(onSubmit).toHaveBeenCalledWith({
      effort: null,
      model: null,
      provider: "codex",
      workerId: null,
    });

    await cleanup();
  });

  it("preselects the first supported recommendation for the issue difficulty", async () => {
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        intent="approve_execution"
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={{ title: "Hard issue", difficulty: "hard" } as never}
        workers={[worker("worker-hard", "Hard Work Mac")]}
      />,
    );

    const approveButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => approveButton?.click());
    expect(onSubmit).toHaveBeenCalledWith({
      effort: "high",
      model: "opus",
      provider: "claude",
      workerId: null,
    });

    await cleanup();
  });

  it("shows a disabled completion state after dispatch succeeds", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        didDispatchSuccessfully
        error={null}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        run={null}
        workers={[worker("worker-complete", "Complete Mac")]}
      />,
    );

    const completeButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="실행 완료"]',
    );
    expect(completeButton?.disabled).toBe(true);
    expect(completeButton?.textContent).toContain("실행 완료");

    await cleanup();
  });

  it("groups provider and model selection and locks both while dispatching", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        isDispatching
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        run={null}
        workers={[worker("worker-loading", "Loading Mac")]}
      />,
    );

    const selector = document.body.querySelector(
      '.worker-provider-model-selector[role="group"]',
    );
    expect(selector?.getAttribute("aria-label")).toContain("실행 프로바이더");
    expect(selector?.getAttribute("aria-label")).toContain("선호 모델");
    expect(
      selector?.querySelector<HTMLButtonElement>(".provider-model-selector-trigger")
        ?.disabled,
    ).toBe(true);
    expect(
      selector?.querySelector(".provider-model-selector-trigger-icon svg"),
    ).not.toBeNull();

    await cleanup();
  });

  it("announces an approval error inside the active dialog", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error="승인 상태가 변경되었습니다."
        intent="approve_execution"
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        run={{ title: "Approval conflict" } as never}
        workers={[worker("worker-error", "Error Mac")]}
      />,
    );

    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("승인 상태가 변경되었습니다.");

    await cleanup();
  });

  it("shows only policy-allowed Workers and preselects the project default", async () => {
    const allowed = worker("worker-allowed", "Allowed Mac");
    const denied = worker("worker-denied", "Denied Mac");
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        policy={{
          selectionMode: "allowlist",
          defaultWorkerId: allowed.id,
          allowedWorkerIds: [allowed.id],
          updatedAt: "2026-07-29T00:00:00Z",
        }}
        run={null}
        workers={[allowed, denied]}
      />,
    );

    expect(document.body.textContent).toContain("Allowed Mac");
    expect(document.body.textContent).not.toContain("Denied Mac");
    expect(document.body.textContent).not.toContain("Briar Agent");
    expect(
      document.body.querySelector<HTMLButtonElement>(
        '[aria-label="Worker 실행 환경"]',
      )?.textContent,
    ).toContain("Allowed Mac");
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="Worker 실행 환경"]')
        ?.click();
    });
    expect(
      document.body.querySelector('.select-menu-option[data-value=""]'),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        '.select-menu-option[data-value="worker-allowed"]',
      ),
    ).not.toBeNull();

    await cleanup();
  });

  it("submits an auto-assigned Worker when no specific Worker is chosen", async () => {
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={null}
        workers={[worker("worker-auto", "Auto Mac")]}
      />,
    );

    expect(
      document.body.querySelector('[aria-pressed="true"]')?.textContent,
    ).toContain("사용 가능한 Worker 자동 선택");

    const dispatchButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("실행 배정"));
    await act(async () => dispatchButton?.click());

    expect(onSubmit).toHaveBeenCalledWith({
      effort: null,
      model: null,
      provider: "codex",
      workerId: null,
    });

    await cleanup();
  });

  it("falls back to auto-assign when the preselected Worker is not available", async () => {
    const busy = {
      ...worker("worker-busy", "Busy Mac"),
      readiness: "busy" as const,
    } satisfies ExecutionWorker;
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={{
          requestedWorkerId: "worker-busy",
        } as never}
        workers={[busy]}
      />,
    );

    expect(
      document.body.querySelector('[aria-pressed="true"]')?.textContent,
    ).toContain("사용 가능한 Worker 자동 선택");

    await cleanup();
  });

  it("selects an execution provider independently", async () => {
    const codexWorker = {
      ...worker("worker-codex", "Codex Mac"),
      providers: ["codex"] as ExecutionWorker["providers"],
    };
    const claudeWorker = {
      ...worker("worker-claude", "Claude Mac"),
      providers: ["claude"] as ExecutionWorker["providers"],
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        run={null}
        workers={[codexWorker, claudeWorker]}
      />,
    );

    expect(document.body.textContent).toContain("Codex Mac");
    expect(document.body.textContent).not.toContain("Claude Mac");

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="선호 모델"]')
        ?.click();
    });
    expect(
      document.body.querySelector(
        '.provider-model-picker-provider[data-provider="grok"]',
      ),
    ).toBeNull();
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.provider-model-picker-provider[data-provider="claude"]',
        )
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLElement>(
          '.provider-model-picker-option[data-provider="claude"][data-value=""]',
        )
        ?.click();
    });

    expect(document.body.textContent).toContain("Claude Mac");
    expect(document.body.textContent).not.toContain("Codex Mac");

    await cleanup();
  });

  it("clears an incompatible preferred model when its provider is unavailable", async () => {
    const onSubmit = vi.fn();
    const claudeWorker = {
      ...worker("worker-claude-only", "Claude Mac"),
      providers: ["claude"] as ExecutionWorker["providers"],
      agentProvider: "claude" as const,
    };
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        intent="approve_execution"
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={{
          title: "Provider fallback",
          preferredProvider: "codex",
          preferredModel: "gpt-5.6-sol",
          preferredEffort: "ultra",
        } as never}
        workers={[claudeWorker]}
      />,
    );
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => approve?.click());

    expect(onSubmit).toHaveBeenCalledWith({
      provider: "claude",
      model: null,
      effort: null,
      workerId: null,
    });
    await cleanup();
  });

  it("searches OpenCode supported models and defaults to the provider model", async () => {
    const providerCapabilities: AgentProviderCapabilityCatalog = {
      ...defaultAgentProviderModelCatalog,
      opencode: {
        models: [
          { id: "openai/gpt-5.6", label: "GPT-5.6" },
          {
            id: "anthropic/claude-opus-4-6",
            label: "Claude Opus 4.6",
          },
        ],
        allowCustomModels: true,
        error: null,
      },
    };
    const openCodeWorker = {
      ...worker("worker-opencode", "OpenCode Mac", providerCapabilities),
      agentProvider: "opencode" as const,
      providers: ["opencode"] as ExecutionWorker["providers"],
    };
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={null}
        workers={[openCodeWorker]}
      />,
    );

    const modelSelect = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="선호 모델"]',
    )!;
    expect(modelSelect.textContent).toContain("프로바이더 기본 모델");
    await act(async () => {
      modelSelect.click();
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    const search = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="모델 검색"]',
    )!;
    expect(search.closest('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement).toBe(search);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(search, "anthropic");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(
      document.body.querySelector(
        '.provider-model-picker-option[data-value="anthropic/claude-opus-4-6"]',
      ),
    ).not.toBeNull();
    expect(
      document.body.querySelector(
        '.provider-model-picker-option[data-value="openai/gpt-5.6"]',
      ),
    ).toBeNull();
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.provider-model-picker-option[data-value="anthropic/claude-opus-4-6"]',
        )
        ?.click();
    });

    const dispatch = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("실행 배정"));
    await act(async () => dispatch?.click());

    expect(onSubmit).toHaveBeenCalledWith({
      provider: "opencode",
      model: "anthropic/claude-opus-4-6",
      effort: null,
      workerId: null,
    });
    await cleanup();
  });

  it("shows an unknown strict-provider model until the user selects a supported one", async () => {
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        intent="approve_execution"
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={{
          id: "run-retired-model",
          title: "Retired model",
          preferredProvider: "codex",
          preferredModel: "gpt-retired-preview",
          preferredEffort: "high",
        } as never}
        workers={[worker("worker-strict", "Strict Mac")]}
      />,
    );

    const modelSelect = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="선호 모델"]',
    )!;
    expect(modelSelect.textContent).toContain("gpt-retired-preview");
    await act(async () => modelSelect.click());
    expect(
      document.body.querySelector(
        '.provider-model-picker-option[data-value="gpt-retired-preview"]',
      ),
    ).not.toBeNull();
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.provider-model-picker-option[data-value="gpt-5.6-sol"]',
        )
        ?.click();
    });
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => approve?.click());

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      provider: "codex",
      model: "gpt-5.6-sol",
      effort: null,
    }));
    await cleanup();
  });

  it("cannot submit a hidden provider value when every Worker is offline", async () => {
    const offlineWorker = {
      ...worker("worker-offline", "Offline Mac"),
      readiness: "offline" as const,
      state: "stale" as const,
    };
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        intent="approve_execution"
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={{ id: "run-offline", title: "Offline approval" } as never}
        workers={[offlineWorker]}
      />,
    );

    const providerModelSelect = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="선호 모델"]',
    )!;
    expect(providerModelSelect.disabled).toBe(true);
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"))!;
    expect(approve.disabled).toBe(true);
    await act(async () => approve.click());
    expect(onSubmit).not.toHaveBeenCalled();

    await cleanup();
  });

  it("selects a Worker card and submits the Worker and provider", async () => {
    const first = worker("worker-first", "First Mac");
    const second = worker("worker-second", "Second Mac");
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={null}
        workers={[first, second]}
      />,
    );

    const secondCard = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        ".worker-readiness-row",
      ),
    ).find((button) => button.textContent?.includes("Second Mac"));
    expect(secondCard?.dataset.slot).toBe("choice-card");
    await act(async () => secondCard?.click());

    expect(secondCard?.getAttribute("aria-pressed")).toBe("true");

    const dispatchButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("실행 배정"));
    await act(async () => dispatchButton?.click());

    expect(onSubmit).toHaveBeenCalledWith({
      effort: null,
      model: null,
      provider: "codex",
      workerId: second.id,
    });

    await cleanup();
  });

  it("submits the selected model and effort", async () => {
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={null}
        workers={[worker("worker-model", "Model Mac")]}
      />,
    );
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="선호 모델"]')
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.provider-model-picker-provider[data-provider="claude"]',
        )
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLElement>(
          '.provider-model-picker-option[data-provider="claude"][data-value="opus"]',
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
    const dispatchButton = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("실행 배정"));
    await act(async () => dispatchButton?.click());

    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "claude",
        model: "opus",
        effort: "high",
      }),
    );

    await cleanup();
  });

  it("shows the deterministic model union advertised by project Workers", async () => {
    const catalog = (
      models: AgentProviderCapabilityCatalog["codex"]["models"],
    ): AgentProviderCapabilityCatalog => ({
      ...defaultAgentProviderModelCatalog,
      codex: {
        models,
        defaultEfforts: [],
        allowCustomModels: false,
        error: null,
      },
    });
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={vi.fn()}
        open
        run={null}
        workers={[
          worker(
            "worker-zeta",
            "Zeta Mac",
            catalog([
              { id: "remote-zeta", label: "Remote Zeta" },
              { id: "remote-shared", label: "Remote Shared" },
            ]),
          ),
          worker(
            "worker-alpha",
            "Alpha Mac",
            catalog([
              { id: "remote-alpha", label: "Remote Alpha" },
              { id: "remote-shared", label: "Remote Shared" },
            ]),
          ),
        ]}
      />,
    );

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="선호 모델"]')
        ?.click();
    });
    const modelValues = Array.from(
      document.body.querySelectorAll<HTMLElement>(
        ".provider-model-picker-option[data-value]",
      ),
    ).map((option) => option.dataset.value);
    expect(modelValues).toEqual([
      "",
      "remote-alpha",
      "remote-shared",
      "remote-zeta",
    ]);
    expect(modelValues).not.toContain("gpt-5.6-sol");

    await cleanup();
  });

  it("rejects an explicitly selected Worker that does not support the model", async () => {
    const catalog = (
      modelId: string,
    ): AgentProviderCapabilityCatalog => ({
      ...defaultAgentProviderModelCatalog,
      codex: {
        models: [{ id: modelId, label: modelId }],
        defaultEfforts: [],
        allowCustomModels: false,
        error: null,
      },
    });
    const alpha = worker("worker-alpha", "Alpha Mac", catalog("model-alpha"));
    const beta = worker("worker-beta", "Beta Mac", catalog("model-beta"));
    const onSubmit = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    await renderReactTestRoot(
      root,
      <WorkerDispatchDialog
        error={null}
        initialSelection={{
          provider: "codex",
          model: "model-beta",
          effort: null,
          workerId: alpha.id,
        }}
        isDispatching={false}
        onOpenChange={vi.fn()}
        onSubmit={onSubmit}
        open
        run={null}
        workers={[alpha, beta]}
      />,
    );

    expect(document.body.querySelector('[role="alert"]')?.textContent).toContain(
      "이 Worker는 선택한 프로바이더·모델·effort 조합을 지원하지 않습니다.",
    );
    const dispatch = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("실행 배정"))!;
    expect(dispatch.disabled).toBe(true);
    await act(async () => dispatch.click());
    expect(onSubmit).not.toHaveBeenCalled();

    await cleanup();
  });

});
