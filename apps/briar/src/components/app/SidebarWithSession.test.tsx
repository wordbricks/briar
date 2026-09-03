/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import {
  activeOrganizationIdAtom,
  organizationsAtom,
} from "../../state/organization/atoms";
import { createTestRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { createReactTestRoot } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import type { Organization, Project, SessionUser } from "../../types";
import { SidebarSessionBoundary, SidebarWithSession } from "./SidebarWithSession";

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const organization: Organization = {
  id: "org-a",
  name: "Org A",
  handle: "org-a",
  logo: null,
  role: "owner",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const team: Project = {
  ...demoDashboard.team,
  id: "team-a",
  name: "Team A",
  organizationId: organization.id,
  organizationName: organization.name,
};

const noop = () => undefined;

const shellProps = {
  activePage: "issues" as const,
  agents: [],
  connectedTeamIds: [team.id],
  isOpen: true,
  onAddOrganization: noop,
  onAddProject: noop,
  onAgentSessionOpen: noop,
  onAgentsOpen: noop,
  onCreateIssue: noop,
  onInboxOpen: noop,
  onIssuesOpen: noop,
  onLobbyOpen: noop,
  onLogout: noop,
  onOrganizationChange: noop,
  onProjectChange: noop,
  onProjectRepositoryOpen: noop,
  onProjectSettings: noop,
  onScheduleOpen: noop,
  onSettings: noop,
  projectReadiness: {},
  projectReadinessError: {},
  projects: [team],
  sessions: [],
  unreadInboxCount: 0,
};

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

describe("SidebarWithSession", () => {
  it("re-renders on an organization change without re-rendering the shell", async () => {
    const registry = createTestRegistry([
      [userAtom, user],
      [tokenAtom, "token-1"],
      [organizationsAtom, [organization]],
      [activeOrganizationIdAtom, organization.id],
      [teamsAtom, [team]],
      [activeTeamIdAtom, team.id],
    ]);
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });

    function AppShell() {
      // Stands in for App.tsx: it owns the sidebar's callbacks but reads none
      // of the atoms the sidebar renders from.
      renders.useRenderCount("shell");
      return (
        <>
          <SidebarWithSession {...shellProps} />
          <SidebarSessionBoundary>
            {(session) =>
              renders.record(
                "sidebar",
                <output>{session.organizations.length}</output>,
              )}
          </SidebarSessionBoundary>
        </>
      );
    }

    await view.render(
      <RegistryContext.Provider value={registry}>
        <AppShell />
      </RegistryContext.Provider>,
    );
    renders.expectRenderCounts({ shell: 1, sidebar: 1 });
    expect(view.container.textContent).toContain("Org A");

    await act(async () => {
      registry.set(organizationsAtom, [
        { ...organization, name: "Org A renamed" },
      ]);
    });

    // The rendered sidebar picked the new name up…
    expect(view.container.textContent).toContain("Org A renamed");
    // …and the shell that passes its callbacks did not render again.
    renders.expectRenderCounts({ shell: 1, sidebar: 2 });

    await view.cleanup();
  });

  it("renders nothing while signed out", async () => {
    const registry = createTestRegistry([[organizationsAtom, [organization]]]);
    const view = createReactTestRoot();

    await view.render(
      <RegistryContext.Provider value={registry}>
        <SidebarWithSession {...shellProps} />
      </RegistryContext.Provider>,
    );

    expect(view.container.textContent).toBe("");

    await view.cleanup();
  });
});
