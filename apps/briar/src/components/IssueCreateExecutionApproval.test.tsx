/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultAgentProviderModelCatalog,
  loadAgentProviderModels,
} from "../lib/project-llm";
import type { ExecutionWorker } from "../types";
import { IssueCreateExecutionApproval } from "./IssueCreateExecutionApproval";

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
  id: "worker-create",
  deviceId: "device-create",
  ownerUserId: "owner",
  label: "Create Mac",
  agentProvider: "claude",
  providers: ["claude"],
  versions: {},
  state: "online",
  readiness: "available",
  acceptingWork: true,
  readinessDetail: null,
  capabilities: {},
  maxConcurrentSessions: 1,
  activeSessions: 0,
  availableSessions: 1,
  lastHeartbeatAt: "2026-08-20T00:00:00.000Z",
  createdAt: "2026-08-20T00:00:00.000Z",
};

describe("IssueCreateExecutionApproval", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.mocked(loadAgentProviderModels).mockResolvedValue(
      defaultAgentProviderModelCatalog,
    );
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    document.body.innerHTML = "";
  });

  it("does nothing on cancel and sends one combined approval on final confirm", async () => {
    const loadExecutionContext = vi.fn(async () => ({
      run: null,
      workers: [worker],
    }));
    const onAccept = vi.fn(async () => null);
    await act(async () => {
      root.render(
        <IssueCreateExecutionApproval
          issueAccepted={false}
          loadExecutionContext={loadExecutionContext}
          onAccept={onAccept}
          proposalId="proposal-create"
          targetTitle="Create and execute"
        />,
      );
    });

    expect(onAccept).not.toHaveBeenCalled();
    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )?.click();
    });
    expect(document.body.textContent).toContain("이슈 생성·실행 승인");
    expect(onAccept).not.toHaveBeenCalled();

    const cancel = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("취소"));
    await act(async () => cancel?.click());
    expect(onAccept).not.toHaveBeenCalled();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(
        ".channel-proposal-approve-button",
      )?.click();
    });
    const approve = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>("button"),
    ).filter((button) =>
      button.textContent?.includes("이슈 생성·실행 승인")
    ).at(-1);
    await act(async () => {
      approve?.click();
      approve?.click();
      await Promise.resolve();
    });

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept).toHaveBeenCalledWith({
      provider: "claude",
      model: null,
      effort: null,
      workerId: null,
    });
  });
});
