/** @vitest-environment jsdom */

import {
  RegistryContext,
  RegistryProvider,
  useAtomSet,
  useAtomValue,
} from "@effect/atom-react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppKeyboardCommandProvider } from "../hooks/appKeyboardCommands";
import { I18nProvider } from "../i18n";
import { demoDashboard } from "../lib/demo-data";
import { demoUser } from "../state/demo-fixtures";
import {
  inboxFeedIdentityAtom,
  inboxMergeSourcesAtom,
  inboxMessageAtom,
  inboxReadSyncIdentityAtom,
  inboxStorageKeyAtom,
  visibleInboxMessageSummariesAtom,
  visibleInboxUnreadCountAtom,
} from "../state/inbox/atoms";
import { mergeCurrentInboxMessages } from "../state/inbox/useInboxSync";
import { activePageAtom } from "../state/navigation/atoms";
import { activeOrganizationIdAtom } from "../state/organization/atoms";
import { lockedTeamIdAtom } from "../state/platform";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { tokenAtom, userAtom } from "../state/session/atoms";
import { applySyncEvent } from "../state/sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../state/team/atoms";
import { inboxDetailTargetAtom } from "../state/inbox-selection";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { createRenderCounter } from "../test/render-count";
import type { DashboardPayload, HuntRun, Project } from "../types";
import {
  InboxDetailTargetBoundary,
  InboxWithSelection,
} from "./InboxSelectionBoundary";

/*
  What one changed notification costs the inbox page.

  The list is fed summaries — id, project, class, read or not — and each row
  reads its own message, so a delta that edits a notification without moving it
  between classes has to reach that row and nothing else. `profile` counts a
  whole subtree, so the boundaries are measured with probe components that read
  the same atoms and sit beside the real list; the list itself is checked
  through the DOM.
*/

const teamId = "team-a";
const team: Project = { ...demoDashboard.team, id: teamId };

const runOf = (id: string, title: string): HuntRun => ({
  ...demoDashboard.runs[0]!,
  id,
  runNumber: Number(id.replace(/\D/gu, "")) || 1,
  teamId,
  title,
  status: "failed",
  priority: 1,
  eventCount: 1,
  lastEventAt: "2026-09-01T00:00:00.000Z",
  subscribers: [
    { userId: demoUser.id, subscribedAt: "2026-01-01T00:00:00.000Z" },
  ],
});

const changing = runOf("run-1", "First failure");
const still = runOf("run-2", "Second failure");

const payload: DashboardPayload = {
  ...demoDashboard,
  team,
  runs: [changing, still],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
};

const settled = (): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, demoUser],
    [tokenAtom, "token-1"],
    [teamsAtom, [team]],
    [activeTeamIdAtom, teamId],
    [activeOrganizationIdAtom, team.organizationId],
    [lockedTeamIdAtom, null],
  ]);
  applySyncEvent(registry, { kind: "team-snapshot", teamId, payload });
  registry.set(inboxReadSyncIdentityAtom, {
    storageKey: registry.get(inboxStorageKeyAtom),
    token: "token-1",
    userId: demoUser.id,
  });
  registry.set(inboxFeedIdentityAtom, {
    scope: `${demoUser.id}:${team.organizationId}`,
    token: "token-1",
  });
  registry.subscribe(
    inboxMergeSourcesAtom,
    () => mergeCurrentInboxMessages(registry),
    { immediate: true },
  );
  return registry;
};

function SummariesProbe() {
  useAtomValue(visibleInboxMessageSummariesAtom);
  return null;
}

function RowProbe({ messageId }: { readonly messageId: string }) {
  useAtomValue(inboxMessageAtom(messageId));
  return null;
}

function BadgeProbe() {
  const count = useAtomValue(visibleInboxUnreadCountAtom);
  return <output data-testid="unread-badge">{count}</output>;
}

/** What the page around the inbox reads, none of which is a message. */
function ShellProbe() {
  useAtomValue(activePageAtom);
  return null;
}

describe("InboxWithSelection", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    window.localStorage.setItem("briar.locale.v1", "en");
  });

  it("commits only the row whose notification changed", async () => {
    const registry = settled();
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });
    await view.render(
      <RegistryContext.Provider value={registry}>
        <AppKeyboardCommandProvider>
          <I18nProvider>
            {renders.profile("summaries", <SummariesProbe />)}
            {renders.profile(
              "row-changing",
              <RowProbe messageId="issue:run-1" />,
            )}
            {renders.profile("row-still", <RowProbe messageId="issue:run-2" />)}
            {renders.profile("badge", <BadgeProbe />)}
            {renders.profile("shell", <ShellProbe />)}
            <InboxWithSelection
              isSidebarOpen
              onOpen={vi.fn()}
              projects={[team]}
            />
          </I18nProvider>
        </AppKeyboardCommandProvider>
      </RegistryContext.Provider>,
    );
    expect(view.container.textContent).toContain("First failure");
    renders.reset();

    await act(async () => {
      applySyncEvent(registry, {
        kind: "team-delta",
        teamId,
        payload: {
          cursor: 2,
          generatedAt: "2026-09-01T00:01:00.000Z",
          hasMore: false,
          reset: false,
          runs: [
            {
              ...changing,
              title: "First failure, edited",
              eventCount: 2,
              lastEventAt: "2026-09-01T00:01:00.000Z",
            },
          ],
          deletedRunIds: [],
          workers: [],
          organizationProviders: [],
        },
      });
    });

    /*
      The edited row and nothing else: not the summary list (the message stayed
      urgent and stayed unread), not the other row, not the unread badge, not
      the page around them.
    */
    renders.expectRenderCounts({ "row-changing": 1 });
    expect(view.container.textContent).toContain("First failure, edited");
    expect(view.container.textContent).toContain("Second failure");

    await view.cleanup();
  });

  it("re-renders the unread badge only when the count moves", async () => {
    const registry = settled();
    const renders = createRenderCounter();
    const view = createReactTestRoot({ attachToDocument: true });
    await view.render(
      <RegistryContext.Provider value={registry}>
        <AppKeyboardCommandProvider>
          <I18nProvider>
            {renders.profile("badge", <BadgeProbe />)}
            <InboxWithSelection
              isSidebarOpen
              onOpen={vi.fn()}
              projects={[team]}
            />
          </I18nProvider>
        </AppKeyboardCommandProvider>
      </RegistryContext.Provider>,
    );
    const badge = () =>
      view.container.querySelector('[data-testid="unread-badge"]')?.textContent;
    expect(badge()).toBe("2");
    renders.reset();

    // An edit that leaves both messages unread leaves the count alone.
    await act(async () => {
      applySyncEvent(registry, {
        kind: "run-changed",
        teamId,
        run: {
          ...changing,
          title: "First failure, edited",
          eventCount: 3,
          lastEventAt: "2026-09-01T00:02:00.000Z",
        },
      });
    });
    expect(renders.count("badge")).toBe(0);

    // Reading one does move it.
    await act(async () => {
      view.container
        .querySelector<HTMLButtonElement>(".inbox-mark-read")
        ?.click();
    });
    expect(renders.count("badge")).toBe(1);
    expect(badge()).toBe("1");

    await view.cleanup();
  });
});

describe("InboxDetailTargetBoundary", () => {
  it("updates detail subscribers without rerendering the app shell", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    const renders = createRenderCounter();

    function SelectMessage() {
      const setTarget = useAtomSet(inboxDetailTargetAtom);
      return (
        <button
          onClick={() =>
            setTarget({
              kind: "issue",
              messageId: "message-1",
              projectId: "project-1",
              targetId: "run-1",
            })}
          type="button"
        >
          Select
        </button>
      );
    }

    function AppShell() {
      renders.useRenderCount("shell");
      return (
        <>
          <SelectMessage />
          <InboxDetailTargetBoundary>
            {(target) =>
              renders.record(
                "detail",
                <output>{target?.messageId ?? "none"}</output>,
              )}
          </InboxDetailTargetBoundary>
        </>
      );
    }

    await renderReactTestRoot(
      root,
      <RegistryProvider>
        <AppShell />
      </RegistryProvider>,
    );
    renders.expectRenderCounts({ detail: 1, shell: 1 });

    await act(async () => container.querySelector("button")?.click());

    expect(container.querySelector("output")?.textContent).toBe("message-1");
    renders.expectRenderCounts({ detail: 2, shell: 1 });

    await cleanup();
  });
});
