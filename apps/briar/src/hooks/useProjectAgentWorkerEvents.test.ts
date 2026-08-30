import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  GetProjectAgentTranscriptResponseSchema,
  ProjectAgentTranscriptSessionSchema,
  ProjectAgentWorkLogEntrySchema,
  ProjectAgentWorkLogEntryStatus,
} from "@briar/contracts/gen/briar/app/v1/agent_transcript_pb";
import { AgentActivityKind } from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import {
  expect,
  it,
} from "vitest";

import { projectAgentTranscriptEvents } from "./useProjectAgentWorkerEvents";

it("maps the canonical work-log snapshot into replaceable UI events", () => {
  const startedAt = new Date("2026-08-31T00:00:00.000Z");
  const messageUpdatedAt = new Date("2026-08-31T00:00:01.000Z");
  const activityUpdatedAt = new Date("2026-08-31T00:00:02.000Z");
  const response = create(GetProjectAgentTranscriptResponseSchema, {
    session: create(ProjectAgentTranscriptSessionSchema, {
      sessionId: "session-1",
      runId: "run-1",
      workerId: "worker-1",
      agentProvider: AgentProvider.CODEX,
      startedAt: timestampFromDate(startedAt),
      lastEventAt: timestampFromDate(activityUpdatedAt),
    }),
    entries: [
      create(ProjectAgentWorkLogEntrySchema, {
        entryId: "message-1",
        sequence: 10n,
        updatedSequence: 12n,
        status: ProjectAgentWorkLogEntryStatus.WRITING,
        startedAt: timestampFromDate(startedAt),
        updatedAt: timestampFromDate(messageUpdatedAt),
        entry: {
          case: "message",
          value: { phase: "commentary", text: "Working" },
        },
      }),
      create(ProjectAgentWorkLogEntrySchema, {
        entryId: "activity-1",
        sequence: 20n,
        updatedSequence: 21n,
        status: ProjectAgentWorkLogEntryStatus.INTERRUPTED,
        startedAt: timestampFromDate(startedAt),
        updatedAt: timestampFromDate(activityUpdatedAt),
        completedAt: timestampFromDate(activityUpdatedAt),
        entry: {
          case: "activity",
          value: {
            kind: AgentActivityKind.COMMAND,
            title: "Run tests",
            text: "cancelled by handoff",
          },
        },
      }),
    ],
  });

  expect(projectAgentTranscriptEvents(response)).toEqual([
    {
      sessionId: "session-1",
      sequence: 10,
      occurredAtMs: messageUpdatedAt.getTime(),
      direction: "server",
      message: {
        type: "worklog",
        entryId: "message-1",
        status: ProjectAgentWorkLogEntryStatus.WRITING,
      },
      provider: "codex",
      event: {
        type: "messageStarted",
        id: "session-1:message-1",
        phase: "commentary",
        text: "Working",
      },
    },
    {
      sessionId: "session-1",
      sequence: 20,
      occurredAtMs: activityUpdatedAt.getTime(),
      direction: "server",
      message: {
        type: "worklog",
        entryId: "activity-1",
        status: ProjectAgentWorkLogEntryStatus.INTERRUPTED,
      },
      provider: "codex",
      event: {
        type: "activityCompleted",
        id: "session-1:activity-1",
        kind: "command",
        title: "Run tests",
        text: "cancelled by handoff",
        status: "cancelled",
      },
    },
  ]);
});
