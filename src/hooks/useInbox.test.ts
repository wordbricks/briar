import { describe, expect, it } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import type { AutoHuntSession } from "./useAutoHuntSessions";
import {
  buildCurrentInboxMessages,
  classifyInboxMessage,
  groupInboxMessages,
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

  it("creates one message for a task and its linked Auto Hunt dispatch", () => {
    const taskSession = {
      ...session("completed", "task-session"),
      sessionType: "task" as const,
      request: "Process queued issues with Auto Hunt.",
      issues: [],
    };
    const dispatchSession = {
      ...session("completed", "dispatch-session"),
      sessionType: "dispatch" as const,
      parentSessionId: taskSession.id,
      request: taskSession.request,
    };

    const messages = buildCurrentInboxMessages(
      null,
      [dispatchSession, taskSession],
      [project],
    );

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "session:dispatch-session",
      title: "Process queued issues with Auto Hunt.",
      issueCount: 1,
    });
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

  it("separates urgent, actionable, important, and routine updates", () => {
    const baseRun = demoDashboard.runs[0];
    const messages = buildCurrentInboxMessages(
      {
        ...demoDashboard,
        runs: [
          {
            ...baseRun,
            id: "urgent",
            priority: 1,
            status: "failed",
          },
          {
            ...baseRun,
            id: "action",
            priority: 3,
            status: "completed",
            structuredResult: {
              summary: "A product decision is required.",
              outcome: "partial",
              importance: "important",
              urgency: "time_sensitive",
              impact: "issue",
              humanActionRequired: true,
              nextAction: "Choose the release scope.",
              dueAt: null,
            },
          },
          {
            ...baseRun,
            id: "important",
            priority: 3,
            status: "completed",
            structuredResult: {
              summary: "The project milestone shipped.",
              outcome: "completed",
              importance: "important",
              urgency: "normal",
              impact: "project",
              humanActionRequired: false,
              nextAction: null,
              dueAt: null,
            },
          },
          {
            ...baseRun,
            id: "activity",
            priority: 3,
            status: "completed",
            structuredResult: {
              summary: "Routine maintenance completed.",
              outcome: "completed",
              importance: "routine",
              urgency: "normal",
              impact: "issue",
              humanActionRequired: false,
              nextAction: null,
              dueAt: null,
            },
          },
        ],
      },
      [],
      [project],
    ).map((message) => ({ ...message, isUnread: true }));

    const grouped = groupInboxMessages(messages);

    expect(grouped.urgent.map((message) => message.targetId)).toEqual([
      "urgent",
    ]);
    expect(grouped.action_required.map((message) => message.targetId)).toEqual([
      "action",
    ]);
    expect(grouped.important.map((message) => message.targetId)).toEqual([
      "important",
    ]);
    expect(grouped.activity.map((message) => message.targetId)).toEqual([
      "activity",
    ]);
    expect(messages.map(classifyInboxMessage)).toEqual([
      "urgent",
      "action_required",
      "important",
      "activity",
    ]);
  });
});
