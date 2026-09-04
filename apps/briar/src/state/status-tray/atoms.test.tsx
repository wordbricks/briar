/** @vitest-environment jsdom */

import { RegistryContext, useAtomMount } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createReactTestRoot } from "../../test/react";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { lockedTeamIdAtom } from "../platform";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import type { StatusTrayRun } from "../../types";
import {
  statusTrayApiAtom,
  statusTrayPollAtom,
  statusTrayRunsAtom,
  statusTraySnapshotAtom,
  statusTrayTeamRunsAtom,
  STATUS_TRAY_POLL_IDLE_TTL_MS,
  type StatusTrayApi,
} from "./atoms";

/*
  The tray poll runs on a timer and nothing renders from it, so what has to be
  pinned is when it is allowed to run at all: it starts when something first
  observes it, keeps its cadence while observed, and aborts the request in
  flight once the last observer is gone.
*/

const trayRun = (id: string): StatusTrayRun => ({
  teamId: "team-b",
  teamName: "Team B",
  id,
  title: `Run ${id}`,
  status: "running",
  workflowStage: null,
  workflowStageLabel: null,
  startedAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastEventAt: "2026-09-01T00:00:00.000Z",
});

const POLL_INTERVAL_MS = 30_000;

class TrayServer {
  readonly requests: AbortSignal[] = [];
  runs: StatusTrayRun[] = [trayRun("run-1")];
  /** Leaves the next request in flight, so its cancellation is observable. */
  hold = false;

  api(overrides: Partial<StatusTrayApi> = {}): StatusTrayApi {
    return {
      loadStatusTrayRuns: ((
        _token: string,
        _organizationId: string,
        signal?: AbortSignal,
      ) => {
        if (signal) this.requests.push(signal);
        if (this.hold) return new Promise(() => undefined);
        return Promise.resolve({ runs: this.runs });
      }) as StatusTrayApi["loadStatusTrayRuns"],
      syncStatusTray: async () => undefined,
      syncExecutionWorkerLabels: async () => undefined,
      macDesktop: true,
      desktop: true,
      pollIntervalMs: POLL_INTERVAL_MS,
      ...overrides,
    };
  }
}

function Mounted() {
  useAtomMount(statusTrayPollAtom);
  return null;
}

/** All three subscriptions, in the order `useStatusTray` mounts them. */
function MountedTray() {
  useAtomMount(statusTrayPollAtom);
  useAtomMount(statusTrayTeamRunsAtom);
  useAtomMount(statusTraySnapshotAtom);
  return null;
}

const renderMounted = async (
  registry: AtomRegistry,
  element: React.ReactElement,
) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      {element}
    </RegistryContext.Provider>,
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  return view;
};

const mount = (registry: AtomRegistry) =>
  renderMounted(registry, <Mounted />);

const mountAll = (registry: AtomRegistry) =>
  renderMounted(registry, <MountedTray />);

const harness = (server: TrayServer, overrides: Partial<StatusTrayApi> = {}) =>
  createTestRegistry([
    [tokenAtom, "token-1"],
    [activeOrganizationIdAtom, "org-a"],
    [lockedTeamIdAtom, null],
    [statusTrayApiAtom, server.api(overrides)],
  ]);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("statusTrayPollAtom", () => {
  it("polls while observed and aborts once nothing observes it", async () => {
    const server = new TrayServer();
    const registry = harness(server);

    const view = await mount(registry);
    expect(server.requests).toHaveLength(1);
    expect(registry.get(statusTrayRunsAtom)).toEqual([trayRun("run-1")]);

    // The next poll stays in flight, which is the state the finalizer has to
    // clean up: an aborted request rather than a resolved one nobody wants.
    server.hold = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
    });
    expect(server.requests).toHaveLength(2);
    expect(server.requests.every((signal) => !signal.aborted)).toBe(true);

    await view.cleanup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATUS_TRAY_POLL_IDLE_TTL_MS + 2_000);
    });

    // The finalizer aborted the request in flight and cleared the timer.
    expect(server.requests.at(-1)?.aborted).toBe(true);
    const requestsAfterTeardown = server.requests.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3);
    });
    expect(server.requests).toHaveLength(requestsAfterTeardown);
  });

  it("polls nothing in a project window", async () => {
    const server = new TrayServer();
    const registry = harness(server);
    registry.set(lockedTeamIdAtom, "team-a");

    const view = await mount(registry);

    expect(server.requests).toEqual([]);
    expect(registry.get(statusTrayRunsAtom)).toEqual([]);
    await view.cleanup();
  });

  it("stops pushing snapshots once the last observer is gone", async () => {
    const server = new TrayServer();
    const pushes: unknown[] = [];
    const registry = harness(server, {
      syncStatusTray: async (snapshot: unknown) => {
        pushes.push(snapshot);
      },
    } as Partial<StatusTrayApi>);

    const view = await mountAll(registry);
    const pushesWhileMounted = pushes.length;
    expect(pushesWhileMounted).toBeGreaterThan(0);

    await view.cleanup();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STATUS_TRAY_POLL_IDLE_TTL_MS + 2_000);
    });

    /*
      The idle TTL has passed, so the three subscriptions are gone with the
      component that observed them. A tray list that changes now reaches Rust
      through nobody — which is the whole point of these being subscriptions
      rather than effects that outlive their reason to run.
    */
    await act(async () => {
      registry.set(statusTrayRunsAtom, [trayRun("run-late")]);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(pushes).toHaveLength(pushesWhileMounted);
  });

  it("empties the tray and stops when the account signs out", async () => {
    const server = new TrayServer();
    const registry = harness(server);

    const view = await mount(registry);
    expect(registry.get(statusTrayRunsAtom)).toHaveLength(1);

    await act(async () => {
      registry.set(tokenAtom, null);
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(registry.get(statusTrayRunsAtom)).toEqual([]);

    const requestsAfterSignOut = server.requests.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 2);
    });
    expect(server.requests).toHaveLength(requestsAfterSignOut);
    await view.cleanup();
  });
});
