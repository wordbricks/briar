/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { demoDashboard } from "../../lib/demo-data";
import { organizationsAtom } from "../../state/organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import {
  restoringSessionAtom,
  userAtom,
} from "../../state/session/atoms";
import { teamsAtom } from "../../state/team/atoms";
import { createReactTestRoot } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom } from "../../state/team/atoms";
import type {
  DashboardPayload,
  HuntRun,
  Organization,
  Project,
  SessionUser,
} from "../../types";
import { AuthGate, type AuthGateProps } from "./AuthGate";

/*
  Which screen owns a cold start.

  The order these cases pin down is the one `App.tsx` used to encode as an
  if/else chain: restore, invitation, first-run onboarding, sign-in, and only
  then the "no organization yet" setup. Everything the gates read about the
  session comes from the store, which is what the last case checks — a run
  edit is not a reason for the gate or the shell to render again.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const team: Project = { ...demoDashboard.team, id: "team-a", name: "Team A" };

const organization: Organization = {
  id: team.organizationId,
  name: "Org",
  handle: "org",
  logo: null,
  role: "owner",
  createdAt: "2026-09-01T00:00:00.000Z",
};

const run: HuntRun = {
  ...demoDashboard.runs[0]!,
  id: "run-1",
  title: "Fix the thing",
};

const payload: DashboardPayload = {
  ...demoDashboard,
  team,
  runs: [run],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

const gateProps: Omit<AuthGateProps, "children"> = {
  acceptingInvitation: false,
  invitationToken: null,
  onAcceptInvitation: async () => undefined,
  onInitialOnboardingComplete: () => undefined,
  onJoinOrganization: () => undefined,
  onOrganizationCreated: () => undefined,
  showsFirstOrganizationSetup: false,
  showsInitialOnboarding: false,
};

const renderCounter = createRenderCounter();
const TrackedGate = renderCounter.track("gate", AuthGate);

function Shell() {
  renderCounter.useRenderCount("shell");
  return <div data-testid="shell">shell</div>;
}

const flush = async (attempts = 4) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const mount = async (
  registry: AtomRegistry,
  overrides: Partial<typeof gateProps> = {},
) => {
  const view = createReactTestRoot({ attachToDocument: true });
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <TrackedGate {...gateProps} {...overrides}>
          <Shell />
        </TrackedGate>
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await flush();
  return view;
};

const signedIn = (): AtomRegistry =>
  createTestRegistry([
    [userAtom, user],
    [restoringSessionAtom, false],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
    [organizationsAtom, [organization]],
  ]);

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  renderCounter.reset();
});

describe("AuthGate", () => {
  it("holds the screen while the stored session is being restored", async () => {
    const registry = createTestRegistry([[restoringSessionAtom, true]]);
    const view = await mount(registry);
    expect(view.container.querySelector("[data-testid=shell]")).toBeNull();
    // The restore screen wins even over a signed-in user arriving late.
    expect(view.container.textContent).not.toContain("shell");
    await view.cleanup();
  });

  it("renders the shell once the session is ready", async () => {
    const view = await mount(signedIn());
    expect(view.container.querySelector("[data-testid=shell]")).not.toBeNull();
    await view.cleanup();
  });

  it("shows the sign-in screen when no session was restored", async () => {
    const registry = createTestRegistry([
      [userAtom, null],
      [restoringSessionAtom, false],
    ]);
    const view = await mount(registry);
    expect(view.container.querySelector("[data-testid=shell]")).toBeNull();
    await view.cleanup();
  });

  it("puts the invitation route ahead of the sign-in screen", async () => {
    const registry = createTestRegistry([
      [userAtom, null],
      [restoringSessionAtom, false],
    ]);
    const view = await mount(registry, { invitationToken: "invite-1" });
    await flush(8);
    expect(view.container.querySelector("[data-testid=shell]")).toBeNull();
    // The invitation screen renders its own surface, not the login one.
    expect(
      view.container.querySelector(".login-screen, [data-testid=login-screen]"),
    ).toBeNull();
    await view.cleanup();
  });

  it("keeps the first-organization setup ahead of the shell", async () => {
    const registry = signedIn();
    const view = await mount(registry, { showsFirstOrganizationSetup: true });
    await flush(8);
    expect(view.container.querySelector("[data-testid=shell]")).toBeNull();
    await view.cleanup();
  });

  it("does not re-render for a run change", async () => {
    const registry = signedIn();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload,
    });
    const view = await mount(registry);
    expect(view.container.querySelector("[data-testid=shell]")).not.toBeNull();
    renderCounter.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        teamId: team.id,
        run: { ...run, title: "Fix the other thing" },
      });
    });
    // Neither the gate nor the shell below it subscribes to a run.
    renderCounter.expectRenderCounts({});
    await view.cleanup();
  });
});
