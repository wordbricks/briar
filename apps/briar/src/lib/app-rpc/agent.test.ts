import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  ProjectAgentSessionEventType,
  ProjectAgentSessionIssueOutcome,
  ProjectAgentSessionSchema,
  ProjectAgentSessionStatus,
  ProjectAgentSessionTrigger,
  ProjectAgentSessionType,
} from "@briar/contracts/gen/briar/app/v1/agent_pb";
import { describe, expect, it } from "vitest";
import { projectAgentSessionFromMessage } from "./agent";

const timestamp = timestampFromDate(new Date("2026-08-30T12:00:00.000Z"));

const sessionMessage = () => create(ProjectAgentSessionSchema, {
  id: "session-1",
  projectId: "11111111-1111-4111-8111-111111111111",
  dispatchGroupId: "dispatch-1",
  agentId: "22222222-2222-4222-8222-222222222222",
  sessionType: ProjectAgentSessionType.TASK,
  trigger: ProjectAgentSessionTrigger.MANUAL,
  status: ProjectAgentSessionStatus.RUNNING,
  followUps: [{ id: "follow-up-1", message: "Continue", sentAt: timestamp }],
  issues: [{
    runId: "run-1",
    runNumber: 7,
    sourceKey: "BRI-7",
    title: "Finish migration",
    outcome: ProjectAgentSessionIssueOutcome.PENDING,
  }],
  startedAt: timestamp,
  events: [{
    id: "event-1",
    type: ProjectAgentSessionEventType.STARTED,
    occurredAt: timestamp,
  }],
  updatedAt: timestamp,
});

describe("Agent Connect DTO mapping", () => {
  it("restores domain and client-local session fields explicitly", () => {
    const session = projectAgentSessionFromMessage(sessionMessage(), false);

    expect(session).toMatchObject({
      id: "session-1",
      dispatchGroupId: "dispatch-1",
      sessionType: "task",
      trigger: "manual",
      status: "running",
      completedAt: null,
      workspaceRoot: null,
      localOwner: false,
      archived: false,
      detailLoaded: false,
      dispatchEvents: [],
      workers: [],
    });
    expect(session.followUps).toEqual([{
      id: "follow-up-1",
      message: "Continue",
      sentAt: "2026-08-30T12:00:00.000Z",
    }]);
    expect(session.events).toEqual([{
      id: "event-1",
      type: "started",
      occurredAt: "2026-08-30T12:00:00.000Z",
    }]);
  });

  it("fails closed when the server omits the required session type", () => {
    const message = sessionMessage();
    message.sessionType = ProjectAgentSessionType.UNSPECIFIED;

    expect(() => projectAgentSessionFromMessage(message, true)).toThrow(
      "Unknown Agent session type",
    );
  });
});
