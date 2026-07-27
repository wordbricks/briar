import { describe, expect, it } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import type { AutoHuntSession } from "./useAutoHuntSessions";
import {
  buildCurrentInboxMessages,
  isInboxMessageUnread,
  mergeInboxMessages,
} from "./useInbox";

const project = demoDashboard.project;

function session(
  status: AutoHuntSession["status"],
  id = `session-${status}`,
): AutoHuntSession {
  const startedAt = "2026-07-24T01:00:00.000Z";
  const completedAt = "2026-07-24T01:10:00.000Z";
  return {
    id,
    dispatchGroupId: id,
    workers: [],
    dispatchEvents: [],
    projectId: project.id,
    status,
    issues: [
      {
        runId: "run-1",
        runNumber: 1,
        sourceKey: "ISSUE-1",
        title: "Inbox test",
        outcome: status === "completed" ? "completed" : "failed",
        summary: null,
      },
    ],
    startedAt,
    completedAt: status === "running" ? null : completedAt,
    conversationId: null,
    workspaceRoot: null,
    summary: status === "completed" ? "Done" : null,
    error: status === "failed" ? "Runner stopped" : null,
    events: [
      { id: `${id}-started`, type: "started", occurredAt: startedAt },
      ...(status === "completed" || status === "failed"
        ? [{ id: `${id}-${status}`, type: status, occurredAt: completedAt }]
        : []),
    ],
  };
}

describe("Inbox messages", () => {
  it("keeps only the latest message when an issue status changes", () => {
    const originalDashboard = {
      ...demoDashboard,
      runs: [demoDashboard.runs[0]],
    };
    const original = buildCurrentInboxMessages(
      originalDashboard,
      [],
      [project],
    );
    const run = originalDashboard.runs[0];
    const occurredAt = "2026-07-24T02:00:00.000Z";
    const changedDashboard = {
      ...originalDashboard,
      runs: [
        {
          ...run,
          status: "completed" as const,
          workflowStage: null,
          updatedAt: occurredAt,
          completedAt: occurredAt,
          events: [
            ...run.events,
            {
              ...run.events[0],
              id: "latest-completed-event",
              status: "completed" as const,
              workflowStage: null,
              occurredAt,
              recordedAt: occurredAt,
            },
          ],
        },
      ],
    };
    const current = buildCurrentInboxMessages(
      changedDashboard,
      [],
      [project],
    );

    const merged = mergeInboxMessages(original, current, [project]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: `issue:${run.id}`,
      status: "completed",
      version: "latest-completed-event",
    });
  });

  it("creates session messages only for completed and failed sessions", () => {
    const messages = buildCurrentInboxMessages(
      null,
      [session("running"), session("completed"), session("failed")],
      [project],
    );

    expect(messages.map((message) => message.id)).toEqual([
      "session:session-completed",
      "session:session-failed",
    ]);
  });

  it("marks a new message version unread after an earlier version was read", () => {
    const [message] = buildCurrentInboxMessages(
      null,
      [session("completed")],
      [project],
    );

    expect(isInboxMessageUnread(message, {})).toBe(true);
    expect(
      isInboxMessageUnread(message, { [message.id]: message.version }),
    ).toBe(false);
    expect(
      isInboxMessageUnread(message, { [message.id]: "previous-version" }),
    ).toBe(true);
  });
});
