import { describe, expect, it } from "vitest";
import { selectAutoHuntCandidates } from "./auto-hunt-automation";

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

describe("Auto Hunt queue selection", () => {
  it("prioritizes urgent queued issues", () => {
    expect(selectAutoHuntCandidates(
      [queued(1, 3), queued(2, 1), queued(3, 2), queued(4, null)],
      2,
    ).map((run) => run.id)).toEqual(["run-2", "run-3"]);
  });

  it("never treats backlog work as a candidate", () => {
    const backlog = {
      ...queued(0, 1),
      id: "run-backlog",
      status: "backlog",
    };

    expect(selectAutoHuntCandidates([backlog], 3)).toEqual([]);
  });

  it("waits until every prerequisite issue is completed", () => {
    const waiting = {
      ...queued(1, 1),
      prerequisites: [
        { status: "completed" },
        { status: "running" },
      ],
    };
    const ready = {
      ...queued(2, 2),
      prerequisites: [{ status: "completed" }],
    };

    expect(selectAutoHuntCandidates([waiting, ready], 3)).toEqual([ready]);
  });
});
