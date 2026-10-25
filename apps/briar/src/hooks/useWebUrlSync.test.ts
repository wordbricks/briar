import { describe, expect, it } from "vitest";

import { issueNavigationLocation } from "../lib/app-navigation";
import type { HuntRun, Team } from "../types";
import {
  urlPathForLocation,
  webUrlTargetFromPathname,
} from "./useWebUrlSync";

const team = {
  id: "team-1",
  issueKeyPrefix: "BR",
} as Team;

const run = {
  id: "run-1",
  teamId: "team-1",
  runNumber: 7456,
} as HuntRun;

const runsById = new Map([[run.id, run]]);

describe("useWebUrlSync url mapping", () => {
  it("maps an issue card to its card-number path", () => {
    expect(
      urlPathForLocation(
        issueNavigationLocation("team-1", "run-1"),
        runsById,
        [team],
      ),
    ).toBe("/app/issues/BR-7456");
  });

  it("leaves the url alone while the card is not in the store", () => {
    expect(
      urlPathForLocation(issueNavigationLocation("team-1", "run-1"), new Map(), [
        team,
      ]),
    ).toBeNull();
  });

  it("maps every other page to /app/<page>", () => {
    expect(urlPathForLocation("issues", runsById, [team])).toBe("/app/issues");
    expect(urlPathForLocation("dms", runsById, [team])).toBe("/app/dms");
    expect(urlPathForLocation("inbox", runsById, [team])).toBe("/app/inbox");
  });

  it("round-trips a card-number url back to a link target", () => {
    expect(webUrlTargetFromPathname("/app/issues/BR-7456")).toEqual({
      kind: "issueKey",
      issueKey: "BR-7456",
    });
    expect(webUrlTargetFromPathname("/app/issues")).toEqual({
      kind: "page",
      page: "issues",
    });
    expect(webUrlTargetFromPathname("/app")).toBeNull();
  });
});
