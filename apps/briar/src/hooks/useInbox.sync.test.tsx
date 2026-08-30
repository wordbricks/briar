/** @vitest-environment jsdom */

import { act, useMemo } from "react";
import type { Root } from "react-dom/client";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import type { DashboardPayload } from "../types";
import {
  type InboxSyncDependencies,
  useInbox,
} from "./useInbox";

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

const sync = {
  loadFeed: vi.fn<InboxSyncDependencies["loadFeed"]>(),
  loadReadStates: vi.fn<InboxSyncDependencies["loadReadStates"]>(),
  saveReadStates: vi.fn<InboxSyncDependencies["saveReadStates"]>(),
  startPolling: vi.fn<InboxSyncDependencies["startPolling"]>(),
} satisfies InboxSyncDependencies;

const dashboardAt = (revision: number): DashboardPayload => {
  const run = demoDashboard.runs[1]!;
  const occurredAt = `2026-08-11T00:00:0${revision}.000Z`;
  return {
    ...demoDashboard,
    runs: [{
      ...run,
      id: "inbox-sync-run",
      currentRevision: revision,
      priority: 1,
      status: "completed",
      workflowStage: null,
      subscribers: ["user-a", "user-b"].map((userId) => ({
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

let inbox: ReturnType<typeof useInbox>;
let root: Root;
let cleanup: () => Promise<void>;
let container: HTMLDivElement;

function Harness({
  dashboard,
  token,
  userId,
}: {
  dashboard: DashboardPayload;
  token: string;
  userId: string;
}) {
  const sessions = useMemo(() => [], []);
  const projects = useMemo(() => [dashboard.project], [dashboard.project]);
  inbox = useInbox(
    userId,
    dashboard.project.organizationId,
    dashboard,
    sessions,
    projects,
    token,
    null,
    sync,
  );
  return null;
}

const renderHarness = async (props: {
  dashboard: DashboardPayload;
  token: string;
  userId: string;
}) => {
  await renderReactTestRoot(root, <Harness {...props} />);
};

const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("Inbox read-state synchronization", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.clear();
    sync.loadFeed.mockReset().mockResolvedValue({
      state: { etag: 'W/"organization-inbox:org:0"' },
      notModified: false,
      messages: [],
    });
    sync.loadReadStates.mockReset().mockResolvedValue({});
    sync.saveReadStates.mockReset().mockResolvedValue({});
    sync.startPolling.mockReset().mockReturnValue(() => undefined);
    ({ cleanup, container, root } = createReactTestRoot());
  });

  afterEach(async () => {
    await cleanup();
  });

  it("isolates an old account PUT from the new account generation", async () => {
    const accountAPush = deferred<Record<string, string>>();
    const accountBPush = deferred<Record<string, string>>();
    sync.saveReadStates.mockImplementation((token) =>
      token === "token-a" ? accountAPush.promise : accountBPush.promise
    );

    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });
    const accountAMessage = inbox.messages[0]!;
    await act(async () => inbox.markAllRead());

    await renderHarness({
      dashboard: dashboardAt(2),
      token: "token-b",
      userId: "user-b",
    });
    const accountBMessage = inbox.messages[0]!;
    await act(async () => inbox.markAllRead());

    accountBPush.resolve({ [accountBMessage.id]: accountBMessage.version });
    await flushPromises();
    accountAPush.resolve({ [accountAMessage.id]: accountAMessage.version });
    await flushPromises();

    expect(inbox.messages[0]).toMatchObject({
      version: accountBMessage.version,
      isUnread: false,
    });
  });

  it("ignores a GET that predates the latest local PUT", async () => {
    const initialGet = deferred<Record<string, string>>();
    const push = deferred<Record<string, string>>();
    sync.loadReadStates.mockReturnValue(initialGet.promise);
    sync.saveReadStates.mockReturnValue(push.promise);

    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });
    const message = inbox.messages[0]!;
    await act(async () => inbox.markAllRead());

    push.resolve({ [message.id]: message.version });
    await flushPromises();
    initialGet.resolve({ [message.id]: "stale-server-version" });
    await flushPromises();

    expect(inbox.messages[0]?.isUnread).toBe(false);
  });

  it("serializes PUTs and preserves a newer read during the first request", async () => {
    const firstPush = deferred<Record<string, string>>();
    const secondPush = deferred<Record<string, string>>();
    sync.saveReadStates
      .mockReturnValueOnce(firstPush.promise)
      .mockReturnValueOnce(secondPush.promise);

    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });
    const firstVersion = inbox.messages[0]!;
    await act(async () => inbox.markAllRead());

    await renderHarness({
      dashboard: dashboardAt(2),
      token: "token-a",
      userId: "user-a",
    });
    const secondVersion = inbox.messages[0]!;
    await act(async () => inbox.markAllRead());

    expect(sync.saveReadStates).toHaveBeenCalledTimes(1);
    firstPush.resolve({ [firstVersion.id]: firstVersion.version });
    await flushPromises();

    expect(sync.saveReadStates).toHaveBeenNthCalledWith(
      2,
      "token-a",
      { [secondVersion.id]: secondVersion.version },
    );
    expect(inbox.messages[0]?.isUnread).toBe(false);

    secondPush.resolve({ [secondVersion.id]: secondVersion.version });
    await flushPromises();
  });

  it("queues a failed PUT without immediately retrying forever", async () => {
    sync.saveReadStates
      .mockRejectedValueOnce(new Error("invalid request"))
      .mockResolvedValueOnce({});
    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });

    await act(async () => inbox.markAllRead());
    await flushPromises();
    expect(sync.saveReadStates).toHaveBeenCalledTimes(1);

    await act(async () => window.dispatchEvent(new Event("focus")));
    await flushPromises();
    expect(sync.saveReadStates).toHaveBeenCalledTimes(2);
  });

  it("collapses one thread, opens its oldest unread reply, and reads every reply", async () => {
    sync.startPolling.mockImplementationOnce((refresh) => {
      refresh("poll");
      return () => undefined;
    });
    const dashboard = {
      ...dashboardAt(1),
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
    };

    await renderHarness({
      dashboard,
      token: "token-a",
      userId: "user-a",
    });
    await vi.waitFor(() => expect(inbox.initialSyncComplete).toBe(true));
    const thread = inbox.messages.find(
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

    await act(async () => inbox.markRead(thread!.id));

    expect(sync.saveReadStates).toHaveBeenCalledWith("token-a", {
      "conversation:thread-reply-1": "thread-reply-1",
      "conversation:thread-reply-2": "thread-reply-2",
    });
    expect(
      inbox.messages.filter((message) => message.kind === "conversation"),
    ).toEqual([
      expect.objectContaining({
        id: "conversation:thread-reply-2",
        messageId: "thread-reply-2",
        isUnread: false,
        threadUnreadCount: 0,
      }),
    ]);
  });
});
