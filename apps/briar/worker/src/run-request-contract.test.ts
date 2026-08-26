import { describe, expect, it } from "vitest";
import { RequestDecodeError } from "./request-schema";
import {
  decodeRunEvent,
  parseProjectSettingsInput,
} from "./run-request-contract";

describe("run request contract", () => {
  it("preserves omitted nullable project settings", () => {
    const settings = parseProjectSettingsInput({
      linear: { enabled: false, source: null, teamKey: null },
    });

    expect(settings).toMatchObject({
      linear: { enabled: false, source: null, teamKey: null },
    });
    expect(settings).not.toHaveProperty("velenOrg");
    expect(settings).not.toHaveProperty("dataSource");
    expect(settings).not.toHaveProperty("githubRepository");
  });

  it("maps non-workflow schema failures to request decode errors", () => {
    expect(() => parseProjectSettingsInput({ velenOrg: 42 })).toThrow(
      RequestDecodeError,
    );
  });

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

  it("rejects excess event fields and timestamps without an offset", () => {
    const event = {
      runId: "11111111-1111-4111-8111-111111111111",
      status: "backlog",
      eventKey: "BRIAR-42:backlog",
      occurredAt: "2026-08-20T17:00:00+09:00",
      actor: "briar-workflow",
      repository: "example/briar",
    };

    expect(decodeRunEvent(event)).toMatchObject({
      occurredAt: "2026-08-20T17:00:00+09:00",
    });
    expect(() => decodeRunEvent({ ...event, unexpected: true })).toThrow(
      RequestDecodeError,
    );
    expect(() =>
      decodeRunEvent({ ...event, occurredAt: "2026-08-20T17:00:00" })
    ).toThrow(RequestDecodeError);
  });
});
