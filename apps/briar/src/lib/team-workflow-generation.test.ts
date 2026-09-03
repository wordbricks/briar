import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeTeamWorkflowGenerator,
  TeamWorkflowGenerationError,
  type TeamWorkflowChat,
} from "./team-workflow";
import type { AutoHuntWorkflow } from "./auto-hunt-contract";

const teamLlmChat = vi.fn<TeamWorkflowChat>();
const generateTeamWorkflow = makeTeamWorkflowGenerator(teamLlmChat);

const stages = ["analyzing", "planning", "implementing", "reviewing"];

const contradictoryProviderWorkflow = () => ({
  version: 2,
  requirements: [],
  stages: stages.map((id) => ({
    id,
    label: id,
    required: false,
    evidence: ["Repository findings"],
    checks: [],
  })),
  execution: {
    checkpoints: [{
      key: "human_review",
      stage: "reviewing",
      position: "after",
    }],
  },
  completion: { requiredStages: stages },
});

const validProviderDraft = () => ({
  requirements: [],
  stages: stages.map((id) => ({
    id,
    label: id,
    evidence: ["Repository findings"],
    checks: [],
  })),
  execution: {
    checkpoints: [{ stage: "reviewing", position: "after" }],
  },
  completion: { requiredStages: stages },
});

const response = (message: unknown, conversationId = "codex:project:thread-1") => ({
  conversationId,
  message: JSON.stringify(message),
  workspaceRoot: "/tmp/repository",
});

describe("project workflow generation repair", () => {
  beforeEach(() => {
    teamLlmChat.mockReset();
  });

  it("repairs the observed contradictory response once in the same conversation", async () => {
    teamLlmChat
      .mockResolvedValueOnce(response(contradictoryProviderWorkflow()))
      .mockResolvedValueOnce(response(validProviderDraft()));

    const workflow = await generateTeamWorkflow("project-1");

    expect(workflow.stages.map(({ required }) => required)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(workflow.execution.checkpoints[0]?.key).toBe(
      "project-after-reviewing",
    );
    expect(teamLlmChat).toHaveBeenCalledTimes(2);

    const firstInput = teamLlmChat.mock.calls[0]![0];
    const repairedInput = teamLlmChat.mock.calls[1]![0];
    expect(repairedInput).toMatchObject({
      conversationId: "codex:project:thread-1",
      instructions: firstInput.instructions,
      outputSchema: firstInput.outputSchema,
      workspaceMode: "latestRemoteBase",
    });
    expect(repairedInput.message).toContain("Validation diagnostics:");

    const schema = firstInput.outputSchema as {
      required: string[];
      properties: {
        stages: { items: { required: string[]; properties: object } };
        execution: {
          properties: {
            checkpoints: { items: { required: string[]; properties: object } };
          };
        };
      };
    };
    expect(schema.required).toEqual([
      "requirements",
      "stages",
      "execution",
      "completion",
    ]);
    expect(schema.properties.stages.items.required).not.toContain("required");
    expect(schema.properties.stages.items.properties).not.toHaveProperty(
      "required",
    );
    const checkpoint =
      schema.properties.execution.properties.checkpoints.items;
    expect(checkpoint.required).not.toContain("key");
    expect(checkpoint.properties).not.toHaveProperty("key");
  });

  it("round-trips every valid persisted custom-stage value during regeneration", async () => {
    const check = "x".repeat(500);
    const currentWorkflow = {
      version: 2,
      requirements: [],
      stages: [{
        id: "release-validation",
        label: "Release validation",
        required: true,
        evidence: ["release report"],
        checks: [check],
      }],
      execution: {
        checkpoints: [{
          key: "project-after-release-validation",
          stage: "release-validation",
          position: "after",
        }],
      },
      completion: { requiredStages: ["release-validation"] },
    } satisfies AutoHuntWorkflow;
    const providerDraft = {
      requirements: currentWorkflow.requirements,
      stages: currentWorkflow.stages.map((stage) => ({
        id: stage.id,
        label: stage.label,
        evidence: stage.evidence,
        checks: stage.checks,
      })),
      execution: {
        checkpoints: currentWorkflow.execution.checkpoints.map((checkpoint) => ({
          stage: checkpoint.stage,
          position: checkpoint.position,
        })),
      },
      completion: currentWorkflow.completion,
    };
    teamLlmChat.mockResolvedValueOnce(response(providerDraft));

    await expect(
      generateTeamWorkflow("project-1", currentWorkflow),
    ).resolves.toEqual(currentWorkflow);
    expect(teamLlmChat).toHaveBeenCalledTimes(1);
    expect(teamLlmChat.mock.calls[0]![0].message).toContain(
      '"id": "release-validation"',
    );
    expect(teamLlmChat.mock.calls[0]![0].message).toContain(check);
  });

  it("stops after one repair attempt", async () => {
    teamLlmChat
      .mockResolvedValueOnce(response(contradictoryProviderWorkflow()))
      .mockResolvedValueOnce(response(contradictoryProviderWorkflow()));

    await expect(generateTeamWorkflow("project-1")).rejects.toBeInstanceOf(
      TeamWorkflowGenerationError,
    );
    expect(teamLlmChat).toHaveBeenCalledTimes(2);
  });

  it("does not treat provider transport failures as repairable output", async () => {
    const providerError = new Error("provider unavailable");
    teamLlmChat.mockRejectedValueOnce(providerError);

    await expect(generateTeamWorkflow("project-1")).rejects.toBe(
      providerError,
    );
    expect(teamLlmChat).toHaveBeenCalledTimes(1);
  });
});
