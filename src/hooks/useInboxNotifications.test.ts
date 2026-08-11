import { describe, expect, it } from "vitest";

import type { InboxMessageWithReadState } from "./useInbox";
import {
  findChangedInboxMessages,
  inboxNotificationVersion,
} from "./useInboxNotifications";

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

  it("ignores legacy and canonical versions of the same terminal session", () => {
    const terminalSession: InboxMessageWithReadState = {
      id: "session:session-1",
      kind: "session",
      isUnread: true,
      occurredAt: "2026-08-01T12:22:38.913Z",
      projectId: "project-1",
      projectName: "Briar",
      targetId: "session-1",
      title: "Completed task",
      version: "legacy-terminal-event-id",
      status: "failed",
      agentName: "Inbox Agent",
      issueCount: 1,
      error: "Runner stopped",
      summary: null,
      requiresAttention: true,
    };
    const baselineVersion = inboxNotificationVersion(terminalSession);

    expect(
      findChangedInboxMessages(
        { [terminalSession.id]: baselineVersion },
        [{
          ...terminalSession,
          version: "failed:2026-08-01T12:22:38.913Z",
        }],
      ),
    ).toEqual([]);
  });
});
