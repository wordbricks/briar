/** @vitest-environment jsdom */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import type { ExecutionWorker } from "../types";
import { CompanionBottomNavigation } from "./CompanionBottomNavigation";
import { companionActiveWorkerCount } from "./CompanionHostStatusDialog";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const worker = (overrides: Partial<ExecutionWorker> = {}): ExecutionWorker => ({
  id: "worker-1",
  deviceId: "device-1",
  ownerUserId: "user-1",
  label: "Mac Studio",
  agentProvider: "codex",
  providers: ["codex"],
  versions: { briar: "1.2.3" },
  state: "online",
  readiness: "available",
  acceptingWork: true,
  readinessDetail: "작업 수신 가능",
  capabilities: {},
  maxConcurrentSessions: 3,
  activeSessions: 1,
  availableSessions: 2,
  lastHeartbeatAt: "2026-08-29T12:00:00Z",
  createdAt: "2026-08-01T12:00:00Z",
  ...overrides,
});

describe("CompanionBottomNavigation", () => {
  it("opens the issue menu and shows host status in a dialog", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const onCreate = vi.fn();

    await renderReactTestRoot(
      root,
      <CompanionBottomNavigation
        activeDestination="all"
        onCreate={onCreate}
        onDmsOpen={() => undefined}
        onHomeOpen={() => undefined}
        onInboxOpen={() => undefined}
        onStatusChange={() => undefined}
        unreadDmCount={0}
        unreadInboxCount={0}
        workers={[worker()]}
      />,
    );

    const menuTrigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="이슈 메뉴"]',
    );
    await act(async () => {
      menuTrigger?.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, button: 0 }),
      );
    });

    const hostItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => item.textContent?.includes("호스트"));
    expect(hostItem).toBeDefined();
    await act(async () => hostItem?.click());

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Worker 실행 환경");
    expect(dialog?.textContent).toContain("Mac Studio");
    expect(dialog?.textContent).toContain("작업 수신 가능");
    expect(onCreate).not.toHaveBeenCalled();
    await cleanup();
  });

  it("counts only online hosts that are accepting work", () => {
    expect(
      companionActiveWorkerCount([
        worker(),
        worker({ id: "busy", readiness: "busy" }),
        worker({ id: "offline", readiness: "offline" }),
        worker({ id: "paused", acceptingWork: false }),
        worker({ id: "stale", state: "stale" }),
      ]),
    ).toBe(2);
  });
});
