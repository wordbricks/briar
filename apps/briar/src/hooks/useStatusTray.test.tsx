/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, useI18n } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import type { StatusTraySnapshot } from "../generated/tauri";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { lockedTeamIdAtom } from "../state/platform";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { tokenAtom } from "../state/session/atoms";
import { applySyncEvent } from "../state/sync/apply";
import { activeTeamIdAtom } from "../state/team/atoms";
import { createReactTestRoot, flush } from "../test/react";
import type { DashboardPayload, HuntRun, Project, StatusTrayRun } from "../types";
import {
  statusTrayApiAtom,
  type StatusTrayApi,
} from "../state/status-tray/atoms";
import { useStatusTray } from "./useStatusTray";

/*
  The tray is a side effect with no view, so what these cases check is what
  reaches Rust: the runs of the open dashboard merged with the ones the
  organization poll returns, and nothing at all in a project window.
*/

const team: Project = { ...demoDashboard.team, id: "team-a", name: "Team A" };

const runningRun = (id: string): HuntRun => ({
  ...demoDashboard.runs[0]!,
  id,
  title: `Run ${id}`,
  status: "running",
});

const payload = (runs: HuntRun[]): DashboardPayload => ({
  ...demoDashboard,
  team,
  runs,
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

const trayRun = (id: string, teamId: string): StatusTrayRun => ({
  teamId,
  teamName: teamId,
  id,
  title: `Run ${id}`,
  status: "running",
  workflowStage: null,
  workflowStageLabel: null,
  startedAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  lastEventAt: "2026-09-01T00:00:00.000Z",
});

class TrayBridge {
  readonly snapshots: StatusTraySnapshot[] = [];
  readonly pollRequests: string[] = [];
  readonly workerLabelRefreshes: number[] = [];
  pollResult: StatusTrayRun[] = [];

  api(overrides: Partial<StatusTrayApi> = {}): StatusTrayApi {
    return {
      loadStatusTrayRuns: (async (_token: string, organizationId: string) => {
        this.pollRequests.push(organizationId);
        return { runs: this.pollResult };
      }) as StatusTrayApi["loadStatusTrayRuns"],
      syncStatusTray: async (snapshot: StatusTraySnapshot) => {
        this.snapshots.push(snapshot);
      },
      syncExecutionWorkerLabels: async () => {
        this.workerLabelRefreshes.push(1);
      },
      macDesktop: true,
      desktop: true,
      // Long enough that the poll never fires a second time on its own.
      pollIntervalMs: 1_000_000,
      ...overrides,
    };
  }
}

function Effects() {
  useStatusTray();
  return null;
}

/** Lets a case drive the locale the way the settings screen does. */
let setLocale: ((locale: "ko" | "en" | "zh") => void) | null = null;
function LocaleControl() {
  setLocale = useI18n().setLocale;
  return null;
}

const mount = async (registry: AtomRegistry) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <LocaleControl />
        <Effects />
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  return view;
};

const harness = (
  bridge: TrayBridge,
  lockedTeamId: string | null = null,
): AtomRegistry =>
  createTestRegistry([
    [tokenAtom, "token-1"],
    [activeOrganizationIdAtom, "org-a"],
    [activeTeamIdAtom, team.id],
    [lockedTeamIdAtom, lockedTeamId],
    [statusTrayApiAtom, bridge.api()],
  ]);

const trayTitles = (snapshot: StatusTraySnapshot | undefined) =>
  snapshot?.items.map((item: { title: string }) => item.title) ?? [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useStatusTray", () => {
  it("pushes the open dashboard's running runs to the tray", async () => {
    const bridge = new TrayBridge();
    const registry = harness(bridge);

    const view = await mount(registry);
    await flush();
    // Nothing has been synced for any team, so the tray is empty — the poll
    // seeds from the open team, and there is no open team's board yet.
    expect(trayTitles(bridge.snapshots.at(-1))).toEqual([]);

    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-snapshot",
        teamId: team.id,
        payload: payload([runningRun("run-1"), {
          ...demoDashboard.runs[0]!,
          id: "run-done",
          status: "completed",
        }]),
      });
    });
    await flush();

    // Only running runs reach the tray.
    expect(trayTitles(bridge.snapshots.at(-1))).toEqual(["Run run-1"]);
    expect(bridge.workerLabelRefreshes).toHaveLength(1);

    await view.cleanup();
  });

  it("keeps the polled runs of other teams alongside the open one", async () => {
    const bridge = new TrayBridge();
    const registry = harness(bridge);
    bridge.pollResult = [trayRun("run-other", "team-b")];

    const view = await mount(registry);
    await flush();
    expect(bridge.pollRequests).toEqual(["org-a"]);

    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-snapshot",
        teamId: team.id,
        payload: payload([runningRun("run-1")]),
      });
    });
    await flush();

    const titles = trayTitles(bridge.snapshots.at(-1));
    expect(titles).toContain("Run run-other");
    expect(titles).toContain("Run run-1");

    await view.cleanup();
  });

  it("does nothing in a project window", async () => {
    const bridge = new TrayBridge();
    const registry = harness(bridge, "team-a");
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: payload([runningRun("run-1")]),
    });

    const view = await mount(registry);
    await flush();

    expect(bridge.snapshots).toEqual([]);
    expect(bridge.pollRequests).toEqual([]);
    expect(bridge.workerLabelRefreshes).toEqual([]);

    await view.cleanup();
  });

  it("does nothing outside the packaged macOS app", async () => {
    const bridge = new TrayBridge();
    const registry = harness(bridge);
    registry.set(statusTrayApiAtom, bridge.api({ macDesktop: false }));

    const view = await mount(registry);
    await flush();

    expect(bridge.snapshots).toEqual([]);
    expect(bridge.pollRequests).toEqual([]);
    // Worker labels are refreshed on any desktop build, tray or not.
    expect(bridge.workerLabelRefreshes).toHaveLength(1);

    await view.cleanup();
  });

  it("never pushes an empty tray when the dashboard is already loaded", async () => {
    const bridge = new TrayBridge();
    const registry = harness(bridge);
    // The cold boot a stored snapshot produces: the board is in the store
    // before anything mounts.
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: payload([runningRun("run-1")]),
    });

    const view = await mount(registry);
    await flush();

    /*
      Every snapshot that reached Rust listed the run. The poll used to clear
      the list as it started, one pass before the merge refilled it, so the
      first thing the tray showed on a hydrated boot was "nothing running".
    */
    expect(bridge.snapshots.length).toBeGreaterThan(0);
    for (const snapshot of bridge.snapshots) {
      expect(trayTitles(snapshot)).toEqual(["Run run-1"]);
    }

    await view.cleanup();
  });

  it("re-syncs the snapshot when the locale changes", async () => {
    const bridge = new TrayBridge();
    const registry = harness(bridge);

    const view = await mount(registry);
    await flush();
    expect(bridge.snapshots.at(-1)?.runningLabel).toBe("Running");

    await act(async () => setLocale?.("ko"));
    await flush();

    // The tray is pushed to Rust with no view in between, so the locale reaches
    // it through `state/i18n` rather than through a render.
    expect(bridge.snapshots.at(-1)?.runningLabel).toBe("실행 중");

    await view.cleanup();
  });

  it("empties the tray when the account signs out", async () => {
    const bridge = new TrayBridge();
    const registry = harness(bridge);
    bridge.pollResult = [trayRun("run-other", "team-b")];

    const view = await mount(registry);
    await flush();
    expect(trayTitles(bridge.snapshots.at(-1))).toContain("Run run-other");

    await act(async () => registry.set(tokenAtom, null));
    await flush();

    expect(trayTitles(bridge.snapshots.at(-1))).toEqual([]);

    await view.cleanup();
  });
});
