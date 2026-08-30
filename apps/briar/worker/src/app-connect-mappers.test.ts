import { toJson } from "@bufbuild/protobuf";
import {
  InboxFeedMessageSchema,
} from "@briar/contracts/gen/briar/app/v1/inbox_pb";
import { describe, expect, it } from "vitest";
import type { InboxFeedMessage } from "./inbox-feed";
import { appInboxFeedMessage } from "./app-connect-mappers";

describe("app Connect message mapping", () => {
  it("preserves the Inbox oneof, enums, presence, and timestamp", () => {
    const message = {
      id: "issue:11111111-1111-4111-8111-111111111111",
      kind: "issue",
      projectId: "22222222-2222-4222-8222-222222222222",
      projectName: "Briar",
      targetId: "11111111-1111-4111-8111-111111111111",
      title: "Ship Connect",
      occurredAt: "2026-08-30T12:34:56.789Z",
      version: "1:2:blocked:review:2026-08-30T12:34:56.789Z:7",
      runNumber: 42,
      status: "blocked",
      workflowStage: "review",
      workflowStageLabel: null,
      priority: 1,
      structuredResult: {
        summary: "Waiting for review",
        outcome: "blocked",
        importance: "critical",
        urgency: "immediate",
        impact: "project",
        humanActionRequired: true,
        nextAction: "Approve the result",
        dueAt: null,
      },
    } as const satisfies InboxFeedMessage;

    expect(toJson(
      InboxFeedMessageSchema,
      appInboxFeedMessage(message),
    )).toEqual({
      identity: {
        id: message.id,
        projectId: message.projectId,
        projectName: message.projectName,
        targetId: message.targetId,
        title: message.title,
        occurredAt: "2026-08-30T12:34:56.789Z",
        version: message.version,
      },
      issue: {
        runNumber: 42,
        status: "RUN_STATUS_BLOCKED",
        workflowStage: "review",
        priority: 1,
        structuredResult: {
          summary: "Waiting for review",
          outcome: "OUTCOME_BLOCKED",
          importance: "IMPORTANCE_CRITICAL",
          urgency: "URGENCY_IMMEDIATE",
          impact: "IMPACT_PROJECT",
          humanActionRequired: true,
          nextAction: "Approve the result",
        },
      },
    });
  });
});
