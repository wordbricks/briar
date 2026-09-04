/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n";
import { ToastProvider } from "../ui/toast";
import { TooltipProvider } from "../ui/tooltip";
import { demoDashboard } from "../../lib/demo-data";
import { inboxDetailLabel } from "../../lib/inbox-detail-label";
import { inboxDetailTargetAtom } from "../../state/inbox-selection";
import { activeOrganizationIdAtom } from "../../state/organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../../state/registry";
import { tokenAtom, userAtom } from "../../state/session/atoms";
import { applySyncEvent } from "../../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../../state/team/atoms";
import { createReactTestRoot, flush, settle } from "../../test/react";
import { createRenderCounter } from "../../test/render-count";
import type { InboxNotificationTarget } from "../../generated/tauri";
import type {
  DashboardPayload,
  HuntRun,
  Project,
  SessionUser,
} from "../../types";
import { InboxDetailContent } from "./InboxDetailContent";

/*
  The inbox's detail pane, wired to the store rather than to the shell.

  What it has to get right is the branch: the same notification shape decides
  between the run page, the agent session, the channel and the two placeholder
  states, and each branch reads a different slice. The last case is the reason
  it moved — a run edit reaches the pane without the shell rendering again.
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
  title: "Fix the thing",
};

const payload = (runs: HuntRun[]): DashboardPayload => ({
  ...demoDashboard,
  team,
  runs,
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

const issueTarget: InboxNotificationTarget = {
  kind: "issue",
  projectId: team.id,
  targetId: run.id,
  messageId: "message-1",
};

const channelTarget: InboxNotificationTarget = {
  kind: "channel",
  projectId: team.id,
  targetId: "channel-1",
  messageId: "message-2",
  channelMessageId: "channel-message-1",
  rootMessageId: null,
};

const harness = (runs: HuntRun[] = [run]): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, user],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeTeamIdAtom, team.id],
    [activeOrganizationIdAtom, team.organizationId],
  ]);
  applySyncEvent(registry, {
    kind: "team-snapshot",
    teamId: team.id,
    payload: payload(runs),
  });
  return registry;
};

const renderCounter = createRenderCounter();
const Tracked = renderCounter.track("shell", InboxDetailContent);

/** The page renders the issue title into an editable field, not into text. */
const renderedText = (container: HTMLElement) =>
  [
    container.textContent ?? "",
    ...[...container.querySelectorAll("input, textarea")].map(
      (field) => (field as HTMLInputElement | HTMLTextAreaElement).value,
    ),
  ].join(" ");

const mount = async (
  registry: AtomRegistry,
  target: InboxNotificationTarget,
) => {
  const view = createReactTestRoot({ attachToDocument: true });
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <ToastProvider>
        <TooltipProvider>
        <Tracked
          agents={[]}
          conversationInboxSyncSignal=""
          onEnsureTeamSelected={async () => undefined}
          onNavigateToIssue={() => undefined}
          onNavigateToPage={() => undefined}
          onSkillSessionAccepted={() => undefined}
          onStopSession={async () => true}
          target={target}
        />
        </TooltipProvider>
        </ToastProvider>
      </I18nProvider>
    </RegistryContext.Provider>,
  );
  await flush();
  return view;
};

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.localStorage.setItem("briar.locale.v1", "en");
  // Warms the page's own chunk so its `Suspense` boundary resolves inside the
  // act() flushes below rather than after the assertion.
  await import("../hunt/detail/RunPage");
  renderCounter.reset();
});

describe("InboxDetailContent", () => {
  it("renders the run page for an issue notification", async () => {
    const registry = harness();
    const view = await mount(registry, issueTarget);
    await settle(() => renderedText(view.container).includes(run.title));
    expect(renderedText(view.container)).toContain(run.title);
    await view.cleanup();
  });

  it("offers a way out when the run is not on this device", async () => {
    // The payload on screen belongs to the same team, so this is the "gone"
    // state rather than the "still loading another team" one.
    const registry = harness([]);
    const view = await mount(registry, issueTarget);
    await settle(
      () =>
        view.container.querySelector(".inbox-detail-unavailable") !== null,
    );
    const close = view.container.querySelector<HTMLButtonElement>(
      ".inbox-detail-unavailable button",
    );
    expect(close).not.toBeNull();
    registry.set(inboxDetailTargetAtom, issueTarget);
    await act(async () => {
      close?.click();
    });
    expect(registry.get(inboxDetailTargetAtom)).toBeNull();
    await view.cleanup();
  });

  it("renders the channel conversation for a channel notification", async () => {
    const registry = harness();
    const view = await mount(registry, channelTarget);
    await settle(
      () => view.container.querySelector(".inbox-detail-unavailable") === null,
    );
    // Not the issue branch: the run title never appears for a channel target.
    expect(renderedText(view.container)).not.toContain(run.title);
    await view.cleanup();
  });

  it("does not re-render the shell when the open run changes", async () => {
    const registry = harness();
    const view = await mount(registry, issueTarget);
    await settle(() => renderedText(view.container).includes(run.title));
    const before = renderCounter.count("shell");

    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        teamId: team.id,
        run: { ...run, title: "Fix the other thing" },
      });
    });
    await settle(() => renderedText(view.container).includes("Fix the other thing"));
    expect(renderedText(view.container)).toContain("Fix the other thing");
    // The pane read the change from the store; nothing pushed it in.
    expect(renderCounter.count("shell")).toBe(before);
    await view.cleanup();
  });
});

describe("inboxDetailLabel", () => {
  it("prefers the run's own title over the notification's", () => {
    expect(
      inboxDetailLabel({
        fallback: "Notifications",
        messages: [{ id: "message-1", title: "Stale title" }],
        runTitle: run.title,
        target: issueTarget,
      }),
    ).toBe(run.title);
  });

  it("falls back to the notification, then to the generic label", () => {
    expect(
      inboxDetailLabel({
        fallback: "Notifications",
        messages: [{ id: "message-2", title: "Channel message" }],
        runTitle: null,
        target: channelTarget,
      }),
    ).toBe("Channel message");
    expect(
      inboxDetailLabel({
        fallback: "Notifications",
        messages: [],
        runTitle: null,
        target: channelTarget,
      }),
    ).toBe("Notifications");
  });
});
