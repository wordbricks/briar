import { toJson } from "@bufbuild/protobuf";
import {
  InboxFeedMessageSchema,
} from "@briar/contracts/gen/briar/app/v1/inbox_pb";
import { DashboardWorkerSchema } from "@briar/contracts/gen/briar/app/v1/dashboard_pb";
import { describe, expect, it } from "vitest";
import type { InboxFeedMessage } from "./inbox-feed";
import {
  appDashboardWorker,
  appInboxFeedMessage,
} from "./app-connect-mappers";
import { workerRuntimeFixture } from "./test-helpers/worker-runtime";
import { workerJson } from "./worker-json";
import { workerRuntimeMetadataFromProto } from "./worker-runtime-mappers";

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

  it("projects generated Worker runtime capabilities without a parallel DTO", () => {
    const runtime = workerRuntimeMetadataFromProto(workerRuntimeFixture());
    const worker = appDashboardWorker(workerJson({
      id: "11111111-1111-4111-8111-111111111111",
      label: "Build Mac",
      runtime_proto_json: runtime.runtimeProtoJson,
      state: "online",
      last_heartbeat_at: "2026-08-30T12:34:56.789Z",
      created_at: "2026-08-29T12:34:56.789Z",
    }, "2026-08-30T12:35:00.000Z"));

    expect(toJson(DashboardWorkerSchema, worker)).toMatchObject({
      agentProvider: "AGENT_PROVIDER_CODEX",
      providers: ["AGENT_PROVIDER_CODEX"],
      versions: { briar: "1.2.173" },
      capabilities: {
        worktrees: true,
        remoteUpdates: { supported: true, protocol: 1 },
      },
    });
    expect(worker.capabilities?.providerCapabilities).toHaveLength(8);
  });
});
