import { describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { HuntRun } from "../../types";
import {
  emptyIssuePropertyFilters,
  filterRunIds,
  issueUpdatedBucketOf,
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
      updated: [],
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
        updated: [],
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

  it("buckets the last-updated time by whole elapsed days without overlap", () => {
    const now = Date.parse("2026-09-25T12:00:00.000Z");
    const hoursAgo = (hours: number) =>
      new Date(now - hours * 60 * 60 * 1000).toISOString();

    expect(issueUpdatedBucketOf(hoursAgo(0), now)).toBe("last24h");
    expect(issueUpdatedBucketOf(hoursAgo(23.99), now)).toBe("last24h");
    expect(issueUpdatedBucketOf(hoursAgo(24), now)).toBe("days1to7");
    expect(issueUpdatedBucketOf(hoursAgo(7 * 24 + 23), now)).toBe("days1to7");
    expect(issueUpdatedBucketOf(hoursAgo(8 * 24), now)).toBe("days8to30");
    expect(issueUpdatedBucketOf(hoursAgo(30 * 24 + 23), now)).toBe("days8to30");
    expect(issueUpdatedBucketOf(hoursAgo(31 * 24), now)).toBe("over30d");
    expect(issueUpdatedBucketOf(hoursAgo(-1), now)).toBe("last24h");
    expect(issueUpdatedBucketOf("not a date", now)).toBeNull();
    expect(issueUpdatedBucketOf(null, now)).toBeNull();
  });

  it("ORs selected update buckets and ANDs them with other properties", () => {
    const now = Date.parse("2026-09-25T12:00:00.000Z");
    const fresh = runOf({
      id: "fresh",
      status: "running",
      updatedAt: new Date(now - 2 * 60 * 60 * 1000).toISOString(),
    });
    const stale = runOf({
      id: "stale",
      status: "paused",
      updatedAt: new Date(now - 40 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const weekOld = runOf({
      id: "week",
      status: "running",
      updatedAt: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const filters = (overrides: Partial<IssuePropertyFilters>) => ({
      ...emptyIssuePropertyFilters(),
      ...overrides,
    });

    const recent = filters({ updated: ["last24h", "days1to7"] });
    expect(runMatchesIssuePropertyFilters(fresh, recent, now)).toBe(true);
    expect(runMatchesIssuePropertyFilters(weekOld, recent, now)).toBe(true);
    expect(runMatchesIssuePropertyFilters(stale, recent, now)).toBe(false);

    const runningAndOld = filters({ updated: ["over30d"], status: ["running"] });
    expect(runMatchesIssuePropertyFilters(stale, runningAndOld, now)).toBe(false);
    expect(
      runMatchesIssuePropertyFilters(
        stale,
        filters({ updated: ["over30d"], status: ["paused"] }),
        now,
      ),
    ).toBe(true);
    expect(runMatchesIssuePropertyFilters(stale, emptyIssuePropertyFilters(), now)).toBe(true);
  });
});
