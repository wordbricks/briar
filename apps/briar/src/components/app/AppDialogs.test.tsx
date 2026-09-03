/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { AppKeyboardCommandProvider } from "../../hooks/appKeyboardCommands";
import { ToastProvider } from "../ui/toast";
import { TooltipProvider } from "../ui/tooltip";
import { demoDashboard } from "../../lib/demo-data";
import {
  dispatchRunAtom,
  isCommandPaletteOpenAtom,
  isKeyboardShortcutsOpenAtom,
  planningProjectTeamIdAtom,
} from "../../state/dialogs/atoms";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { createReactTestRoot } from "../../test/react";
import type {
  DashboardPayload,
  HuntRun,
  Project,
  SessionUser,
} from "../../types";
import { AppDialogs, type AppDialogsProps } from "./AppDialogs";

/*
  The overlay layer, which is now mounted once for both shells.

  Each case opens exactly one dialog through the atom that owns it and looks
  for the surface it puts in the document. The last one is the reason this
  component exists: the dispatch dialog used to be rendered from two mutually
  exclusive places, and there is one of it now.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const team: Project = { ...demoDashboard.team, id: "team-a", name: "Team A" };

const run: HuntRun = {
  ...demoDashboard.runs[0]!,
  id: "run-1",
  title: "Dispatch me",
};

const payload: DashboardPayload = {
  ...demoDashboard,
  team,
  runs: [run],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

const props: AppDialogsProps = {
  commandPaletteAvailable: true,
  commandPaletteItems: [],
  firstRunTutorial: {
    collaborator: false,
    onCollaboratorComplete: () => undefined,
    onDeveloperSelect: () => undefined,
    open: false,
  },
  launchIntro: {
    onComplete: () => undefined,
    preview: false,
    visible: false,
  },
  teamOnboarding: {
    includeDeveloperTools: false,
    onCancel: () => undefined,
    onFinish: () => undefined,
    requireDeveloperAgent: false,
    startWithDeveloperTools: false,
  },
};

const flush = async (attempts = 6) => {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
};

const settle = async (check: () => boolean) => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (check()) return;
    await flush(1);
  }
};

const mount = async (
  registry: AtomRegistry,
  overrides: Partial<AppDialogsProps> = {},
) => {
  // Radix portals into `document.body`, which outlives a React root's own
  // container, so each mount starts from an empty document.
  document.body.replaceChildren();
  const view = createReactTestRoot({ attachToDocument: true });
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <AppKeyboardCommandProvider>
          <ToastProvider>
            <TooltipProvider>
              <AppDialogs {...props} {...overrides} />
            </TooltipProvider>
          </ToastProvider>
        </AppKeyboardCommandProvider>
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await flush();
  return view;
};

const harness = (): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: team.id,
    payload,
  });
  return registry;
};

/** Radix portals its dialogs, so the surfaces land on `document.body`. */
const dialogTitles = () =>
  [...document.querySelectorAll("[role=dialog]")].map(
    (node) => node.getAttribute("aria-labelledby") ?? node.textContent ?? "",
  );

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  // Warms the overlays' own chunks so their `Suspense` boundaries resolve
  // inside the act() flushes below rather than after the assertion.
  await Promise.all([
    import("../CommandPalette"),
    import("../KeyboardShortcutsDialog"),
    import("../PlanningProjectDialog"),
    import("../WorkerDispatchDialog"),
  ]);
});

describe("AppDialogs", () => {
  it("keeps every overlay closed while nothing asks for one", async () => {
    const registry = harness();
    const view = await mount(registry);
    await flush(8);
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(0);
    await view.cleanup();
  });

  it("opens the planning project dialog from its own atom", async () => {
    const registry = harness();
    const view = await mount(registry);
    await act(async () => {
      registry.set(planningProjectTeamIdAtom, team.id);
    });
    await settle(() => document.querySelectorAll("[role=dialog]").length > 0);
    expect(dialogTitles()).toHaveLength(1);
    await view.cleanup();
  });

  it("opens the keyboard shortcut sheet only while the palette is available", async () => {
    const registry = harness();
    const view = await mount(registry, { commandPaletteAvailable: false });
    await act(async () => {
      registry.set(isKeyboardShortcutsOpenAtom, true);
    });
    await flush(4);
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(0);
    await view.cleanup();

    const registryB = harness();
    const viewB = await mount(registryB);
    await act(async () => {
      registryB.set(isKeyboardShortcutsOpenAtom, true);
    });
    await settle(() => document.querySelectorAll("[role=dialog]").length > 0);
    expect(dialogTitles()).toHaveLength(1);
    await viewB.cleanup();
  });

  it("renders exactly one worker dispatch dialog for a run", async () => {
    const registry = harness();
    const view = await mount(registry);
    await act(async () => {
      registry.set(dispatchRunAtom, run);
    });
    await settle(() => document.querySelectorAll("[role=dialog]").length > 0);
    // The companion shell used to render a second copy of this one.
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    await view.cleanup();
  });

  it("opens the command palette only when the shell says it is available", async () => {
    const registry = harness();
    registry.set(isCommandPaletteOpenAtom, true);
    const view = await mount(registry, { commandPaletteAvailable: false });
    await flush(4);
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(0);
    await view.cleanup();

    const registryB = harness();
    registryB.set(isCommandPaletteOpenAtom, true);
    const viewB = await mount(registryB, { commandPaletteAvailable: true });
    await settle(() => document.querySelectorAll("[role=dialog]").length > 0);
    expect(dialogTitles()).toHaveLength(1);
    await viewB.cleanup();
  });
});
