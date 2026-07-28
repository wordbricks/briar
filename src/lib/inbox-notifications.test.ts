/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import {
  defaultInboxNotificationPreferences,
  readInboxNotificationPreferences,
  writeInboxNotificationPreferences,
} from "./inbox-notifications";

describe("inbox notification preferences", () => {
  beforeEach(() => {
    window.localStorage.clear();
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
