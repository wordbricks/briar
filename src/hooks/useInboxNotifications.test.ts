import { describe, expect, it } from "vitest";

import type { InboxMessageWithReadState } from "./useInbox";
import { findChangedInboxMessages } from "./useInboxNotifications";

const message = (
  id: string,
  version: string,
): InboxMessageWithReadState => ({
  id,
  kind: "issue",
  isUnread: true,
  occurredAt: "2026-07-29T00:00:00.000Z",
  priority: 1,
  projectId: "project-1",
  projectName: "Briar",
  runNumber: 1,
  status: "failed",
  structuredResult: null,
  targetId: id,
  title: "Notification test",
  version,
  workflowStage: null,
});

describe("inbox notification change detection", () => {
  it("returns only new message ids and changed versions", () => {
    const messages = [
      message("unchanged", "v1"),
      message("changed", "v2"),
      message("new", "v1"),
    ];

    expect(
      findChangedInboxMessages(
        { unchanged: "v1", changed: "v1" },
        messages,
      ).map((candidate) => candidate.id),
    ).toEqual(["changed", "new"]);
  });
});
