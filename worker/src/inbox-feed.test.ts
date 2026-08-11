import { describe, expect, it } from "vitest";
import {
  buildInboxFeedMessages,
  type InboxFeedProjectData,
} from "./inbox-feed";
import { mobileInboxFeedResponseSchema } from "./mobile-contract";

const occurredAt = "2026-08-11T13:00:00.000Z";

function projectData(
  id: string,
  name: string,
  runId: string,
  status: "completed" | "blocked",
): InboxFeedProjectData {
  return {
    project: { id, name, issue_key_prefix: "BR" },
    runs: [{
      id: runId,
      run_number: 1,
      title: `${name} issue`,
      status,
      paused_at: null,
      workflow_stage: null,
      workflow_snapshot_json: "{}",
      priority: status === "blocked" ? 1 : 2,
      structured_result_json: null,
      current_attempt: 1,
      current_revision: 1,
      last_event_at: occurredAt,
      event_count: 2,
    }],
    conversationNotifications: [],
    sessionSummaries: [],
  };
}

describe("organization Inbox feed", () => {
  it("includes messages from every project without an active-project input", () => {
    const first = projectData(
      "11111111-1111-4111-8111-111111111111",
      "First project",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "completed",
    );
    const second = projectData(
      "22222222-2222-4222-8222-222222222222",
      "Second project",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "blocked",
    );
    second.sessionSummaries = [{
      session_id: "second-project-session",
      summary_json: JSON.stringify({
        agentName: "Second Agent",
        status: "failed",
        issues: [{ title: "Second project issue", outcome: "failed" }],
        startedAt: occurredAt,
        completedAt: "2026-08-11T13:01:00.000Z",
        inboxVersion: "second-project-failed-event",
      }),
      updated_at: "2026-08-11T13:01:00.000Z",
    }];

    const messages = buildInboxFeedMessages([first, second], []);

    expect(() => mobileInboxFeedResponseSchema.parse({
      messages,
      generatedAt: "2026-08-11T13:02:00.000Z",
    })).not.toThrow();

    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        projectName: "First project",
      }),
      expect.objectContaining({
        id: "issue:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        projectName: "Second project",
        status: "blocked",
      }),
      expect.objectContaining({
        id: "session:second-project-session",
        projectName: "Second project",
        requiresAttention: true,
        version: "session:v1:failed:2026-08-11T13:01:00.000Z",
      }),
    ]));
  });

  it("associates organization channel notifications with a stable project", () => {
    const first = projectData(
      "11111111-1111-4111-8111-111111111111",
      "First project",
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "completed",
    );

    const messages = buildInboxFeedMessages([first], [{
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      channel_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      channel_name: "product",
      root_message_id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      body: "Please review this.",
      author_name: "Taylor",
      notification_reason: "mention",
      created_at: occurredAt,
    }]);

    expect(() => mobileInboxFeedResponseSchema.parse({
      messages,
      generatedAt: "2026-08-11T13:02:00.000Z",
    })).not.toThrow();

    expect(messages).toContainEqual(expect.objectContaining({
      id: "channel:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      projectId: first.project.id,
      targetId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    }));
  });

  it("keeps an unselected project's reply routed to that project", () => {
    const second = projectData(
      "22222222-2222-4222-8222-222222222222",
      "Second project",
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "blocked",
    );
    second.conversationNotifications = [{
      id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      run_id: second.runs[0]!.id,
      run_title: second.runs[0]!.title,
      root_message_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      body: "Please review the second project.",
      author_name: "Taylor",
      notification_reason: "thread_reply",
      created_at: occurredAt,
    }];

    const messages = buildInboxFeedMessages([second], []);

    expect(() => mobileInboxFeedResponseSchema.parse({
      messages,
      generatedAt: "2026-08-11T13:02:00.000Z",
    })).not.toThrow();

    expect(messages).toContainEqual(expect.objectContaining({
      id: "conversation:cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      projectId: second.project.id,
      issueKey: "BR-1",
      reason: "thread_reply",
    }));
  });
});
