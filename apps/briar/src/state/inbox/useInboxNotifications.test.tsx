/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n";
import type { InboxNotificationTarget } from "../../generated/tauri";
import { demoDashboard } from "../../lib/demo-data";
import { createReactTestRoot, type ReactTestRoot } from "../../test/react";
import { seedInboxMessages } from "../../test/inbox";
import type { Project } from "../../types";
import { demoUser } from "../demo-fixtures";
import { pendingInboxNotificationTargetAtom } from "../navigation/atoms";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { lockedTeamIdAtom } from "../platform";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom, userAtom } from "../session/atoms";
import { teamsAtom } from "../team/atoms";
import type { InboxMessage } from "./model";
import { useInboxNotifications } from "./useInboxNotifications";

/*
  What the inbox says outside the window.

  The rules the hook keeps are the ones the bridge's version had: the first
  authoritative answer is a baseline rather than a burst of alerts, a category
  the user turned off is silent, the app badge follows the actionable unread
  count, and a project window says nothing at all because the main window
  already did.
*/

const team: Project = { ...demoDashboard.team, id: "team-a" };

const failedIssue = (id: string, version: string): InboxMessage => ({
  id,
  kind: "issue",
  projectId: team.id,
  projectName: team.name,
  targetId: "run-1",
  title: "Fix it",
  occurredAt: "2026-09-01T00:00:00.000Z",
  version,
  runNumber: 1,
  status: "failed",
  workflowStage: null,
  priority: null,
  structuredResult: null,
});

const send = vi.fn<
  (message: unknown, label: string) => Promise<void>
>();
const syncBadge = vi.fn<(count: number) => Promise<void>>();
const listenForClicks = vi.fn<
  (
    onOpen: (target: InboxNotificationTarget) => void,
  ) => Promise<() => void>
>();
const synchronizePushRegistration = vi.fn<
  (token: string) => Promise<boolean>
>();

let clicked: ((target: InboxNotificationTarget) => void) | null = null;
let view: ReactTestRoot;

function Effects() {
  useInboxNotifications({
    listenForClicks: listenForClicks as never,
    send: send as never,
    syncBadge: syncBadge as never,
    synchronizePushRegistration: synchronizePushRegistration as never,
  });
  return null;
}

const mount = async (registry: AtomRegistry) => {
  await view.render(
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <Effects />
      </I18nProvider>
    </RegistryContext.Provider>,
  );
};

const signedIn = (lockedTeamId: string | null = null): AtomRegistry =>
  createTestRegistry([
    [userAtom, demoUser],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeOrganizationIdAtom, team.organizationId],
    [lockedTeamIdAtom, lockedTeamId],
  ]);

describe("inbox notifications", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    window.localStorage.setItem(
      "briar.settings.inbox-notifications.v1",
      JSON.stringify({
        urgent: true,
        action_required: true,
        important: true,
        activity: false,
      }),
    );
    send.mockReset().mockResolvedValue(undefined);
    syncBadge.mockReset().mockResolvedValue(undefined);
    clicked = null;
    listenForClicks.mockReset().mockImplementation(async (onOpen) => {
      clicked = onOpen;
      return () => undefined;
    });
    synchronizePushRegistration.mockReset().mockResolvedValue(true);
    view = createReactTestRoot();
  });

  afterEach(async () => {
    await view.cleanup();
  });

  it("takes the first authoritative list as a baseline and alerts on the next change", async () => {
    const registry = signedIn();
    await mount(registry);
    await act(async () => {
      seedInboxMessages(registry, [failedIssue("issue:run-1", "v1")]);
    });

    // Everything already in the inbox when the account answered is history.
    expect(send).not.toHaveBeenCalled();

    await act(async () => {
      seedInboxMessages(registry, [failedIssue("issue:run-1", "v2")]);
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ id: "issue:run-1" });
  });

  it("stays silent for a category the user turned off", async () => {
    window.localStorage.setItem(
      "briar.settings.inbox-notifications.v1",
      JSON.stringify({
        urgent: false,
        action_required: false,
        important: false,
        activity: false,
      }),
    );
    const registry = signedIn();
    await mount(registry);
    await act(async () => {
      seedInboxMessages(registry, [failedIssue("issue:run-1", "v1")]);
    });
    await act(async () => {
      seedInboxMessages(registry, [failedIssue("issue:run-1", "v2")]);
    });

    expect(send).not.toHaveBeenCalled();
  });

  it("says nothing and shows no badge in a project window", async () => {
    const registry = signedIn(team.id);
    await mount(registry);
    await act(async () => {
      seedInboxMessages(registry, [failedIssue("issue:run-1", "v1")]);
    });
    await act(async () => {
      seedInboxMessages(registry, [failedIssue("issue:run-1", "v2")]);
    });

    expect(send).not.toHaveBeenCalled();
    expect(syncBadge).not.toHaveBeenCalled();
  });

  it("follows the actionable unread count onto the launcher badge", async () => {
    const registry = signedIn();
    await mount(registry);
    expect(syncBadge).toHaveBeenLastCalledWith(0);

    await act(async () => {
      seedInboxMessages(registry, [
        failedIssue("issue:run-1", "v1"),
        failedIssue("issue:run-2", "v1"),
      ]);
    });

    expect(syncBadge).toHaveBeenLastCalledWith(2);
  });

  it("hands a clicked notification to navigation", async () => {
    const registry = signedIn();
    await mount(registry);
    const target = {
      kind: "issue",
      projectId: team.id,
      targetId: "run-1",
      messageId: "issue:run-1",
    } as InboxNotificationTarget;

    await act(async () => clicked?.(target));

    expect(registry.get(pendingInboxNotificationTargetAtom)).toBe(target);
  });

  it("ignores a click in a project window, which has no inbox to open", async () => {
    const registry = signedIn(team.id);
    await mount(registry);

    await act(async () =>
      clicked?.({
        kind: "issue",
        projectId: team.id,
        targetId: "run-1",
        messageId: "issue:run-1",
      } as InboxNotificationTarget)
    );

    expect(registry.get(pendingInboxNotificationTargetAtom)).toBeNull();
  });
});
