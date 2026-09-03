/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import type { ExecutionWorker } from "../types";
import {
  TeamAgentDesignatedWorkerSelect,
  teamAgentDesignatedWorkerOptions,
} from "./TeamAgentDesignatedWorkerSelect";

const worker = (
  id: string,
  label: string,
  readiness: ExecutionWorker["readiness"] = "available",
): ExecutionWorker => ({
  id,
  deviceId: `device-${id}`,
  ownerUserId: "owner",
  label,
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
  lastHeartbeatAt: "2026-08-27T00:00:00.000Z",
  createdAt: "2026-08-27T00:00:00.000Z",
});

describe("TeamAgentDesignatedWorkerSelect", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("lists only eligible policy Workers while retaining an unavailable selection", () => {
    const eligible = worker("eligible", "Build Mac");
    const unavailable = worker("unavailable", "Offline Mac", "offline");
    const options = teamAgentDesignatedWorkerOptions({
      workers: [eligible, unavailable],
      policy: {
        selectionMode: "allowlist",
        defaultWorkerId: eligible.id,
        allowedWorkerIds: [eligible.id],
        updatedAt: null,
      },
      provider: "codex",
      model: null,
      effort: null,
      selectedWorkerId: unavailable.id,
      selectedWorkerLabel: "Offline Mac",
      automaticLabel: "Automatic",
      unavailableLabel: (label) => `${label} (unavailable)`,
    });

    expect(options).toEqual([
      { label: "Automatic", value: "" },
      { label: "Build Mac", value: "eligible" },
      { label: "Offline Mac (unavailable)", value: "unavailable" },
    ]);
  });

  it("renders the Designated Worker setting and can return to automatic placement", async () => {
    const onChange = vi.fn();
    const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
    await renderReactTestRoot(
      root,
      <TeamAgentDesignatedWorkerSelect
        effort={null}
        model={null}
        onChange={onChange}
        provider="codex"
        selectedWorkerId="missing-worker"
        selectedWorkerLabel="Retained Mac"
        workers={[]}
      />,
    );

    expect(document.body.textContent).toContain("Designated Worker");
    expect(document.body.textContent).toContain("Retained Mac (현재 사용 불가)");
    expect(document.body.textContent).toContain("새 채널 스레드");
    const trigger = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Designated Worker"]',
    );
    await act(async () => trigger?.click());
    const automatic = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="option"]'),
    ).find((option) => option.textContent?.includes("자동 선택"));
    await act(async () => automatic?.click());
    expect(onChange).toHaveBeenCalledWith(null);

    await cleanup();
  });
});
