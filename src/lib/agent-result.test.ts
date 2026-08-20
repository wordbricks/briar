import { describe, expect, it } from "vitest";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import {
  decodeStructuredAgentResult,
  decodeStructuredAgentResultOption,
  StructuredAgentResult,
} from "./agent-result";

const routineCompletion = {
  summary: "The requested change was implemented and verified.",
  outcome: "completed",
  importance: "routine",
  urgency: "normal",
  impact: "issue",
  humanActionRequired: false,
  nextAction: null,
  dueAt: null,
} as const;

describe("structured agent result", () => {
  it("accepts an explainable routine completion", () => {
    expect(decodeStructuredAgentResult(routineCompletion)).toMatchObject({
      outcome: "completed",
      humanActionRequired: false,
    });
  });

  it("requires an exact next action when a person must intervene", () => {
    expect(() =>
      decodeStructuredAgentResult({
        summary: "Production access is required.",
        outcome: "blocked",
        importance: "critical",
        urgency: "immediate",
        impact: "project",
        humanActionRequired: true,
        nextAction: null,
        dueAt: null,
      }),
    ).toThrow(/require nextAction/u);
  });

  it("keeps strict object and explicit-offset date-time semantics", () => {
    expect(
      decodeStructuredAgentResult({
        ...routineCompletion,
        summary: "  Completed with a deadline.  ",
        dueAt: "2026-08-20T17:00:00+09:00",
      }),
    ).toMatchObject({
      summary: "Completed with a deadline.",
      dueAt: "2026-08-20T17:00:00+09:00",
    });
    expect(() =>
      decodeStructuredAgentResult({
        ...routineCompletion,
        dueAt: "2026-08-20T17:00:00",
      })
    ).toThrow();
    expect(() =>
      Schema.decodeUnknownSync(StructuredAgentResult)({
        ...routineCompletion,
        hiddenAuthority: true,
      })
    ).toThrow(/excess property/u);
  });

  it("offers an Option decoder for invalid persisted results", () => {
    expect(
      Option.isNone(
        decodeStructuredAgentResultOption({
          ...routineCompletion,
          outcome: "unknown",
        }),
      ),
    ).toBe(true);
  });
});
