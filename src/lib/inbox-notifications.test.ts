/** @vitest-environment jsdom */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InboxMessage } from "../hooks/useInbox";
import {
  defaultInboxNotificationPreferences,
  inboxNotificationTarget,
  listenForMacInboxNotificationClicks,
  listenForInboxNotificationClicks,
  readInboxNotificationPreferences,
  sendInboxNotification,
  targetFromNotificationAction,
  writeInboxNotificationPreferences,
} from "./inbox-notifications";

const message: InboxMessage = {
  id: "issue:run-1",
  kind: "issue",
  projectId: "project-1",
  projectName: "Briar",
  targetId: "run-1",
  title: "Notification test",
  occurredAt: "2026-07-31T00:00:00.000Z",
  version: "event-1",
  runNumber: 1,
  status: "completed",
  workflowStage: null,
  priority: 2,
  structuredResult: null,
};

describe("inbox notification preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults every inbox importance category off", () => {
    expect(readInboxNotificationPreferences()).toEqual(
      defaultInboxNotificationPreferences(),
    );
  });

  it("persists each importance category independently", () => {
    writeInboxNotificationPreferences({
      urgent: true,
      action_required: false,
      important: true,
      activity: false,
    });

    expect(readInboxNotificationPreferences()).toEqual({
      urgent: true,
      action_required: false,
      important: true,
      activity: false,
    });
  });

  it("ignores malformed and non-boolean stored values", () => {
    window.localStorage.setItem(
      "briar.settings.inbox-notifications.v1",
      JSON.stringify({ urgent: "yes", activity: true }),
    );

    expect(readInboxNotificationPreferences()).toEqual({
      urgent: false,
      action_required: false,
      important: false,
      activity: true,
    });
  });
});

describe("inbox notification navigation", () => {
  beforeEach(() => {
    window.localStorage.clear();
    Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads an Android notification target from the action payload", () => {
    const target = inboxNotificationTarget(message);

    expect(
      targetFromNotificationAction({
        actionId: "tap",
        notification: {
          extra: { briarInboxTarget: JSON.stringify(target) },
        },
      }),
    ).toEqual(target);
  });

  it("falls back to the stored target for iOS action payloads", () => {
    const target = inboxNotificationTarget(message);
    window.localStorage.setItem(
      "briar.inbox.notification-targets.v1",
      JSON.stringify({ 42: { ...target, storedAt: Date.now() } }),
    );

    expect(
      targetFromNotificationAction({
        actionId: "tap",
        notification: { id: 42 },
      }),
    ).toEqual(target);
    expect(
      targetFromNotificationAction({
        actionId: "dismiss",
        notification: { id: 42 },
      }),
    ).toBeNull();
  });

  it("opens the matching target when a browser notification is clicked", async () => {
    const notifications: MockNotification[] = [];
    class MockNotification {
      static permission = "granted";
      onclick: (() => void) | null = null;
      close = vi.fn();

      constructor() {
        notifications.push(this);
      }
    }
    vi.stubGlobal("Notification", MockNotification);
    vi.spyOn(window, "focus").mockImplementation(() => {});
    const onOpen = vi.fn();
    const stopListening = await listenForInboxNotificationClicks(onOpen);

    expect(await sendInboxNotification(message, "Important")).toBe(true);
    const [notification] = notifications;
    notification.onclick?.();

    expect(onOpen).toHaveBeenCalledWith(inboxNotificationTarget(message));
    expect(notification.close).toHaveBeenCalledOnce();
    stopListening();
  });

  it("drains macOS notification clicks registered before the webview starts", async () => {
    const target = inboxNotificationTarget(message);
    let notifyAvailable: (() => void) | undefined;
    const onOpen = vi.fn();
    const drain = vi
      .fn<() => Promise<unknown>>()
      .mockResolvedValueOnce([target, { malformed: true }])
      .mockResolvedValueOnce([{ ...target, targetId: "run-2" }]);
    const unlisten = vi.fn();
    const stopListening = await listenForMacInboxNotificationClicks(onOpen, {
      listenAvailable: async (callback) => {
        notifyAvailable = callback;
        return unlisten;
      },
      drain,
    });

    expect(onOpen).toHaveBeenCalledWith(target);
    notifyAvailable?.();
    await vi.waitFor(() => expect(onOpen).toHaveBeenCalledTimes(2));
    expect(onOpen).toHaveBeenLastCalledWith({ ...target, targetId: "run-2" });

    stopListening();
    expect(unlisten).toHaveBeenCalledOnce();
  });
});
