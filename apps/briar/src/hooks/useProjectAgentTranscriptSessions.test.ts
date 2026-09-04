import { create } from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { ProjectAgentTranscriptSessionSummarySchema } from "@briar/contracts/gen/briar/app/v1/agent_transcript_pb";
import { AgentProvider } from "@briar/contracts/gen/briar/types/v1/provider_pb";
import { expect, it } from "vitest";

import { projectAgentTranscriptSession } from "./useProjectAgentTranscriptSessions";

const startedAt = new Date("2026-09-03T12:11:56.000Z");
const lastEventAt = new Date("2026-09-04T02:50:48.000Z");

it("maps a hot session with its worker and provider", () => {
  expect(projectAgentTranscriptSession(create(
    ProjectAgentTranscriptSessionSummarySchema,
    {
      sessionId: "detached-run-claim-2",
      workerId: "worker-1",
      agentProvider: AgentProvider.CODEX,
      startedAt: timestampFromDate(startedAt),
      lastEventAt: timestampFromDate(lastEventAt),
    },
  ))).toEqual({
    sessionId: "detached-run-claim-2",
    workerId: "worker-1",
    provider: "codex",
    startedAtMs: startedAt.getTime(),
    lastEventAtMs: lastEventAt.getTime(),
    archived: false,
  });
});

it("keeps an archived session selectable without a worker or provider", () => {
  expect(projectAgentTranscriptSession(create(
    ProjectAgentTranscriptSessionSummarySchema,
    {
      sessionId: "detached-run-claim-1",
      startedAt: timestampFromDate(startedAt),
      lastEventAt: timestampFromDate(lastEventAt),
      archived: true,
    },
  ))).toEqual({
    sessionId: "detached-run-claim-1",
    workerId: null,
    provider: null,
    startedAtMs: startedAt.getTime(),
    lastEventAtMs: lastEventAt.getTime(),
    archived: true,
  });
});
