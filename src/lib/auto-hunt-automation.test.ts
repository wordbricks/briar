import { describe, expect, it } from "vitest";
import {
  automaticTriggersFor,
  defaultAutoHuntAutomation,
  normalizeAutoHuntAutomation,
  selectAutoHuntCandidates,
} from "./auto-hunt-automation";

const queued = (
  runNumber: number,
  priority: number | null,
  startedAt = `2026-07-24T0${runNumber}:00:00.000Z`,
) => ({
  id: `run-${runNumber}`,
  runNumber,
  status: "queued",
  priority,
  sourceCreatedAt: null,
  startedAt,
});

describe("Auto Hunt automation", () => {
  it("normalizes defaults and enforces the configurable safety bounds", () => {
    expect(normalizeAutoHuntAutomation(null)).toEqual(defaultAutoHuntAutomation);
    expect(normalizeAutoHuntAutomation({
      enabled: true,
      maxIssuesPerSession: 99,
      schedule: { enabled: true, intervalHours: 0 },
      queueThreshold: { enabled: true, minimumIssues: 101 },
      urgentIssue: { enabled: true },
    })).toMatchObject({
      enabled: true,
      maxIssuesPerSession: 10,
      schedule: { enabled: true, intervalHours: 1 },
      queueThreshold: { enabled: true, minimumIssues: 100 },
      urgentIssue: { enabled: true },
    });
  });

  it("treats enabled conditions as OR rules", () => {
    const automation = normalizeAutoHuntAutomation({
      enabled: true,
      maxIssuesPerSession: 3,
      schedule: { enabled: true, intervalHours: 3 },
      queueThreshold: { enabled: true, minimumIssues: 2 },
      urgentIssue: { enabled: true },
    });
    expect(automaticTriggersFor(
      automation,
      [queued(1, 1), queued(2, 3)],
      Date.parse("2026-07-24T12:00:00.000Z"),
      "2026-07-24T08:00:00.000Z",
    )).toEqual(["schedule", "queue_threshold", "urgent_issue"]);
  });

  it("honors the cooldown and prioritizes urgent queued issues", () => {
    const automation = normalizeAutoHuntAutomation({
      ...defaultAutoHuntAutomation,
      enabled: true,
      urgentIssue: { enabled: true },
    });
    expect(automaticTriggersFor(
      automation,
      [queued(1, 1)],
      Date.parse("2026-07-24T12:03:00.000Z"),
      "2026-07-24T12:00:00.000Z",
    )).toEqual([]);
    expect(selectAutoHuntCandidates(
      [queued(1, 3), queued(2, 1), queued(3, 2), queued(4, null)],
      2,
    ).map((run) => run.id)).toEqual(["run-2", "run-3"]);
  });
});
