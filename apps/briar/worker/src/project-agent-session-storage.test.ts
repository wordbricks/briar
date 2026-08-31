import { describe, expect, it } from "vitest";
import {
  decodeStoredProjectAgentSessionPayload,
  decodeStoredProjectAgentSessionSummary,
  encodeStoredProjectAgentSessionPayload,
  encodeStoredProjectAgentSessionSummary,
  storedProjectAgentSessionPayloadMaxBytes,
  storedProjectAgentSessionSummaryMaxBytes,
  type StoredProjectAgentSessionPayload,
} from "./project-request-contract";

const observedAt = "2026-08-31T00:00:00.000Z";
const sessionId = "11111111-1111-4111-8111-111111111111";

const payload = (overrides: Partial<StoredProjectAgentSessionPayload> = {}) => ({
  dispatchGroupId: sessionId,
  agentId: null,
  agentName: null,
  skillId: null,
  sessionType: "task" as const,
  trigger: "manual" as const,
  scheduleId: null,
  scheduleRunId: null,
  parentSessionId: null,
  request: "Review storage boundaries",
  followUps: [],
  status: "completed" as const,
  issues: [],
  startedAt: observedAt,
  completedAt: observedAt,
  conversationId: null,
  summary: "Stored safely",
  error: null,
  requestedWorkerId: null,
  workerId: null,
  events: [{ id: "completed-event", type: "completed" as const, occurredAt: observedAt }],
  updatedAt: observedAt,
  requestedByUserId: "requester",
  ...overrides,
});

describe("stored project Agent session codecs", () => {
  it("round-trips canonical documents and rejects excess or oversized storage", () => {
    const encoded = encodeStoredProjectAgentSessionPayload(payload());
    expect(decodeStoredProjectAgentSessionPayload(encoded)).toMatchObject({
      dispatchGroupId: sessionId,
      requestedByUserId: "requester",
      summary: "Stored safely",
    });

    expect(() => decodeStoredProjectAgentSessionPayload(JSON.stringify({
      ...JSON.parse(encoded),
      futureField: true,
    }))).toThrow();

    expect(() => encodeStoredProjectAgentSessionPayload(payload({
      followUps: Array.from({ length: 22 }, (_, index) => ({
        id: `follow-up-${index}`,
        message: "x".repeat(50_000),
        sentAt: observedAt,
      })),
    }))).toThrow(
      `${storedProjectAgentSessionPayloadMaxBytes} bytes`,
    );

    const summary = encodeStoredProjectAgentSessionSummary({
      dispatchGroupId: sessionId,
      agentId: null,
      agentName: null,
      skillId: null,
      sessionType: "task",
      trigger: "manual",
      scheduleId: null,
      scheduleRunId: null,
      parentSessionId: null,
      requestedByUserId: "requester",
      request: "Review storage boundaries",
      status: "completed",
      issues: [],
      startedAt: observedAt,
      completedAt: observedAt,
      summary: "Stored safely",
      error: null,
      requestedWorkerId: null,
      workerId: null,
      updatedAt: observedAt,
    });
    expect(() => decodeStoredProjectAgentSessionSummary(
      `${summary}${" ".repeat(storedProjectAgentSessionSummaryMaxBytes)}`,
    )).toThrow(`${storedProjectAgentSessionSummaryMaxBytes} bytes`);
  });
});
