import { describe, expect, it } from "vitest";
import { structuredAgentResultSchema } from "./agent-result";

describe("structured agent result", () => {
  it("accepts an explainable routine completion", () => {
    expect(
      structuredAgentResultSchema.parse({
        summary: "The requested change was implemented and verified.",
        outcome: "completed",
        importance: "routine",
        urgency: "normal",
        impact: "issue",
        humanActionRequired: false,
        nextAction: null,
        dueAt: null,
      }),
    ).toMatchObject({
      outcome: "completed",
      humanActionRequired: false,
    });
  });

  it("requires an exact next action when a person must intervene", () => {
    expect(() =>
      structuredAgentResultSchema.parse({
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
});
