import { describe, expect, it } from "vitest";
import { parseProjectSettingsInput } from "./run-request-contract";

describe("run request contract", () => {
  it("canonicalizes project-owned workflow fields at the request boundary", () => {
    const settings = parseProjectSettingsInput({
      linear: { enabled: false, source: null, teamKey: null },
      workflow: {
        version: 2,
        requirements: [{
          id: "xcode",
          label: "Xcode",
          kind: "xcode",
          tool: "wrong",
          reason: "Builds the iOS app.",
        }],
        stages: [{
          id: "implementing",
          label: "Implement",
          required: true,
        }],
        execution: {
          checkpoints: [{
            key: "human_review",
            stage: "implementing",
            position: "after",
          }],
        },
        completion: { requiredStages: ["implementing"] },
      },
    });

    expect(settings.workflow.requirements[0]?.tool).toBe("xcodebuild");
    expect(settings.workflow.execution.checkpoints[0]?.key).toBe(
      "project-after-implementing",
    );
  });
});
