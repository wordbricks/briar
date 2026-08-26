import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  makeProjectWorkflowGenerator,
  ProjectWorkflowGenerationError,
  type ProjectWorkflowChat,
} from "./project-workflow";

const projectLlmChat = vi.fn<ProjectWorkflowChat>();
const generateProjectWorkflow = makeProjectWorkflowGenerator(projectLlmChat);

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
    projectLlmChat.mockReset();
  });

  it("repairs the observed contradictory response once in the same conversation", async () => {
    projectLlmChat
      .mockResolvedValueOnce(response(contradictoryProviderWorkflow()))
      .mockResolvedValueOnce(response(validProviderDraft()));

    const workflow = await generateProjectWorkflow("project-1");

    expect(workflow.stages.map(({ required }) => required)).toEqual([
      true,
      true,
      true,
      true,
    ]);
    expect(workflow.execution.checkpoints[0]?.key).toBe(
      "project-after-reviewing",
    );
    expect(projectLlmChat).toHaveBeenCalledTimes(2);

    const firstInput = projectLlmChat.mock.calls[0]![0];
    const repairedInput = projectLlmChat.mock.calls[1]![0];
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

  it("stops after one repair attempt", async () => {
    projectLlmChat
      .mockResolvedValueOnce(response(contradictoryProviderWorkflow()))
      .mockResolvedValueOnce(response(contradictoryProviderWorkflow()));

    await expect(generateProjectWorkflow("project-1")).rejects.toBeInstanceOf(
      ProjectWorkflowGenerationError,
    );
    expect(projectLlmChat).toHaveBeenCalledTimes(2);
  });

  it("does not treat provider transport failures as repairable output", async () => {
    const providerError = new Error("provider unavailable");
    projectLlmChat.mockRejectedValueOnce(providerError);

    await expect(generateProjectWorkflow("project-1")).rejects.toBe(
      providerError,
    );
    expect(projectLlmChat).toHaveBeenCalledTimes(1);
  });
});
