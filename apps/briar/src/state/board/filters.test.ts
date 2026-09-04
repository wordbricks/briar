import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { HuntRun } from "../../types";
import {
  emptyIssuePropertyFilters,
  filterRunIds,
  runMatchesBoardFilters,
  runMatchesIssuePropertyFilters,
  runSearchText,
  sortRunIdsByUpdatedDesc,
  statusFilterMatches,
  type BoardFilterCriteria,
  type IssuePropertyFilters,
} from "./filters";

/*
  The board's filtering, checked against the cases its own test file pinned when
  the same rules ran inside the component.
*/

const template = demoDashboard.runs[0]!;

const runOf = (run: Partial<HuntRun> & { id: string }): HuntRun => ({
  ...template,
  runNumber: 1,
  ...run,
});

const criteriaOf = (
  overrides: Partial<BoardFilterCriteria> = {},
): BoardFilterCriteria => ({
  query: "",
  source: "all",
  status: "all",
  propertyFilters: emptyIssuePropertyFilters(),
  ...overrides,
});

const store = (runs: readonly HuntRun[]) =>
  new Map(runs.map((run) => [run.id, run]));

describe("board filters", () => {
  it("puts a run in the status tabs it belongs to", () => {
    const running = runOf({ id: "a", status: "running" });
    const paused = runOf({ id: "b", status: "paused" });
    const completed = runOf({ id: "c", status: "completed" });

    expect(statusFilterMatches(running, "all")).toBe(true);
    expect(statusFilterMatches(running, "active")).toBe(true);
    expect(statusFilterMatches(running, "attention")).toBe(false);
    expect(statusFilterMatches(paused, "active")).toBe(true);
    expect(statusFilterMatches(paused, "attention")).toBe(true);
    expect(statusFilterMatches(completed, "active")).toBe(false);
    expect(statusFilterMatches(completed, "completed")).toBe(true);
  });

  it("combines property filters while allowing multiple values per property", () => {
    const runningIssue = runOf({
      id: "a",
      agentId: "agent-1",
      assigneeUserId: "member-1",
      createdByUserId: "creator-1",
      priority: 1,
      source: "issue",
      status: "running",
    });
    const unassignedFeedback = runOf({
      id: "b",
      agentId: null,
      assigneeUserId: null,
      createdByUserId: "creator-1",
      priority: null,
      source: "feedback",
      status: "paused",
    });
    const filters: IssuePropertyFilters = {
      status: ["running", "paused"],
      source: ["issue", "feedback"],
      priority: ["1"],
      assignee: ["member-1"],
      agent: ["agent-1"],
      creator: ["creator-1"],
    };

    expect(runMatchesIssuePropertyFilters(runningIssue, filters)).toBe(true);
    expect(runMatchesIssuePropertyFilters(unassignedFeedback, filters)).toBe(
      false,
    );
    expect(
      runMatchesIssuePropertyFilters(unassignedFeedback, {
        status: ["paused"],
        source: [],
        priority: ["__unset__"],
        assignee: ["__unset__"],
        agent: ["__unset__"],
        creator: [],
      }),
    ).toBe(true);
  });

  it("searches the fields the board joined, skipping the empty ones", () => {
    const run = runOf({
      id: "a",
      title: "Add the schema",
      detail: "",
      issueDescription: "the description",
      sourceKey: "ISSUE-9",
      repository: "wordbricks/briar",
      runNumber: 12,
    });

    expect(runSearchText(run, "BRI")).toBe(
      "Add the schema the description ISSUE-9 wordbricks/briar BRI-12",
    );
    expect(
      runMatchesBoardFilters(run, criteriaOf({ query: " bri-12 ", issueKeyPrefix: "BRI" })),
    ).toBe(true);
    expect(runMatchesBoardFilters(run, criteriaOf({ query: "WORDBRICKS" }))).toBe(
      true,
    );
    expect(runMatchesBoardFilters(run, criteriaOf({ query: "nothing" }))).toBe(
      false,
    );
  });

  it("drops runs the source tab excludes", () => {
    const issue = runOf({ id: "a", source: "issue" });
    const feedback = runOf({ id: "b", source: "feedback" });

    expect(runMatchesBoardFilters(issue, criteriaOf({ source: "issue" }))).toBe(
      true,
    );
    expect(
      runMatchesBoardFilters(feedback, criteriaOf({ source: "issue" })),
    ).toBe(false);
  });

  it("keeps the store's order and drops ids it does not hold", () => {
    const first = runOf({ id: "a", status: "running", title: "first" });
    const second = runOf({ id: "b", status: "completed", title: "second" });

    expect(
      filterRunIds(store([first, second]), ["b", "a", "gone"], criteriaOf()),
    ).toEqual(["b", "a"]);
    expect(
      filterRunIds(
        store([first, second]),
        ["a", "b"],
        criteriaOf({ status: "active" }),
      ),
    ).toEqual(["a"]);
  });

  it("sorts the companion stream newest updated first", () => {
    const older = runOf({ id: "a", updatedAt: "2026-09-01T00:00:00.000Z" });
    const newer = runOf({ id: "b", updatedAt: "2026-09-02T00:00:00.000Z" });

    expect(sortRunIdsByUpdatedDesc(store([older, newer]), ["a", "b"])).toEqual([
      "b",
      "a",
    ]);
  });
});
