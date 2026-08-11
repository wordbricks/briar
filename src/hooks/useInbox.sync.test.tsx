/** @vitest-environment jsdom */

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardPayload } from "../types";
import { demoDashboard } from "../lib/demo-data";
import {
  loadInboxReadStates,
  saveInboxReadStates,
} from "../lib/api";
import { useInbox } from "./useInbox";

vi.mock("../lib/api", () => ({
  loadInboxReadStates: vi.fn(),
  saveInboxReadStates: vi.fn(),
}));

const mockedLoadInboxReadStates = vi.mocked(loadInboxReadStates);
const mockedSaveInboxReadStates = vi.mocked(saveInboxReadStates);

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
  token: string;
  userId: string;
};

let inbox: ReturnType<typeof useInbox>;
let root: Root;
let container: HTMLDivElement;

function Harness({ dashboard, token, userId }: HarnessProps) {
  const sessions = useMemo(() => [], []);
  const projects = useMemo(() => [dashboard.project], [dashboard.project]);
  inbox = useInbox(
    userId,
    dashboard.project.organizationId ?? null,
    dashboard,
    sessions,
    projects,
    token,
  );
  return null;
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
    mockedLoadInboxReadStates.mockReset().mockResolvedValue({});
    mockedSaveInboxReadStates.mockReset().mockResolvedValue({});
    container = document.createElement("div");
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
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
