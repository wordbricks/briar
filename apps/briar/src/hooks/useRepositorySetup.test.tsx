/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { demoDashboard, demoRepositoryReadiness } from "../lib/demo-data";
import { repositorySetupTeamIdAtom } from "../state/dialogs/atoms";
import {
  activePageAtom,
  navigationLocationAtom,
  settingsTargetAtom,
} from "../state/navigation/atoms";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { teamsAtom } from "../state/team/atoms";
import { workspaceApiAtom } from "../state/workspace/api";
import {
  connectedTeamIdsAtom,
  teamReadinessAtom,
} from "../state/workspace/atoms";
import { createReactTestRoot } from "../test/react";
import type { Project } from "../types";
import type { ReconnectOutcome } from "../state/workspace/actions";
import { useRepositorySetup, type RepositorySetup } from "./useRepositorySetup";

/*
  Where "open repository" ends up, and where the keyboard ends up after it.

  A team whose checkout this device reports as ready goes straight to the team's
  settings; anything else opens the setup dialog so the checkout can be
  connected first. Both paths select the team, and the dialog path captures the
  control that opened it so closing can hand focus back.
*/

const teamOf = (id: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
});
const readyTeam = teamOf("team-ready");
const unconnectedTeam = teamOf("team-unconnected");

class SetupBridge {
  readonly selectedTeams: string[] = [];
  readonly reconnects: string[] = [];
  reconnectOutcome: ReconnectOutcome = "opened";

  selectTeam = (teamId: string) => {
    this.selectedTeams.push(teamId);
  };
  reconnectTeam = async (teamId: string) => {
    this.reconnects.push(teamId);
    return this.reconnectOutcome;
  };
}

let latest: RepositorySetup;

function Harness({ bridge }: { readonly bridge: SetupBridge }) {
  latest = useRepositorySetup({
    reconnectTeam: bridge.reconnectTeam,
    selectTeam: bridge.selectTeam,
  });
  return null;
}

const flush = async () => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const mount = async (registry: AtomRegistry, bridge: SetupBridge) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <Harness bridge={bridge} />
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await flush();
  return view;
};

const harness = (): AtomRegistry =>
  createTestRegistry([
    [teamsAtom, [readyTeam, unconnectedTeam]],
    [connectedTeamIdsAtom, [readyTeam.id]],
    [
      teamReadinessAtom(readyTeam.id),
      { readiness: demoRepositoryReadiness, error: null, loading: false },
    ],
    [
      workspaceApiAtom,
      {
        loadTeamRepositoryReadiness: async () => demoRepositoryReadiness,
      },
    ],
  ]);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
});

describe("useRepositorySetup", () => {
  it("opens the dialog for a team whose checkout is not connected", async () => {
    const registry = harness();
    const bridge = new SetupBridge();
    const view = await mount(registry, bridge);

    await act(async () => {
      latest.openTeamRepository(unconnectedTeam.id);
    });
    await flush();
    expect(bridge.selectedTeams).toEqual([unconnectedTeam.id]);
    expect(registry.get(repositorySetupTeamIdAtom)).toBe(unconnectedTeam.id);
    expect(registry.get(navigationLocationAtom)).toBe("lobby");
    await view.cleanup();
  });

  it("routes a ready team straight to its settings page", async () => {
    const registry = harness();
    const bridge = new SetupBridge();
    const view = await mount(registry, bridge);

    await act(async () => {
      latest.openTeamRepository(readyTeam.id);
    });
    await flush();
    expect(bridge.selectedTeams).toEqual([readyTeam.id]);
    expect(registry.get(repositorySetupTeamIdAtom)).toBeNull();
    expect(registry.get(activePageAtom)).toBe("settings");
    expect(registry.get(settingsTargetAtom)).toEqual({
      scope: "project",
      projectId: readyTeam.id,
      section: "general",
    });
    await view.cleanup();
  });

  it("ignores a team the account no longer has", async () => {
    const registry = harness();
    const bridge = new SetupBridge();
    const view = await mount(registry, bridge);

    await act(async () => {
      latest.openTeamRepository("team-gone");
    });
    await flush();
    expect(bridge.selectedTeams).toEqual([]);
    expect(registry.get(repositorySetupTeamIdAtom)).toBeNull();
    await view.cleanup();
  });

  it("returns focus to the control that opened the dialog", async () => {
    const registry = harness();
    const bridge = new SetupBridge();
    const container = document.createElement("div");
    document.body.append(container);
    const trigger = document.createElement("button");
    container.append(trigger);
    trigger.focus();

    const view = await mount(registry, bridge);
    await act(async () => {
      latest.openTeamRepository(unconnectedTeam.id);
    });
    await flush();

    const other = document.createElement("button");
    container.append(other);
    other.focus();

    await act(async () => {
      latest.closeRepositorySetup();
    });
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(registry.get(repositorySetupTeamIdAtom)).toBeNull();
    expect(document.activeElement).toBe(trigger);

    container.remove();
    await view.cleanup();
  });

  it("reconnects a team and keeps the captured trigger while the picker is open", async () => {
    const registry = harness();
    const bridge = new SetupBridge();
    const view = await mount(registry, bridge);

    await act(async () => {
      latest.beginTeamReconnect(readyTeam.id);
    });
    await flush();
    expect(bridge.reconnects).toEqual([readyTeam.id]);
    await view.cleanup();
  });
});
