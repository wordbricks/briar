import { beforeEach, describe, expect, it } from "vitest";

import { demoDashboard } from "../../lib/demo-data";
import type { DashboardPayload, HuntRun, Project, SessionUser } from "../../types";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { userAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import {
  myIssuesCountAtom,
  myIssuesFilteredRunIdsAtom,
  myIssuesGroupedRunIdsAtom,
  myIssuesMembersAtom,
  myIssuesQueryAtom,
  myIssuesRunProjectAtom,
  myIssuesScopeAtom,
  myIssuesScopedRunIdsAtom,
  myIssuesSelectedProjectIdsAtom,
  myIssuesStatusAtom,
  myIssuesTeamIdsAtom,
  resetMyIssuesViewState,
} from "./atoms";

/*
  What the page publishes, over the store rather than over a record of payloads.

  The two rules worth pinning are the ones the record could not express: the ids
  keep their array identity when an edit changes nothing the list narrows by,
  which is what stops a realtime tick from waking the list, and a run's project
  comes from the stored per-team index rather than from `HuntRun.teamId`, which
  is optional on the wire.
*/

const user: SessionUser = {
  id: "user-1",
  name: "Tester",
  email: "tester@briar.local",
};

const teamA: Project = {
  ...demoDashboard.team,
  id: "team-a",
  name: "Team A",
  issueKeyPrefix: "AAA",
};
const teamB: Project = {
  ...demoDashboard.team,
  id: "team-b",
  name: "Team B",
  issueKeyPrefix: "BBB",
};

const runOf = (overrides: Partial<HuntRun> & { id: string }): HuntRun => ({
  ...demoDashboard.runs[0]!,
  teamId: undefined,
  createdByUserId: null,
  assigneeUserId: null,
  priority: null,
  status: "queued",
  updatedAt: "2026-09-01T00:00:00.000Z",
  ...overrides,
});

const payload = (team: Project, runs: HuntRun[]): DashboardPayload => ({
  ...demoDashboard,
  team,
  runs,
  members: [
    {
      userId: "user-1",
      name: "Tester",
      email: "tester@briar.local",
      image: null,
      role: "owner",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
  cursor: 1,
  generatedAt: "2026-09-01T00:00:00.000Z",
});

const mine = runOf({
  id: "run-mine",
  title: "Mine",
  createdByUserId: "user-1",
  updatedAt: "2026-09-01T00:02:00.000Z",
});
const assigned = runOf({
  id: "run-assigned",
  title: "Assigned",
  assigneeUserId: "user-1",
  status: "blocked",
  updatedAt: "2026-09-01T00:01:00.000Z",
});
const theirs = runOf({ id: "run-theirs", title: "Theirs" });

describe("state/my-issues atoms", () => {
  let registry: AtomRegistry;

  beforeEach(() => {
    registry = createTestRegistry([[userAtom, user]]);
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamA.id,
      payload: payload(teamA, [mine, theirs]),
    });
    applySyncEvent(registry, {
      kind: "team-snapshot",
      teamId: teamB.id,
      payload: payload(teamB, [assigned]),
    });
    registry.set(myIssuesTeamIdsAtom, [teamA.id, teamB.id]);
  });

  it("lists only the account's runs, newest updated first", () => {
    expect(registry.get(myIssuesScopedRunIdsAtom)).toEqual([
      "run-mine",
      "run-assigned",
    ]);
  });

  it("resolves a run's project from the stored team index, not from the run", () => {
    // `HuntRun.teamId` is undefined on both runs above.
    expect(registry.get(myIssuesRunProjectAtom("run-assigned"))?.id).toBe(
      teamB.id,
    );
    expect(registry.get(myIssuesRunProjectAtom("run-mine"))?.name).toBe("Team A");
  });

  it("keeps the id array identity when an edit changes nothing it narrows by", () => {
    const before = registry.get(myIssuesFilteredRunIdsAtom);
    const groupsBefore = registry.get(myIssuesGroupedRunIdsAtom);

    applySyncEvent(registry, {
      kind: "run-changed",
      run: { ...mine, detail: "a new detail" },
      teamId: teamA.id,
    });

    expect(registry.get(myIssuesFilteredRunIdsAtom)).toBe(before);
    expect(registry.get(myIssuesGroupedRunIdsAtom)).toBe(groupsBefore);
  });

  it("groups by urgency and drops the empty sections", () => {
    expect(registry.get(myIssuesGroupedRunIdsAtom)).toEqual([
      { group: "urgent", runIds: ["run-assigned"] },
      { group: "triage", runIds: ["run-mine"] },
    ]);
  });

  it("narrows by the scope tab, the project selection and the search box", () => {
    registry.set(myIssuesScopeAtom, "created");
    expect(registry.get(myIssuesScopedRunIdsAtom)).toEqual(["run-mine"]);

    registry.set(myIssuesScopeAtom, "assigned");
    registry.set(myIssuesSelectedProjectIdsAtom, [teamB.id]);
    expect(registry.get(myIssuesScopedRunIdsAtom)).toEqual(["run-assigned"]);

    registry.set(myIssuesSelectedProjectIdsAtom, []);
    registry.set(myIssuesQueryAtom, "BBB-");
    // The project's issue key is part of this page's search text.
    expect(registry.get(myIssuesFilteredRunIdsAtom)).toEqual(["run-assigned"]);
    expect(registry.get(myIssuesCountAtom)).toBe(1);

    registry.set(myIssuesQueryAtom, "");
    registry.set(myIssuesStatusAtom, "attention");
    expect(registry.get(myIssuesFilteredRunIdsAtom)).toEqual(["run-assigned"]);
  });

  it("collects the members of every visible project once", () => {
    expect(registry.get(myIssuesMembersAtom).map((member) => member.userId)).toEqual([
      "user-1",
    ]);
  });

  it("puts the view state back to its defaults", () => {
    registry.set(myIssuesQueryAtom, "anything");
    registry.set(myIssuesScopeAtom, "subscribed");
    registry.set(myIssuesSelectedProjectIdsAtom, [teamA.id]);

    resetMyIssuesViewState(registry);

    expect(registry.get(myIssuesQueryAtom)).toBe("");
    expect(registry.get(myIssuesScopeAtom)).toBe("assigned");
    expect(registry.get(myIssuesSelectedProjectIdsAtom)).toEqual([]);
  });
});
