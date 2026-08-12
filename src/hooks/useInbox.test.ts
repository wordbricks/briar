import { describe, expect, it } from "vitest";
import { demoDashboard } from "../lib/demo-data";
import type { AutoHuntSession } from "./useAutoHuntSessions";
import {
  buildCurrentInboxMessages,
  classifyInboxMessage,
  filterInboxMessagesByOrganization,
  inboxReadVersionsToPush,
  isInboxMessageUnread,
  mergeInboxMessages,
  mergeInboxReadVersions,
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
    agentName: "Inbox Agent",
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
  it("does not add skipped no-work sessions to important notifications", () => {
    expect(
      buildCurrentInboxMessages(null, [session("skipped")], [project]),
    ).toEqual([]);
  });

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
          lastEventAt: occurredAt,
          eventCount: run.eventCount + 1,
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
      version: `1:1:completed:none:${occurredAt}:${run.eventCount + 1}`,
    });
  });

  it("preserves configured labels for custom workflow stages", () => {
    const run = demoDashboard.runs[0];
    const workflow = {
      ...run.workflow,
      stages: [
        ...run.workflow.stages,
        {
          id: "merged",
          label: "Merge to main",
          required: true,
        },
      ],
    };
    const [message] = buildCurrentInboxMessages(
      {
        ...demoDashboard,
        runs: [
          {
            ...run,
            status: "paused",
            workflowStage: "merged",
            workflow,
          },
        ],
      },
      [],
      [project],
    );

    expect(message).toMatchObject({
      kind: "issue",
      workflowStage: "merged",
      workflowStageLabel: "Merge to main",
    });
  });

  it("surfaces only decision and terminal run states in the inbox", () => {
    const baseRun = demoDashboard.runs[0];
    const statuses = [
      "backlog",
      "queued",
      "running",
      "paused",
      "blocked",
      "failed",
      "completed",
      "cancelled",
    ] as const;
    const messages = buildCurrentInboxMessages(
      {
        ...demoDashboard,
        runs: statuses.map((status, index) => ({
          ...baseRun,
          id: `run-${status}`,
          runNumber: index + 1,
          status,
        })),
      },
      [],
      [project],
    );

    expect(messages.map((message) => message.targetId)).toEqual([
      "run-paused",
      "run-blocked",
      "run-failed",
      "run-completed",
    ]);
    expect(messages.every((message) => message.kind === "issue")).toBe(true);
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
    expect(messages[0]).toMatchObject({
      agentName: "Inbox Agent",
      version: "session:v1:completed:2026-07-24T01:10:00.000Z",
    });
  });

  it("creates actionable inbox messages for mentions and thread replies", () => {
    const messages = buildCurrentInboxMessages(
      {
        ...demoDashboard,
        runs: [
          {
            ...demoDashboard.runs[0],
            id: "run-thread",
            runNumber: 1321,
            status: "running",
          },
        ],
        conversationNotifications: [
          {
            id: "message-mention",
            runId: "run-mention",
            runTitle: "Review login behavior",
            rootMessageId: "message-mention",
            body: "@owner could you confirm this?",
            author: {
              id: "member",
              name: "Member",
              image: null,
              provider: null,
            },
            reason: "mention",
            createdAt: "2026-07-30T01:00:00.000Z",
          },
          {
            id: "message-reply",
            runId: "run-thread",
            runTitle: "Fix checkout",
            rootMessageId: "message-root",
            body: "I added the reproduction steps.",
            author: {
              id: "member",
              name: "Member",
              image: null,
              provider: null,
            },
            reason: "thread_reply",
            createdAt: "2026-07-30T01:01:00.000Z",
          },
        ],
      },
      [],
      [project],
    );
    const conversationMessages = messages.filter(
      (message) => message.kind === "conversation",
    );

    expect(conversationMessages).toEqual([
      expect.objectContaining({
        id: "conversation:message-mention",
        targetId: "run-mention",
        reason: "mention",
      }),
      expect.objectContaining({
        id: "conversation:message-reply",
        targetId: "run-thread",
        messageId: "message-reply",
        rootMessageId: "message-root",
        issueKey: `${demoDashboard.project.issueKeyPrefix ?? "AH"}-1321`,
        reason: "thread_reply",
      }),
    ]);
    expect(conversationMessages.map(classifyInboxMessage)).toEqual([
      "action_required",
      "action_required",
    ]);
  });

  it("creates actionable channel items with navigation context", () => {
    const [message] = buildCurrentInboxMessages(
      {
        ...demoDashboard,
        runs: [],
        channelNotifications: [{
          id: "channel-reply",
          channelId: "channel-product",
          channelName: "product",
          rootMessageId: "channel-root",
          body: "I answered your question.",
          author: {
            id: "member",
            name: "Member",
            image: null,
            provider: null,
          },
          reason: "thread_reply",
          createdAt: "2026-07-30T02:00:00.000Z",
        }],
      },
      [],
      [project],
    );

    expect(message).toMatchObject({
      id: "channel:channel-reply",
      kind: "channel",
      channelId: "channel-product",
      channelName: "product",
      messageId: "channel-reply",
      rootMessageId: "channel-root",
      reason: "thread_reply",
    });
    expect(classifyInboxMessage(message)).toBe("action_required");
  });

  it("includes only subscribed issue updates and treats regular messages as activity", () => {
    // Use an equivalent offset form so filtering compares instants rather
    // than relying on lexicographic timestamp formatting.
    const subscribedAt = "2026-07-30T09:30:00.000+09:00";
    const subscribedRun = {
      ...demoDashboard.runs[0]!,
      id: "run-subscribed",
      status: "completed" as const,
      lastEventAt: "2026-07-30T01:00:00.000Z",
      subscribers: [{ userId: "owner", subscribedAt }],
    };
    const otherRun = {
      ...subscribedRun,
      id: "run-other",
      subscribers: [{ userId: "member", subscribedAt }],
    };
    const messages = buildCurrentInboxMessages(
      {
        ...demoDashboard,
        runs: [subscribedRun, otherRun],
        conversationNotifications: [{
          id: "message-subscription",
          runId: subscribedRun.id,
          runTitle: subscribedRun.title,
          rootMessageId: "message-subscription",
          body: "A normal subscriber update",
          author: {
            id: "member",
            name: "Member",
            image: null,
            provider: null,
          },
          reason: "subscription",
          createdAt: "2026-07-30T01:01:00.000Z",
        }],
      },
      [],
      [project],
      "owner",
    );

    expect(messages.map((message) => message.targetId)).toEqual([
      subscribedRun.id,
      subscribedRun.id,
    ]);
    const conversation = messages.find(
      (message) => message.kind === "conversation",
    );
    expect(conversation && classifyInboxMessage(conversation)).toBe("activity");
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

  it("keeps only messages from the selected organization", () => {
    const otherProject = {
      ...project,
      id: "project-other",
      name: "Other project",
      organizationId: "organization-other",
    };
    const messages = buildCurrentInboxMessages(
      null,
      [
        session("completed", "selected-session"),
        {
          ...session("failed", "other-session"),
          projectId: otherProject.id,
        },
      ],
      [project, otherProject],
    );

    expect(
      filterInboxMessagesByOrganization(
        messages,
        [project, otherProject],
        project.organizationId ?? null,
      ).map((message) => message.id),
    ).toEqual(["session:selected-session"]);
    expect(
      filterInboxMessagesByOrganization(
        messages,
        [project, otherProject],
        otherProject.organizationId,
      ).map((message) => message.id),
    ).toEqual(["session:other-session"]);
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

  it("merges account-synced read versions with local-only entries", () => {
    expect(
      mergeInboxReadVersions(
        { "issue:a": "local", "issue:b": "local-only" },
        { "issue:a": "remote", "issue:c": "remote-only" },
      ),
    ).toEqual({
      "issue:a": "remote",
      "issue:b": "local-only",
      "issue:c": "remote-only",
    });

    expect(
      inboxReadVersionsToPush(
        {
          "issue:a": "local",
          "issue:b": "local-only",
          "issue:c": "same",
        },
        {
          "issue:a": "remote",
          "issue:c": "same",
        },
      ),
    ).toEqual({
      "issue:a": "local",
      "issue:b": "local-only",
    });
  });

  it("classifies urgent, actionable, important, and routine updates", () => {
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

    expect(messages.map(classifyInboxMessage)).toEqual([
      "urgent",
      "action_required",
      "important",
      "activity",
    ]);
  });
});
