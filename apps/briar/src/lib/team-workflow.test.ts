import { describe, expect, it } from "vitest";
import {
  parseGeneratedWorkflow,
  TeamWorkflowGenerationError,
} from "./team-workflow";

const generatedWorkflowDraft = () => ({
  requirements: [],
  stages: [{
    id: "implementing",
    label: "Implement",
    evidence: ["diff"],
    checks: [],
  }],
  execution: {
    checkpoints: [{
      stage: "implementing",
      position: "after",
    }],
  },
  completion: { requiredStages: ["implementing"] },
});

describe("generated project workflow boundary", () => {
  it("derives the canonical execution fields from one provider source", () => {
    const input = {
      ...generatedWorkflowDraft(),
      requirements: [{
        id: "xcode",
        label: "Xcode",
        kind: "xcode",
        tool: "wrong",
        reason: "Builds the iOS app.",
      }],
    };

    expect(parseGeneratedWorkflow(JSON.stringify(input))).toEqual({
      version: 2,
      requirements: [{
        id: "xcode",
        label: "Xcode",
        kind: "xcode",
        tool: "xcodebuild",
        reason: "Builds the iOS app.",
      }],
      stages: [{
        id: "implementing",
        label: "Implement",
        required: true,
        evidence: ["diff"],
        checks: [],
      }],
      execution: {
        checkpoints: [{
          key: "project-after-implementing",
          stage: "implementing",
          position: "after",
        }],
      },
      completion: { requiredStages: ["implementing"] },
    });
  });

  it("accepts the full persisted bounds for custom stages and checks", () => {
    const input = {
      requirements: [],
      stages: [{
        id: "release-validation",
        label: "Release validation",
        evidence: ["release report"],
        checks: ["x".repeat(500)],
      }],
      execution: {
        checkpoints: [{
          stage: "release-validation",
          position: "after",
        }],
      },
      completion: { requiredStages: ["release-validation"] },
    };

    expect(parseGeneratedWorkflow(JSON.stringify(input))).toMatchObject({
      stages: [{
        id: "release-validation",
        checks: ["x".repeat(500)],
        required: true,
      }],
      execution: {
        checkpoints: [{
          key: "project-after-release-validation",
          stage: "release-validation",
        }],
      },
    });
  });

  it("rejects the reserved repository bootstrap stage", () => {
    const input = generatedWorkflowDraft();
    input.stages[0]!.id = "repository_workflow_pending";
    input.execution.checkpoints[0]!.stage = "repository_workflow_pending";
    input.completion.requiredStages = ["repository_workflow_pending"];

    try {
      parseGeneratedWorkflow(JSON.stringify(input));
      throw new Error("Expected workflow parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TeamWorkflowGenerationError);
      expect(error).toMatchObject({
        phase: "draft",
        issues: expect.arrayContaining([{
          path: ["stages", 0, "id"],
          message: "Reserved repository workflow stage is not executable.",
        }]),
      });
    }
  });

  it("keeps malformed JSON behind a typed stable boundary error", () => {
    try {
      parseGeneratedWorkflow("{not-json");
      throw new Error("Expected workflow parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TeamWorkflowGenerationError);
      expect(error).toMatchObject({
        phase: "json",
        message: "LLM 프로바이더가 유효한 워크플로우 JSON을 반환하지 않았습니다.",
      });
    }
  });

  it("reports every invalid stage reference with its Effect schema path", () => {
    const input = generatedWorkflowDraft();
    input.completion.requiredStages = ["production_qa"];
    input.execution.checkpoints[0]!.stage = "monitoring";

    try {
      parseGeneratedWorkflow(JSON.stringify(input));
      throw new Error("Expected workflow parsing to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(TeamWorkflowGenerationError);
      const generationError = error as TeamWorkflowGenerationError;
      expect(generationError.phase).toBe("draft");
      expect(generationError.issues.map(({ path }) => path)).toEqual(
        expect.arrayContaining([
          ["completion", "requiredStages", 0],
          ["execution", "checkpoints", 0, "stage"],
        ]),
      );
    }
  });

  it("rejects provider fields that Briar owns", () => {
    const input = {
      ...generatedWorkflowDraft(),
      version: 2,
      stages: [{
        ...generatedWorkflowDraft().stages[0],
        required: false,
      }],
      execution: {
        checkpoints: [{
          ...generatedWorkflowDraft().execution.checkpoints[0],
          key: "human_review",
        }],
      },
    };

    expect(() => parseGeneratedWorkflow(JSON.stringify(input))).toThrow(
      "LLM 프로바이더가 생성한 워크플로우가 실행 계약을 충족하지 않습니다.",
    );
  });
});
