import { describe, expect, it } from "vitest";

import { touchRetainedTeam } from "./retention";

/*
  The LRU behind the entity maps, and the one screen that reaches past it.
*/

describe("touchRetainedTeam", () => {
  it("leaves the list alone when the team is already the most recent", () => {
    const current = ["a", "b"];
    expect(touchRetainedTeam(current, "b")).toEqual({
      retained: current,
      evicted: [],
    });
    expect(touchRetainedTeam(current, "b").retained).toBe(current);
  });

  it("moves the team to the end and evicts from the front past the limit", () => {
    expect(touchRetainedTeam(["a", "b", "c"], "d", { limit: 3 })).toEqual({
      retained: ["b", "c", "d"],
      evicted: ["a"],
    });
  });

  it("never evicts a pinned team, even when that keeps the list over the limit", () => {
    const { retained, evicted } = touchRetainedTeam(["a", "b", "c"], "d", {
      limit: 2,
      protectedIds: new Set(["a"]),
    });

    // "내 이슈" pins the organization's teams while it is open; the LRU drops
    // whatever else it can and leaves the pinned ones in place.
    expect(retained).toEqual(["a", "d"]);
    expect(evicted).toEqual(["b", "c"]);
  });

  it("never evicts the team being touched", () => {
    const { retained, evicted } = touchRetainedTeam(["a", "b"], "c", {
      limit: 1,
    });

    expect(retained).toEqual(["c"]);
    expect(evicted).toEqual(["a", "b"]);
  });
});
