/** @vitest-environment jsdom */

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardPayload, Project } from "../types";
import { demoDashboard } from "../lib/demo-data";
import {
  loadInboxFeed,
  loadInboxReadStates,
  saveInboxReadStates,
} from "../lib/api";
import { sendInboxNotification } from "../lib/inbox-notifications";
import { buildCurrentInboxMessages, useInbox } from "./useInbox";
import { useInboxNotifications } from "./useInboxNotifications";
import type {
  RealtimeNotification,
  RealtimeTransport,
} from "../lib/realtime-transport";

vi.mock("../lib/api", () => ({
  loadInboxFeed: vi.fn(),
  loadInboxReadStates: vi.fn(),
  saveInboxReadStates: vi.fn(),
}));
vi.mock("../lib/inbox-notifications", async (importOriginal) => ({
  ...await importOriginal<typeof import("../lib/inbox-notifications")>(),
  sendInboxNotification: vi.fn().mockResolvedValue(true),
}));

const mockedLoadInboxFeed = vi.mocked(loadInboxFeed);
const mockedLoadInboxReadStates = vi.mocked(loadInboxReadStates);
const mockedSaveInboxReadStates = vi.mocked(saveInboxReadStates);
const mockedSendInboxNotification = vi.mocked(sendInboxNotification);

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

function dashboardAt(revision: number): DashboardPayload {
  const run = demoDashboard.runs[1];
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
}

type HarnessProps = {
  dashboard: DashboardPayload;
  organizationId?: string | null;
  projects?: Project[];
  realtime?: RealtimeTransport | null;
  token: string;
  userId: string;
};

let inbox: ReturnType<typeof useInbox>;
let root: Root;
let container: HTMLDivElement;

function Harness({
  dashboard,
  organizationId: providedOrganizationId,
  projects: providedProjects,
  realtime = null,
  token,
  userId,
}: HarnessProps) {
  const sessions = useMemo(() => [], []);
  const projects = useMemo(
    () => providedProjects ?? [dashboard.project],
    [dashboard.project, providedProjects],
  );
  const organizationId = providedOrganizationId === undefined
    ? (dashboard.project.organizationId ?? null)
    : providedOrganizationId;
  inbox = useInbox(
    userId,
    organizationId,
    dashboard,
    sessions,
    projects,
    token,
    realtime,
  );
  useInboxNotifications(
    userId,
    organizationId,
    inbox.messages,
    inbox.notificationBaselineId,
    null,
    null,
    null,
    inbox.initialSyncComplete,
  );
  return null;
}

class FakeRealtimeTransport implements RealtimeTransport {
  private readonly listeners = new Set<
    (notification: RealtimeNotification) => void
  >();
  start = vi.fn();
  stop = vi.fn();

  subscribe(listener: (notification: RealtimeNotification) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(notification: RealtimeNotification) {
    for (const listener of this.listeners) listener(notification);
  }
}

async function renderHarness(props: HarnessProps) {
  await act(async () => root.render(<Harness {...props} />));
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useInbox read-state synchronization", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockedLoadInboxFeed.mockReset().mockResolvedValue({
      state: { etag: 'W/"organization-inbox:org:0"' },
      notModified: false,
      messages: [],
    });
    mockedLoadInboxReadStates.mockReset().mockResolvedValue({});
    mockedSaveInboxReadStates.mockReset().mockResolvedValue({});
    mockedSendInboxNotification.mockReset().mockResolvedValue(true);
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
  });

  it("loads another project's messages without selecting that project", async () => {
    const dashboard = dashboardAt(1);
    const secondProject: Project = {
      ...dashboard.project,
      id: "22222222-2222-4222-8222-222222222222",
      name: "Second project",
    };
    mockedLoadInboxFeed.mockResolvedValue({
      state: { etag: 'W/"organization-inbox:org:1"' },
      notModified: false,
      messages: [{
        id: "issue:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        kind: "issue",
        projectId: secondProject.id,
        projectName: secondProject.name,
        targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        title: "Needs attention in the second project",
        occurredAt: "2026-08-11T00:00:02.000Z",
        version: "1:1:blocked:implementing:2026-08-11T00:00:02.000Z:2",
        runNumber: 2,
        status: "blocked",
        workflowStage: "implementing",
        priority: 1,
        structuredResult: null,
      }],
    });

    await renderHarness({
      dashboard,
      projects: [dashboard.project, secondProject],
      token: "token-a",
      userId: "user-a",
    });
    await flushPromises();

    expect(mockedLoadInboxFeed).toHaveBeenCalledWith(
      "token-a",
      dashboard.project.organizationId,
      null,
      expect.any(AbortSignal),
    );
    expect(inbox.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        projectId: secondProject.id,
        title: "Needs attention in the second project",
      }),
    ]));
    expect(inbox.notificationBaselineId).toBe(
      `user-a:${dashboard.project.organizationId}`,
    );
  });

  it.each([
    { cache: "empty", stale: false },
    { cache: "stale", stale: true },
  ])(
    "keeps an $cache restart quiet until feed and read state are synchronized",
    async ({ stale }) => {
      const dashboard = dashboardAt(1);
      const authoritativeMessage = buildCurrentInboxMessages(
        dashboard,
        [],
        [dashboard.project],
        "user-a",
      )[0]!;
      if (stale) {
        const staleDashboard = dashboardAt(0);
        const staleMessage = buildCurrentInboxMessages(
          staleDashboard,
          [],
          [staleDashboard.project],
          "user-a",
        )[0]!;
        window.localStorage.setItem(
          "briar.inbox.v1:user-a",
          JSON.stringify({
            messages: [staleMessage],
            readVersions: { [staleMessage.id]: staleMessage.version },
          }),
        );
      }
      window.localStorage.setItem(
        "briar.settings.inbox-notifications.v1",
        JSON.stringify({
          urgent: true,
          action_required: true,
          important: true,
          activity: true,
        }),
      );
      const feed = deferred<Awaited<ReturnType<typeof loadInboxFeed>>>();
      const readStates = deferred<Record<string, string>>();
      mockedLoadInboxFeed.mockReturnValueOnce(feed.promise);
      mockedLoadInboxReadStates.mockReturnValueOnce(readStates.promise);

      await renderHarness({
        dashboard,
        token: "token-a",
        userId: "user-a",
      });

      expect(inbox.initialSyncComplete).toBe(false);
      expect(inbox.messages[0]).toMatchObject({
        id: authoritativeMessage.id,
        isUnread: false,
      });
      expect(inbox.unreadCount).toBe(0);
      expect(mockedSendInboxNotification).not.toHaveBeenCalled();

      feed.resolve({
        state: { etag: 'W/"organization-inbox:restart"' },
        notModified: false,
        messages: [authoritativeMessage],
      });
      await flushPromises();

      expect(inbox.initialSyncComplete).toBe(false);
      expect(inbox.messages[0]?.isUnread).toBe(false);
      expect(inbox.unreadCount).toBe(0);
      expect(mockedSendInboxNotification).not.toHaveBeenCalled();

      readStates.resolve({
        [authoritativeMessage.id]: authoritativeMessage.version,
      });
      await flushPromises();

      expect(inbox.initialSyncComplete).toBe(true);
      expect(inbox.messages[0]?.isUnread).toBe(false);
      expect(inbox.unreadCount).toBe(0);
      expect(mockedSendInboxNotification).not.toHaveBeenCalled();

      const updatedDashboard = dashboardAt(2);
      const updatedMessage = buildCurrentInboxMessages(
        updatedDashboard,
        [],
        [updatedDashboard.project],
        "user-a",
      )[0]!;
      await renderHarness({
        dashboard: updatedDashboard,
        token: "token-a",
        userId: "user-a",
      });
      await flushPromises();

      expect(inbox.messages[0]).toMatchObject({
        id: updatedMessage.id,
        version: updatedMessage.version,
        isUnread: true,
      });
      expect(inbox.unreadCount).toBe(1);
      expect(mockedSendInboxNotification).toHaveBeenCalledTimes(1);
      expect(mockedSendInboxNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: updatedMessage.id,
          version: updatedMessage.version,
        }),
        expect.any(String),
      );

      await renderHarness({
        dashboard: updatedDashboard,
        token: "token-a",
        userId: "user-a",
      });
      await flushPromises();
      expect(mockedSendInboxNotification).toHaveBeenCalledTimes(1);
    },
  );

  it("does not reuse the notification gate across organizations", async () => {
    const dashboard = dashboardAt(1);
    await renderHarness({
      dashboard,
      token: "token-a",
      userId: "user-a",
    });
    await flushPromises();
    expect(inbox.initialSyncComplete).toBe(true);

    const organizationId = "33333333-3333-4333-8333-333333333333";
    const nextFeed = deferred<Awaited<ReturnType<typeof loadInboxFeed>>>();
    mockedLoadInboxFeed.mockReturnValueOnce(nextFeed.promise);
    await renderHarness({
      dashboard,
      organizationId,
      token: "token-a",
      userId: "user-a",
    });

    expect(inbox.initialSyncComplete).toBe(false);
    expect(inbox.notificationBaselineId).toBe("user-a:local");
    expect(inbox.unreadCount).toBe(0);

    nextFeed.resolve({
      state: { etag: 'W/"organization-inbox:other"' },
      notModified: false,
      messages: [],
    });
    await flushPromises();

    expect(inbox.initialSyncComplete).toBe(true);
    expect(inbox.notificationBaselineId).toBe(`user-a:${organizationId}`);
    expect(mockedSendInboxNotification).not.toHaveBeenCalled();
  });

  it("coalesces shared WebSocket Inbox versions into one conditional refresh", async () => {
    vi.useFakeTimers();
    const realtime = new FakeRealtimeTransport();
    try {
      await renderHarness({
        dashboard: dashboardAt(1),
        realtime,
        token: "token-a",
        userId: "user-a",
      });
      await flushPromises();
      expect(mockedLoadInboxFeed).toHaveBeenCalledTimes(1);
      expect(realtime.start).toHaveBeenCalledOnce();

      realtime.emit({ topic: "inbox", version: 4 });
      realtime.emit({ topic: "inbox", version: 5 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      await flushPromises();

      expect(mockedLoadInboxFeed).toHaveBeenCalledTimes(2);

      realtime.emit({ topic: "channels", cursor: 10 });
      realtime.emit({ topic: "inbox", version: 5 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      expect(mockedLoadInboxFeed).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("refreshes subscribed thread notifications while the app is hidden", async () => {
    vi.useFakeTimers();
    const realtime = new FakeRealtimeTransport();
    let hidden: { mockRestore(): void } | null = null;
    let visibility: { mockRestore(): void } | null = null;
    try {
      window.localStorage.setItem(
        "briar.settings.inbox-notifications.v1",
        JSON.stringify({
          urgent: false,
          action_required: true,
          important: false,
          activity: false,
        }),
      );
      await renderHarness({
        dashboard: dashboardAt(1),
        realtime,
        token: "token-a",
        userId: "user-a",
      });
      await flushPromises();
      expect(realtime.start).toHaveBeenCalledOnce();
      hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
      visibility = vi.spyOn(document, "visibilityState", "get")
        .mockReturnValue("hidden");

      mockedLoadInboxFeed.mockResolvedValueOnce({
        state: { etag: 'W/"organization-inbox:org:2"' },
        notModified: false,
        messages: [{
          id: "channel:subscribed-thread-reply",
          kind: "channel",
          projectId: demoDashboard.project.id,
          projectName: demoDashboard.project.name,
          targetId: "channel-product",
          channelId: "channel-product",
          channelName: "product",
          messageId: "subscribed-thread-reply",
          rootMessageId: "webhook-root",
          title: "product",
          occurredAt: "2026-08-11T00:00:02.000Z",
          version: "subscribed-thread-reply",
          body: "Agent reply for this thread",
          authorName: "Developer",
          authorImage: null,
          reason: "subscription",
        }],
      });

      realtime.emit({ topic: "inbox", version: 2 });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(300);
      });
      await flushPromises();

      expect(realtime.stop).not.toHaveBeenCalled();
      expect(mockedLoadInboxFeed).toHaveBeenCalledTimes(2);
      expect(mockedSendInboxNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "channel:subscribed-thread-reply",
          reason: "subscription",
        }),
        expect.any(String),
      );
    } finally {
      hidden?.mockRestore();
      visibility?.mockRestore();
      vi.useRealTimers();
    }
  });

  it("keeps the selected-project fallback when the organization feed is offline", async () => {
    mockedLoadInboxFeed.mockRejectedValueOnce(new Error("offline"));

    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });
    await flushPromises();

    expect(inbox.messages).toEqual([
      expect.objectContaining({
        id: "issue:inbox-sync-run",
        projectId: demoDashboard.project.id,
      }),
    ]);
    expect(inbox.notificationBaselineId).toBe("user-a:local");
  });


  it("preserves richer local details for the same canonical feed version", async () => {
    const feed = deferred<Awaited<ReturnType<typeof loadInboxFeed>>>();
    mockedLoadInboxFeed.mockReturnValueOnce(feed.promise);
    const dashboard = dashboardAt(1);

    await renderHarness({
      dashboard,
      token: "token-a",
      userId: "user-a",
    });
    const selectedMessage = inbox.messages[0]!;

    feed.resolve({
      state: { etag: 'W/"organization-inbox:org:1"' },
      notModified: false,
      messages: [{ ...selectedMessage, title: "Compact feed title" }],
    });
    await flushPromises();

    expect(inbox.messages[0]?.title).toBe(selectedMessage.title);
  });

  it("removes cached issue messages after the member unsubscribes", async () => {
    mockedLoadInboxFeed.mockResolvedValueOnce({
      state: { etag: 'W/"organization-inbox:org:2"' },
      notModified: false,
      messages: [],
      subscribedIssueIds: [],
    });

    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });
    await flushPromises();

    expect(inbox.messages).toEqual([]);
    expect(inbox.unreadCount).toBe(0);
  });

  it("removes cached session messages absent from the authoritative feed", async () => {
    const occurredAt = "2026-08-01T12:22:38.913Z";
    window.localStorage.setItem(
      "briar.inbox.v1:user-a",
      JSON.stringify({
        messages: [{
          id: "session:another-members-session",
          kind: "session",
          projectId: demoDashboard.project.id,
          projectName: demoDashboard.project.name,
          targetId: "another-members-session",
          title: "Private execution result",
          occurredAt,
          version: `session:v1:failed:${occurredAt}`,
          status: "failed",
          agentName: "Inbox Agent",
          issueCount: 1,
          error: "Runner stopped",
          summary: null,
          requiresAttention: true,
        }],
        readVersions: {},
      }),
    );
    mockedLoadInboxFeed.mockResolvedValueOnce({
      state: { etag: 'W/"organization-inbox:org:3"' },
      notModified: false,
      messages: [],
      subscribedIssueIds: [],
    });

    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });
    await flushPromises();

    expect(inbox.messages).toEqual([]);
    expect(inbox.unreadCount).toBe(0);
  });

  it("reuses the organization Inbox ETag after reconnecting", async () => {
    const etag = 'W/"organization-inbox:org:7"';
    mockedLoadInboxFeed
      .mockResolvedValueOnce({
        state: { etag },
        notModified: false,
        messages: [],
      })
      .mockResolvedValueOnce({
        state: { etag },
        notModified: true,
        messages: [],
      });

    const dashboard = dashboardAt(1);
    await renderHarness({ dashboard, token: "token-a", userId: "user-a" });
    await flushPromises();
    await act(async () => window.dispatchEvent(new Event("online")));
    await flushPromises();

    expect(mockedLoadInboxFeed).toHaveBeenNthCalledWith(
      2,
      "token-a",
      dashboard.project.organizationId,
      { etag },
      expect.any(AbortSignal),
    );
  });

  it("refreshes account read state when the app regains focus", async () => {
    let remote: Record<string, string> = {};
    mockedLoadInboxReadStates.mockImplementation(async () => remote);
    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });

    const message = inbox.messages[0];
    expect(message?.isUnread).toBe(true);
    remote = { [message.id]: message.version };

    await act(async () => window.dispatchEvent(new Event("focus")));
    await flushPromises();

    expect(mockedLoadInboxReadStates).toHaveBeenCalledTimes(2);
    expect(inbox.messages[0]?.isUnread).toBe(false);
  });

  it("marks an issue and its conversation replies read together", async () => {
    const dashboard = dashboardAt(1);
    dashboard.conversationNotifications = [
      {
        id: "reply-message",
        runId: "inbox-sync-run",
        runTitle: "Needs attention",
        rootMessageId: "root-message",
        body: "I added the requested answer.",
        author: {
          id: "reply-author",
          name: "Reply author",
          image: null,
          provider: null,
        },
        reason: "thread_reply",
        createdAt: "2026-08-11T00:00:02.000Z",
      },
    ];
    await renderHarness({
      dashboard,
      token: "token-a",
      userId: "user-a",
    });

    expect(inbox.messages).toEqual([
      expect.objectContaining({
        id: "conversation:reply-message",
        isUnread: true,
      }),
      expect.objectContaining({
        id: "issue:inbox-sync-run",
        isUnread: true,
      }),
    ]);

    await act(async () => inbox.markIssueRead("inbox-sync-run"));

    expect(inbox.messages.every((message) => !message.isUnread)).toBe(true);
    expect(mockedSaveInboxReadStates).toHaveBeenCalledWith(
      "token-a",
      Object.fromEntries(
        inbox.messages.map((message) => [message.id, message.version]),
      ),
    );
  });

  it("isolates an old account PUT from the new account generation", async () => {
    const accountAPush = deferred<Record<string, string>>();
    const accountBPush = deferred<Record<string, string>>();
    mockedSaveInboxReadStates.mockImplementation((token) =>
      token === "token-a" ? accountAPush.promise : accountBPush.promise,
    );

    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });
    const accountAMessage = inbox.messages[0];
    await act(async () => inbox.markAllRead());
    expect(mockedSaveInboxReadStates).toHaveBeenNthCalledWith(
      1,
      "token-a",
      { [accountAMessage.id]: accountAMessage.version },
    );

    await renderHarness({
      dashboard: dashboardAt(2),
      token: "token-b",
      userId: "user-b",
    });
    const accountBMessage = inbox.messages[0];
    await act(async () => inbox.markAllRead());

    expect(mockedSaveInboxReadStates).toHaveBeenCalledTimes(2);
    expect(mockedSaveInboxReadStates).toHaveBeenNthCalledWith(
      2,
      "token-b",
      { [accountBMessage.id]: accountBMessage.version },
    );

    accountBPush.resolve({ [accountBMessage.id]: accountBMessage.version });
    await flushPromises();
    accountAPush.resolve({ [accountAMessage.id]: accountAMessage.version });
    await flushPromises();

    expect(inbox.messages[0]).toMatchObject({
      version: accountBMessage.version,
      isUnread: false,
    });
  });

  it("ignores an older GET that arrives after the latest local PUT", async () => {
    const initialGet = deferred<Record<string, string>>();
    const push = deferred<Record<string, string>>();
    mockedLoadInboxReadStates.mockReturnValue(initialGet.promise);
    mockedSaveInboxReadStates.mockReturnValue(push.promise);

    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });
    const message = inbox.messages[0];
    await act(async () => inbox.markAllRead());

    push.resolve({ [message.id]: message.version });
    await flushPromises();
    initialGet.resolve({ [message.id]: "stale-server-version" });
    await flushPromises();

    expect(inbox.messages[0]?.isUnread).toBe(false);
  });

  it("serializes PUTs and preserves a newer read while the first PUT returns", async () => {
    const firstPush = deferred<Record<string, string>>();
    const secondPush = deferred<Record<string, string>>();
    mockedSaveInboxReadStates
      .mockReturnValueOnce(firstPush.promise)
      .mockReturnValueOnce(secondPush.promise);

    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });
    const firstVersion = inbox.messages[0];
    await act(async () => inbox.markAllRead());

    await renderHarness({
      dashboard: dashboardAt(2),
      token: "token-a",
      userId: "user-a",
    });
    const secondVersion = inbox.messages[0];
    expect(secondVersion.isUnread).toBe(true);
    await act(async () => inbox.markAllRead());

    expect(mockedSaveInboxReadStates).toHaveBeenCalledTimes(1);
    firstPush.resolve({ [firstVersion.id]: firstVersion.version });
    await flushPromises();

    expect(mockedSaveInboxReadStates).toHaveBeenCalledTimes(2);
    expect(mockedSaveInboxReadStates).toHaveBeenNthCalledWith(
      2,
      "token-a",
      { [secondVersion.id]: secondVersion.version },
    );
    expect(inbox.messages[0]?.isUnread).toBe(false);

    secondPush.resolve({ [secondVersion.id]: secondVersion.version });
    await flushPromises();
  });

  it("keeps a failed PUT queued without immediately retrying forever", async () => {
    mockedSaveInboxReadStates
      .mockRejectedValueOnce(new Error("invalid request"))
      .mockResolvedValueOnce({});
    await renderHarness({
      dashboard: dashboardAt(1),
      token: "token-a",
      userId: "user-a",
    });

    await act(async () => inbox.markAllRead());
    await flushPromises();
    expect(mockedSaveInboxReadStates).toHaveBeenCalledTimes(1);

    await act(async () => window.dispatchEvent(new Event("focus")));
    await flushPromises();
    expect(mockedSaveInboxReadStates).toHaveBeenCalledTimes(2);
  });
});
