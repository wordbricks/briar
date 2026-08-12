/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAgentProviderModelCatalog,
  loadAgentProviderModels,
} from "../lib/project-llm";
import type { ExecutionWorker } from "../types";
import { WorkerDispatchDialog } from "./WorkerDispatchDialog";

vi.mock("../lib/project-llm", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/project-llm")>();
  return {
    ...original,
    loadAgentProviderModels: vi.fn(async () =>
      original.defaultAgentProviderModelCatalog
    ),
  };
});

const worker = (id: string, label: string): ExecutionWorker => ({
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
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: 1,
  lastHeartbeatAt: "2026-07-29T00:00:00Z",
  createdAt: "2026-07-29T00:00:00Z",
});

function changeInput(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("WorkerDispatchDialog", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.mocked(loadAgentProviderModels).mockReset();
    vi.mocked(loadAgentProviderModels).mockResolvedValue(
      defaultAgentProviderModelCatalog,
    );
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("uses explicit approval language without changing the selected execution input", async () => {
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

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

    await act(async () => root.unmount());
  });

  it("shows a disabled completion state after dispatch succeeds", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

    const completeButton = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="실행 완료"]',
    );
    expect(completeButton?.disabled).toBe(true);
    expect(completeButton?.textContent).toContain("실행 완료");

    await act(async () => root.unmount());
  });

  it("announces an approval error inside the active dialog", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("승인 상태가 변경되었습니다.");

    await act(async () => root.unmount());
  });

  it("shows only policy-allowed Workers and preselects the project default", async () => {
    const allowed = worker("worker-allowed", "Allowed Mac");
    const denied = worker("worker-denied", "Denied Mac");
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

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

    await act(async () => root.unmount());
  });

  it("submits an auto-assigned Worker when no specific Worker is chosen", async () => {
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

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

    await act(async () => root.unmount());
  });

  it("falls back to auto-assign when the preselected Worker is not available", async () => {
    const busy = {
      ...worker("worker-busy", "Busy Mac"),
      readiness: "busy" as const,
    } satisfies ExecutionWorker;
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

    expect(
      document.body.querySelector('[aria-pressed="true"]')?.textContent,
    ).toContain("사용 가능한 Worker 자동 선택");

    await act(async () => root.unmount());
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
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

    expect(document.body.textContent).toContain("Codex Mac");
    expect(document.body.textContent).not.toContain("Claude Mac");

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="실행 프로바이더"]')
        ?.click();
    });
    expect(
      document.body.querySelector(
        '.select-menu-option[data-value="grok"]',
      ),
    ).toBeNull();
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="claude"]',
        )
        ?.click();
    });

    expect(document.body.textContent).toContain("Claude Mac");
    expect(document.body.textContent).not.toContain("Codex Mac");

    await act(async () => root.unmount());
  });

  it("clears an incompatible preferred model when its provider is unavailable", async () => {
    const onSubmit = vi.fn();
    const claudeWorker = {
      ...worker("worker-claude-only", "Claude Mac"),
      providers: ["claude"] as ExecutionWorker["providers"],
      agentProvider: "claude" as const,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });
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
    await act(async () => root.unmount());
  });

  it("keeps an OpenCode custom model editable and submits its exact value", async () => {
    const openCodeWorker = {
      ...worker("worker-opencode", "OpenCode Mac"),
      agentProvider: "opencode" as const,
      providers: ["opencode"] as ExecutionWorker["providers"],
    };
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkerDispatchDialog
          error={null}
          intent="approve_execution"
          isDispatching={false}
          onOpenChange={vi.fn()}
          onSubmit={onSubmit}
          open
          run={{
            id: "run-opencode",
            title: "Custom OpenCode model",
            preferredProvider: "opencode",
            preferredModel: "openai/original-model",
            preferredEffort: "high",
          } as never}
          workers={[openCodeWorker]}
        />,
      );
    });

    const modelInput = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="선호 모델"]',
    )!;
    expect(modelInput.value).toBe("openai/original-model");
    await act(async () => {
      changeInput(modelInput, "anthropic/claude-opus-custom");
    });
    expect(modelInput.value).toBe("anthropic/claude-opus-custom");

    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"));
    await act(async () => approve?.click());

    expect(onSubmit).toHaveBeenCalledWith({
      provider: "opencode",
      model: "anthropic/claude-opus-custom",
      effort: "high",
      workerId: null,
    });
    await act(async () => root.unmount());
  });

  it("shows an unknown strict-provider model until the user selects a supported one", async () => {
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

    const modelSelect = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="선호 모델"]',
    )!;
    expect(modelSelect.textContent).toContain("gpt-retired-preview");
    await act(async () => modelSelect.click());
    expect(
      document.body.querySelector(
        '.select-menu-option[data-value="gpt-retired-preview"]',
      ),
    ).not.toBeNull();
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="gpt-5.6-sol"]',
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
      effort: "high",
    }));
    await act(async () => root.unmount());
  });

  it("cannot submit a hidden provider value when every Worker is offline", async () => {
    const offlineWorker = {
      ...worker("worker-offline", "Offline Mac"),
      readiness: "offline" as const,
      state: "stale" as const,
    };
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

    const providerSelect = document.body.querySelector<HTMLButtonElement>(
      '[aria-label="실행 프로바이더"]',
    )!;
    await act(async () => providerSelect.click());
    expect(
      document.body.querySelector('.select-menu-option[data-value="codex"]'),
    ).toBeNull();
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("승인하고 실행"))!;
    expect(approve.disabled).toBe(true);
    await act(async () => approve.click());
    expect(onSubmit).not.toHaveBeenCalled();

    await act(async () => root.unmount());
  });

  it("selects a Worker card and submits the Worker and provider", async () => {
    const first = worker("worker-first", "First Mac");
    const second = worker("worker-second", "Second Mac");
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });

    const secondCard = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>(
        ".worker-readiness-row",
      ),
    ).find((button) => button.textContent?.includes("Second Mac"));
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

    await act(async () => root.unmount());
  });

  it("submits the selected model and effort", async () => {
    const onSubmit = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
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
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="실행 프로바이더"]')
        ?.click();
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="claude"]',
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
          '.select-menu-option[data-value="opus"]',
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

    await act(async () => root.unmount());
  });

  it("uses the same provider model catalog as Supported models", async () => {
    vi.mocked(loadAgentProviderModels).mockResolvedValue({
      ...defaultAgentProviderModelCatalog,
      grok: {
        models: [
          { id: "grok-cli-latest", label: "Grok CLI Latest", isDefault: true },
          { id: "grok-cli-fast", label: "Grok CLI Fast" },
        ],
        error: null,
      },
    });
    const grokWorker = {
      ...worker("worker-grok-models", "Grok Mac"),
      agentProvider: "grok" as const,
      providers: ["grok"] as ExecutionWorker["providers"],
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkerDispatchDialog
          error={null}
          isDispatching={false}
          onOpenChange={vi.fn()}
          onSubmit={vi.fn()}
          open
          run={null}
          workers={[grokWorker]}
        />,
      );
    });
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>('[aria-label="선호 모델"]')
        ?.click();
    });

    expect(loadAgentProviderModels).toHaveBeenCalledOnce();
    expect(
      document.body.querySelector(
        '.select-menu-option[data-value="grok-cli-latest"]',
      )?.textContent,
    ).toContain("Grok CLI Latest");
    expect(
      document.body.querySelector(
        '.select-menu-option[data-value="grok-cli-fast"]',
      )?.textContent,
    ).toContain("Grok CLI Fast");
    expect(
      document.body.querySelector(
        '.select-menu-option[data-value="grok-4.5"]',
      ),
    ).toBeNull();

    await act(async () => root.unmount());
  });
});
