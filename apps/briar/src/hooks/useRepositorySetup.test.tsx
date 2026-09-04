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
import { tokenAtom } from "../state/session/atoms";
import {
  activeTeamIdAtom,
  teamConnectionAtom,
  teamsAtom,
} from "../state/team/atoms";
import { workspaceApiAtom } from "../state/workspace/api";
import {
  connectedTeamIdsAtom,
  teamReadinessAtom,
} from "../state/workspace/atoms";
import { createReactTestRoot, flush } from "../test/react";
import type { Project } from "../types";
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

let latest: RepositorySetup;

function Harness() {
  latest = useRepositorySetup();
  return null;
}

const mount = async (registry: AtomRegistry) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <Harness />
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await flush();
  return view;
};

const harness = (): AtomRegistry =>
  createTestRegistry([
    [teamsAtom, [readyTeam, unconnectedTeam]],
    // Reconnecting reads the team's workflow, which needs a credential.
    [tokenAtom, "token-1"],
    [connectedTeamIdsAtom, [readyTeam.id]],
    [
      teamReadinessAtom(readyTeam.id),
      { readiness: demoRepositoryReadiness, error: null, loading: false },
    ],
    [
      workspaceApiAtom,
      {
        loadTeamRepositoryReadiness: async () => demoRepositoryReadiness,
        loadDashboard: (async () => demoDashboard) as never,
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
    const view = await mount(registry);

    await act(async () => {
      latest.openTeamRepository(unconnectedTeam.id);
    });
    await flush();
    expect(registry.get(activeTeamIdAtom)).toBe(unconnectedTeam.id);
    expect(registry.get(repositorySetupTeamIdAtom)).toBe(unconnectedTeam.id);
    expect(registry.get(navigationLocationAtom)).toBe("lobby");
    await view.cleanup();
  });

  it("routes a ready team straight to its settings page", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      latest.openTeamRepository(readyTeam.id);
    });
    await flush();
    expect(registry.get(activeTeamIdAtom)).toBe(readyTeam.id);
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
    const view = await mount(registry);

    await act(async () => {
      latest.openTeamRepository("team-gone");
    });
    await flush();
    expect(registry.get(activeTeamIdAtom)).toBeNull();
    expect(registry.get(repositorySetupTeamIdAtom)).toBeNull();
    await view.cleanup();
  });

  it("returns focus to the control that opened the dialog", async () => {
    const registry = harness();
    const container = document.createElement("div");
    document.body.append(container);
    const trigger = document.createElement("button");
    container.append(trigger);
    trigger.focus();

    const view = await mount(registry);
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
    const view = await mount(registry);

    await act(async () => {
      latest.beginTeamReconnect(readyTeam.id);
    });
    await flush();
    expect(registry.get(teamConnectionAtom)).toMatchObject({
      kind: "reconnect",
      project: { id: readyTeam.id },
    });
    await view.cleanup();
  });
});
