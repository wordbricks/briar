/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n";
import { AppKeyboardCommandProvider } from "./appKeyboardCommands";
import { demoDashboard } from "../lib/demo-data";
import { settingsTargetAtom } from "../state/navigation/atoms";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../state/organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import {
  loadingAtom,
  restoringSessionAtom,
  userAtom,
} from "../state/session/atoms";
import { activeTeamIdAtom, teamsAtom } from "../state/team/atoms";
import { createReactTestRoot } from "../test/react";
import type { Organization, Project, SessionUser } from "../types";
import { useAppNavigation, type AppNavigation } from "./useAppNavigation";

/*
  The reconciliation the location and the store owe each other.

  Phase 5 moved this block out of `App.tsx` untouched, and Phase 6 rewrites it,
  so these cases pin the two rules that would be silently lost in either move:
  a project page carries the selected team in its location, and walking onto a
  team the account no longer has falls back instead of rendering nothing.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const teamOf = (id: string): Project => ({
  ...demoDashboard.team,
  id,
  name: id,
});
const teamA = teamOf("team-a");
const teamB = teamOf("team-b");

const organization: Organization = {
  id: teamA.organizationId,
  name: "Org",
  handle: "org",
  logo: null,
  role: "owner",
  createdAt: "2026-09-01T00:00:00.000Z",
};

let latest: AppNavigation;
const selectedTeams: string[] = [];

function Harness() {
  latest = useAppNavigation({
    selectTeam: (teamId) => {
      selectedTeams.push(teamId);
    },
  });
  return null;
}

const flush = async (attempts = 4) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const harness = (teams: Project[] = [teamA, teamB]): AtomRegistry =>
  createTestRegistry([
    [userAtom, user],
    [restoringSessionAtom, false],
    // The fallback effects wait for the session to settle before replacing a
    // location, exactly as they did inline.
    [loadingAtom, false],
    [teamsAtom, teams],
    [activeTeamIdAtom, teamA.id],
    [organizationsAtom, [organization]],
    [activeOrganizationIdAtom, organization.id],
  ]);

const mount = async (registry: AtomRegistry) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <AppKeyboardCommandProvider>
          <Harness />
        </AppKeyboardCommandProvider>
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await flush();
  return view;
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  selectedTeams.length = 0;
});

describe("useAppNavigation", () => {
  it("puts the selected team into a project page's location", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      latest.navigateToPage("issues");
    });
    await flush();
    expect(latest.activePage).toBe("issues");
    expect(latest.navigationProjectId).toBe(teamA.id);
    await view.cleanup();
  });

  it("selects the team a location names", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      latest.navigateToPage("issues", teamB.id);
    });
    await flush();
    expect(latest.navigationProjectId).toBe(teamB.id);
    expect(selectedTeams).toContain(teamB.id);
    await view.cleanup();
  });

  it("falls back when the location names a team the account lost", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      latest.navigateToPage("issues", teamB.id);
    });
    await flush();
    expect(latest.navigationProjectId).toBe(teamB.id);

    await act(async () => {
      registry.set(teamsAtom, [teamA]);
    });
    await flush();
    // The gone team is replaced rather than left on screen.
    expect(latest.navigationProjectId).toBe(teamA.id);
    await view.cleanup();
  });

  it("keeps the settings location and the settings target in step", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      registry.set(settingsTargetAtom, {
        scope: "application",
        section: "account",
      });
      latest.navigateToPage("settings");
    });
    await flush();
    expect(latest.activePage).toBe("settings");
    expect(registry.get(settingsTargetAtom)).toEqual({
      scope: "application",
      section: "account",
    });

    // Leaving settings goes back past every settings entry in the history.
    await act(async () => {
      latest.closeSettings();
    });
    await flush();
    expect(latest.activePage).not.toBe("settings");
    await view.cleanup();
  });

  it("resets the history when a different account signs in", async () => {
    const registry = harness();
    const view = await mount(registry);

    await act(async () => {
      latest.navigateToPage("agents", teamA.id);
    });
    await flush();
    expect(latest.activePage).toBe("agents");

    await act(async () => {
      registry.set(userAtom, { ...user, id: "user-2" });
    });
    await flush();
    expect(latest.activePage).toBe("lobby");
    await view.cleanup();
  });
});
