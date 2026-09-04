/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  INBOX_REALTIME_DEBOUNCE_MS,
  INBOX_REALTIME_FALLBACK_MS,
} from "../../lib/channel-realtime";
import { demoDashboard } from "../../lib/demo-data";
import type {
  RealtimeNotification,
  RealtimeTransport,
} from "../../lib/realtime-transport";
import { createReactTestRoot, type ReactTestRoot } from "../../test/react";
import type { DashboardPayload, Project } from "../../types";
import { demoUser } from "../demo-fixtures";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom, userAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import { activeTeamIdAtom, teamsAtom } from "../team/atoms";
import { inboxApiAtom, type InboxApi } from "./api";
import { createInboxActions } from "./actions";
import { inboxInitialSyncCompleteAtom, inboxMessagesAtom } from "./atoms";
import { useInboxSync } from "./useInboxSync";

/*
  The inbox's transports, driven through the store.

  Every case here was a `useInbox` case and every one of them is about ordering:
  a PUT racing a GET, a PUT racing an account switch, a failed PUT that must not
  spin. What changed is the observation point — the messages are read from the
  atoms rather than from a hook's return value — and that the realtime channel
  is now visible, because the transport is injected rather than built inside the
  component that used it.
*/

const team: Project = { ...demoDashboard.team, id: "team-a" };
const otherTeam: Project = { ...team, id: "team-b" };

const boardAt = (revision: number, teamOverride = team): DashboardPayload => {
  const run = demoDashboard.runs[1]!;
  const occurredAt = `2026-08-11T00:00:0${revision}.000Z`;
  return {
    ...demoDashboard,
    team: teamOverride,
    runs: [{
      ...run,
      id: "inbox-sync-run",
      teamId: teamOverride.id,
      currentRevision: revision,
      priority: 1,
      status: "completed",
      workflowStage: null,
      subscribers: ["user-a", "user-b", demoUser.id].map((userId) => ({
        userId,
        subscribedAt: "2026-08-10T00:00:00.000Z",
      })),
      lastEventAt: occurredAt,
      updatedAt: occurredAt,
      completedAt: occurredAt,
      eventCount: revision,
    }],
    conversationNotifications: [],
    channelNotifications: [],
  };
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
};

const api = {
  deleteReadState: vi.fn<InboxApi["deleteReadState"]>(),
  loadFeed: vi.fn<InboxApi["loadFeed"]>(),
  loadReadStates: vi.fn<InboxApi["loadReadStates"]>(),
  saveReadStates: vi.fn<InboxApi["saveReadStates"]>(),
  startPolling: vi.fn<InboxApi["startPolling"]>(),
} satisfies InboxApi;

/** A transport a case can publish into, counting its own lifecycle. */
const createTransport = () => {
  const listeners: ((notification: RealtimeNotification) => void)[] = [];
  const transport = {
    starts: 0,
    stops: 0,
    subscribers: 0,
    publish(notification: RealtimeNotification) {
      for (const listener of [...listeners]) listener(notification);
    },
    handle: {
      subscribe(listener: (notification: RealtimeNotification) => void) {
        listeners.push(listener);
        transport.subscribers += 1;
        return () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
          transport.subscribers -= 1;
        };
      },
      start() {
        transport.starts += 1;
      },
      stop() {
        transport.stops += 1;
      },
    } satisfies RealtimeTransport,
  };
  return transport;
};

function Effects({
  createRealtime,
}: {
  readonly createRealtime?: (() => RealtimeTransport) | null;
}) {
  useInboxSync({
    api,
    createRealtime: createRealtime ? () => createRealtime() : null,
  });
  return null;
}

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
};

let view: ReactTestRoot;

const mount = async (
  registry: AtomRegistry,
  createRealtime?: (() => RealtimeTransport) | null,
) => {
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Effects createRealtime={createRealtime ?? null} />
    </RegistryContext.Provider>,
  );
};

const signedIn = (
  overrides: { token?: string; teams?: Project[] } = {},
): AtomRegistry => {
  const registry = createTestRegistry([
    [userAtom, demoUser],
    [tokenAtom, overrides.token ?? "token-a"],
    [teamsAtom, overrides.teams ?? [team]],
    [activeTeamIdAtom, (overrides.teams ?? [team])[0]!.id],
    [activeOrganizationIdAtom, team.organizationId],
  ]);
  registry.set(inboxApiAtom, api);
  return registry;
};

const messages = (registry: AtomRegistry) => registry.get(inboxMessagesAtom);

describe("inbox synchronization", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    api.deleteReadState.mockReset().mockResolvedValue({});
    api.loadFeed.mockReset().mockResolvedValue({
      state: { version: "0" },
      notModified: false,
      messages: [],
    });
    api.loadReadStates.mockReset().mockResolvedValue({});
    api.saveReadStates.mockReset().mockResolvedValue({});
    // The real transport refreshes once as soon as the window is visible, and
    // that first authoritative answer is what turns unread markers on.
    api.startPolling.mockReset().mockImplementation((refresh) => {
      refresh("poll");
      return () => undefined;
    });
    view = createReactTestRoot();
  });

  afterEach(async () => {
    await view.cleanup();
  });

  it("isolates an old account PUT from the new account generation", async () => {
    const accountAPush = deferred<Record<string, string>>();
    const accountBPush = deferred<Record<string, string>>();
    api.saveReadStates.mockImplementation((token) =>
      token === "token-a" ? accountAPush.promise : accountBPush.promise
    );
    const registry = signedIn();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: boardAt(1),
    });
    await mount(registry);
    await flushPromises();
    const actions = createInboxActions(registry);
    const accountAMessage = messages(registry)[0]!;
    await act(async () => actions.markAllRead());

    // A different account, which is a different record and a different queue.
    await act(async () => {
      registry.set(userAtom, { ...demoUser, id: "user-b" });
      registry.set(tokenAtom, "token-b");
    });
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: boardAt(2),
    });
    await flushPromises();
    const accountBMessage = messages(registry)[0]!;
    await act(async () => actions.markAllRead());

    accountBPush.resolve({ [accountBMessage.id]: accountBMessage.version });
    await flushPromises();
    accountAPush.resolve({ [accountAMessage.id]: accountAMessage.version });
    await flushPromises();

    expect(messages(registry)[0]).toMatchObject({
      version: accountBMessage.version,
      isUnread: false,
    });
  });

  it("ignores a GET that predates the latest local PUT", async () => {
    const initialGet = deferred<Record<string, string>>();
    const push = deferred<Record<string, string>>();
    api.loadReadStates.mockReturnValue(initialGet.promise);
    api.saveReadStates.mockReturnValue(push.promise);
    const registry = signedIn();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: boardAt(1),
    });
    await mount(registry);
    await flushPromises();
    const message = messages(registry)[0]!;
    await act(async () => createInboxActions(registry).markAllRead());

    push.resolve({ [message.id]: message.version });
    await flushPromises();
    initialGet.resolve({ [message.id]: "stale-server-version" });
    await flushPromises();

    expect(messages(registry)[0]?.isUnread).toBe(false);
  });

  it("serializes PUTs and preserves a newer read during the first request", async () => {
    const firstPush = deferred<Record<string, string>>();
    const secondPush = deferred<Record<string, string>>();
    api.saveReadStates
      .mockReturnValueOnce(firstPush.promise)
      .mockReturnValueOnce(secondPush.promise);
    const registry = signedIn();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: boardAt(1),
    });
    await mount(registry);
    await flushPromises();
    const actions = createInboxActions(registry);
    const firstVersion = messages(registry)[0]!;
    await act(async () => actions.markAllRead());

    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: boardAt(2),
    });
    await flushPromises();
    const secondVersion = messages(registry)[0]!;
    await act(async () => actions.markAllRead());

    expect(api.saveReadStates).toHaveBeenCalledTimes(1);
    firstPush.resolve({ [firstVersion.id]: firstVersion.version });
    await flushPromises();

    expect(api.saveReadStates).toHaveBeenNthCalledWith(
      2,
      "token-a",
      { [secondVersion.id]: secondVersion.version },
    );
    expect(messages(registry)[0]?.isUnread).toBe(false);

    secondPush.resolve({ [secondVersion.id]: secondVersion.version });
    await flushPromises();
  });

  it("queues a failed PUT without immediately retrying forever", async () => {
    api.saveReadStates
      .mockRejectedValueOnce(new Error("invalid request"))
      .mockResolvedValueOnce({});
    const registry = signedIn();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: boardAt(1),
    });
    await mount(registry);
    await flushPromises();

    await act(async () => createInboxActions(registry).markAllRead());
    await flushPromises();
    expect(api.saveReadStates).toHaveBeenCalledTimes(1);

    await act(async () => window.dispatchEvent(new Event("focus")));
    await flushPromises();
    expect(api.saveReadStates).toHaveBeenCalledTimes(2);
  });

  it("collapses one thread, opens its oldest unread reply, and reads every reply", async () => {
    const registry = signedIn();
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: {
        ...boardAt(1),
        conversationNotifications: [
          {
            id: "thread-reply-1",
            runId: "inbox-sync-run",
            runTitle: "Grouped thread",
            rootMessageId: "thread-root",
            body: "Oldest unread reply",
            author: {
              id: "member-1",
              name: "First member",
              image: null,
              provider: null,
            },
            reason: "thread_reply" as const,
            createdAt: "2026-08-11T00:01:00.000Z",
          },
          {
            id: "thread-reply-2",
            runId: "inbox-sync-run",
            runTitle: "Grouped thread",
            rootMessageId: "thread-root",
            body: "Newest unread reply",
            author: {
              id: "member-2",
              name: "Second member",
              image: null,
              provider: null,
            },
            reason: "thread_reply" as const,
            createdAt: "2026-08-11T00:02:00.000Z",
          },
        ],
      } as DashboardPayload,
    });
    await mount(registry);
    await flushPromises();
    expect(registry.get(inboxInitialSyncCompleteAtom)).toBe(true);

    const thread = messages(registry).find(
      (message) => message.kind === "conversation",
    );
    expect(thread).toMatchObject({
      id: "conversation:thread-reply-1",
      messageId: "thread-reply-1",
      version: "thread-reply-2",
      body: "Oldest unread reply",
      isUnread: true,
      threadMessageCount: 2,
      threadUnreadCount: 2,
    });

    await act(async () => createInboxActions(registry).markRead(thread!.id));

    expect(api.saveReadStates).toHaveBeenCalledWith("token-a", {
      "conversation:thread-reply-1": "thread-reply-1",
      "conversation:thread-reply-2": "thread-reply-2",
    });
    expect(
      messages(registry).filter((message) => message.kind === "conversation"),
    ).toEqual([
      expect.objectContaining({
        id: "conversation:thread-reply-2",
        messageId: "thread-reply-2",
        isUnread: false,
        threadUnreadCount: 0,
      }),
    ]);
  });

  it("keeps a message the board no longer carries", async () => {
    const registry = signedIn({ teams: [team, otherTeam] });
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: team.id,
      payload: boardAt(1),
    });
    await mount(registry);
    await flushPromises();
    expect(messages(registry)).toHaveLength(1);

    // Opening another team replaces the source, and the stored record is what
    // keeps the first team's notification in the account-wide list.
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: otherTeam.id,
      payload: { ...boardAt(3, otherTeam), runs: [] },
    });
    await act(async () => registry.set(activeTeamIdAtom, otherTeam.id));
    await flushPromises();

    expect(messages(registry).map((message) => message.id)).toEqual([
      "issue:inbox-sync-run",
    ]);
  });

  describe("realtime", () => {
    it("debounces a burst of publishes into one refresh and shortens the poll", async () => {
      vi.useFakeTimers();
      try {
        const transport = createTransport();
        const registry = signedIn();
        await mount(registry, () => transport.handle);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(0);
        });
        const refreshes = api.loadFeed.mock.calls.length;

        expect(transport.starts).toBe(1);
        expect(transport.subscribers).toBe(1);
        expect(api.startPolling).toHaveBeenCalledWith(
          expect.any(Function),
          undefined,
          INBOX_REALTIME_FALLBACK_MS,
        );

        await act(async () => {
          transport.publish({ topic: "inbox", version: 1 } as never);
          transport.publish({ topic: "inbox", version: 2 } as never);
          await vi.advanceTimersByTimeAsync(INBOX_REALTIME_DEBOUNCE_MS - 1);
        });
        expect(api.loadFeed).toHaveBeenCalledTimes(refreshes);

        await act(async () => {
          await vi.advanceTimersByTimeAsync(2);
        });
        expect(api.loadFeed).toHaveBeenCalledTimes(refreshes + 1);

        // A publish this consumer already answered is not a second refresh.
        await act(async () => {
          transport.publish({ topic: "inbox", version: 1 } as never);
          transport.publish({ topic: "channel", version: 9 } as never);
          await vi.advanceTimersByTimeAsync(INBOX_REALTIME_DEBOUNCE_MS + 1);
        });
        expect(api.loadFeed).toHaveBeenCalledTimes(refreshes + 1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("leaves the default poll interval when there is no socket", async () => {
      const registry = signedIn();
      await mount(registry, null);
      await flushPromises();

      expect(api.startPolling).toHaveBeenCalledWith(
        expect.any(Function),
        undefined,
        undefined,
      );
    });

    it("stops and unsubscribes when the account signs out", async () => {
      const transport = createTransport();
      const registry = signedIn();
      await mount(registry, () => transport.handle);
      await flushPromises();
      expect(transport.starts).toBe(1);

      await act(async () => {
        registry.set(tokenAtom, null);
      });
      await flushPromises();

      expect(transport.stops).toBe(1);
      expect(transport.subscribers).toBe(0);
    });
  });
});
