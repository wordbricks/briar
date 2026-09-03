import { describe, expect, it } from "vitest";

import type { HuntEvent, IssueMessage, RunEvidence } from "../../types";
import { createTestRegistry } from "../registry";
import {
  clearRunDetail,
  issueMessagesAtom,
  retainedRunDetailIdsAtom,
  runEventsAtom,
  runEvidenceAtom,
  touchRunDetail,
  RUN_DETAIL_RETENTION_LIMIT,
} from "./atoms";

const messageOf = (id: string, runId: string): IssueMessage => ({
  id,
  runId,
  parentMessageId: null,
  body: id,
  attachments: [],
  author: { id: "user-1", name: "Tester", image: null, provider: null },
  replyCount: 0,
  proposedAction: null,
  executionProposal: null,
  skillExecutionProposal: null,
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

const eventOf = (id: string): HuntEvent => ({
  id,
  attempt: 1,
  revision: 1,
  status: "queued",
  workflowStage: null,
  detail: id,
  actor: "briar-app",
  qaStatus: null,
  trackerState: null,
  pullRequestUrls: [],
  targetSha: null,
  occurredAt: "2026-09-01T00:00:00.000Z",
  recordedAt: "2026-09-01T00:00:00.000Z",
});

const evidenceOf = (key: string): RunEvidence =>
  ({
    key,
    attempt: 1,
    revision: 1,
    stage: "analyzing",
    kind: "text",
    summary: key,
    body: key,
    images: [],
    recordedAt: "2026-09-01T00:00:00.000Z",
  }) as unknown as RunEvidence;

describe("run detail families", () => {
  it("keeps one run's detail out of another run's subscribers", () => {
    const registry = createTestRegistry();
    let notifications = 0;
    const unsubscribe = registry.subscribe(issueMessagesAtom("run-a"), () => {
      notifications += 1;
    });
    registry.set(issueMessagesAtom("run-b"), [messageOf("m-1", "run-b")]);
    expect(notifications).toBe(0);
    registry.set(issueMessagesAtom("run-a"), [messageOf("m-2", "run-a")]);
    expect(notifications).toBe(1);
    unsubscribe();
  });

  it("does not notify when a write holds the same elements", () => {
    const registry = createTestRegistry();
    const messages = [messageOf("m-1", "run-a")];
    registry.set(issueMessagesAtom("run-a"), messages);
    let notifications = 0;
    const unsubscribe = registry.subscribe(issueMessagesAtom("run-a"), () => {
      notifications += 1;
    });
    registry.set(issueMessagesAtom("run-a"), [...messages]);
    expect(notifications).toBe(0);
    unsubscribe();
  });

  it("clears every collection of one run", () => {
    const registry = createTestRegistry();
    registry.set(issueMessagesAtom("run-a"), [messageOf("m-1", "run-a")]);
    registry.set(runEventsAtom("run-a"), [eventOf("e-1")]);
    registry.set(runEvidenceAtom("run-a"), [evidenceOf("k-1")]);
    touchRunDetail(registry, "run-a");

    clearRunDetail(registry, "run-a");

    expect(registry.get(issueMessagesAtom("run-a"))).toEqual([]);
    expect(registry.get(runEventsAtom("run-a"))).toEqual([]);
    expect(registry.get(runEvidenceAtom("run-a"))).toEqual([]);
    expect(registry.get(retainedRunDetailIdsAtom)).toEqual([]);
  });
});

describe("touchRunDetail", () => {
  it("moves a run to the most recent end without churning the atom", () => {
    const registry = createTestRegistry();
    touchRunDetail(registry, "run-a");
    touchRunDetail(registry, "run-b");
    const retained = registry.get(retainedRunDetailIdsAtom);
    expect(retained).toEqual(["run-a", "run-b"]);
    touchRunDetail(registry, "run-b");
    expect(registry.get(retainedRunDetailIdsAtom)).toBe(retained);
    touchRunDetail(registry, "run-a");
    expect(registry.get(retainedRunDetailIdsAtom)).toEqual(["run-b", "run-a"]);
  });

  it("drops the least recently read run past the retention limit", () => {
    const registry = createTestRegistry();
    for (let index = 0; index < RUN_DETAIL_RETENTION_LIMIT; index += 1) {
      const runId = `run-${index}`;
      registry.set(issueMessagesAtom(runId), [messageOf(`m-${index}`, runId)]);
      touchRunDetail(registry, runId);
    }
    expect(registry.get(issueMessagesAtom("run-0"))).toHaveLength(1);

    registry.set(issueMessagesAtom("run-last"), [
      messageOf("m-last", "run-last"),
    ]);
    touchRunDetail(registry, "run-last");

    expect(registry.get(retainedRunDetailIdsAtom)).toHaveLength(
      RUN_DETAIL_RETENTION_LIMIT,
    );
    expect(registry.get(retainedRunDetailIdsAtom)).not.toContain("run-0");
    expect(registry.get(issueMessagesAtom("run-0"))).toEqual([]);
    expect(registry.get(issueMessagesAtom("run-last"))).toHaveLength(1);
  });
});
