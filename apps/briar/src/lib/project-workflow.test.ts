import { describe, expect, it } from "vitest";
import { parseGeneratedWorkflow } from "./project-workflow";

const generatedWorkflow = () => ({
  version: 2,
  requirements: [],
  stages: [{
    id: "implementing",
    label: "Implement",
    required: true,
    evidence: ["diff"],
    checks: [],
  }],
  execution: {
    checkpoints: [{
      key: "human_review",
      stage: "implementing",
      position: "after",
    }],
  },
  completion: { requiredStages: ["implementing"] },
});

describe("generated project workflow boundary", () => {
  it("normalizes supported values and strips fields outside the contract", () => {
    const input = {
      ...generatedWorkflow(),
      requirements: [{
        id: " bun ",
        label: " Bun ",
        kind: "executable",
        tool: " bun ",
        reason: " Runs repository tests. ",
        unsupported: "drop-me",
      }],
      stages: [{
        id: " implementing ",
        label: " Implement ",
        required: true,
        evidence: [" diff "],
        checks: [" bun run test "],
        unsupported: "drop-me",
      }],
      execution: {
        checkpoints: [{
          key: " human_review ",
          stage: " implementing ",
          position: "after",
          unsupported: "drop-me",
        }],
        unsupported: "drop-me",
      },
      completion: {
        requiredStages: [" implementing "],
        unsupported: "drop-me",
      },
      unsupported: "drop-me",
    };

    expect(parseGeneratedWorkflow(JSON.stringify(input))).toEqual({
      version: 2,
      requirements: [{
        id: "bun",
        label: "Bun",
        kind: "executable",
        tool: "bun",
        reason: "Runs repository tests.",
      }],
      stages: [{
        id: "implementing",
        label: "Implement",
        required: true,
        evidence: ["diff"],
        checks: ["bun run test"],
      }],
      execution: {
        checkpoints: [{
          key: "human_review",
          stage: "implementing",
          position: "after",
        }],
      },
      completion: { requiredStages: ["implementing"] },
    });
  });

  it("keeps malformed JSON behind a stable boundary error", () => {
    expect(() => parseGeneratedWorkflow("{not-json")).toThrow(
      "LLM 프로바이더가 유효한 워크플로우 JSON을 반환하지 않았습니다.",
    );
  });

  it("rejects completion rules that contradict required stages", () => {
    const input = generatedWorkflow();
    input.completion.requiredStages.splice(0);

    expect(() => parseGeneratedWorkflow(JSON.stringify(input))).toThrow(
      "LLM 프로바이더가 생성한 워크플로우가 실행 계약을 충족하지 않습니다.",
    );
  });

  it("rejects checkpoints that reference a missing stage", () => {
    const input = generatedWorkflow();
    input.execution.checkpoints[0]!.stage = "production_qa";

    expect(() => parseGeneratedWorkflow(JSON.stringify(input))).toThrow(
      "LLM 프로바이더가 생성한 워크플로우가 실행 계약을 충족하지 않습니다.",
    );
  });
});
