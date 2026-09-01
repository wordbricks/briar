import { describe, expect, it } from "vitest";
import { decodeRunStructuredResult } from "./run-structured-result";

const result = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    summary: "The Worker needs a repository connection.",
    outcome: "OUTCOME_BLOCKED",
    importance: "IMPORTANCE_IMPORTANT",
    urgency: "URGENCY_NORMAL",
    impact: "IMPACT_ISSUE",
    humanActionRequired: true,
    nextAction: "Reconnect the repository and retry the run.",
    ...overrides,
  });

describe("run structured result ProtoJSON", () => {
  it("maps canonical generated enum names into the validated domain result", () => {
    expect(decodeRunStructuredResult({
      domainJson: null,
      protoJson: result(),
    })).toMatchObject({
      outcome: "blocked",
      importance: "important",
      urgency: "normal",
      impact: "issue",
      humanActionRequired: true,
    });
  });

  it.each([
    ["an unspecified enum", { outcome: "OUTCOME_UNSPECIFIED" }],
    ["an unknown open enum", { outcome: 999 }],
    ["a required next action", { nextAction: undefined }],
  ])("rejects %s", (_case, overrides) => {
    expect(() => decodeRunStructuredResult({
      domainJson: null,
      protoJson: result(overrides),
    })).toThrow();
  });
});
