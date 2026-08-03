import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatWithProjectLlm } = vi.hoisted(() => ({
  chatWithProjectLlm: vi.fn(),
}));

vi.mock("./project-llm", () => ({ chatWithProjectLlm }));

import {
  analyzeProjectWorkflowRequirements,
  generateProjectWorkflow,
  reviseProjectWorkflow,
} from "./project-workflow";

describe("project workflow generator", () => {
  beforeEach(() => chatWithProjectLlm.mockReset());

  it("generates a repository workflow through the project agent gateway", async () => {
    chatWithProjectLlm.mockResolvedValue({
      conversationId: "briar:project-1:thread-1",
      workspaceRoot: "/repo",
      message: JSON.stringify({
        version: 1,
        requirements: [{
          id: "bun",
          label: "Bun",
          kind: "executable",
          tool: "bun",
          reason: "Runs the repository test scripts.",
        }],
        stages: [
          {
            id: "analyzing",
            label: "Analyze",
            required: true,
            evidence: ["repository"],
            checks: [],
          },
          {
            id: "implementing",
            label: "Implement",
            required: true,
            evidence: ["diff"],
            checks: [],
          },
          {
            id: "local_qa",
            label: "Local validation",
            required: true,
            evidence: ["signoff/app-worker", "local QA"],
            checks: ["bun run test"],
          },
        ],
        execution: { pauseAfterStage: "local_qa" },
        completion: {
          requiredStages: ["analyzing", "implementing", "local_qa"],
        },
      }),
    });

    await expect(generateProjectWorkflow("project-1")).resolves.toMatchObject({
      requirements: [{ id: "bun", tool: "bun" }],
      execution: { pauseAfterStage: "local_qa" },
      stages: [
        { id: "analyzing" },
        { id: "implementing" },
        {
          id: "local_qa",
          evidence: ["signoff/app-worker", "local QA"],
        },
      ],
    });
    expect(chatWithProjectLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        outputSchema: expect.objectContaining({ type: "object" }),
        workspaceMode: "latestRemoteBase",
      }),
    );
  });

  it("regenerates only tool requirements for an existing workflow", async () => {
    const currentWorkflow = {
      version: 1 as const,
      requirements: [],
      stages: [
        {
          id: "implementing",
          label: "Implement",
          required: true,
          evidence: ["diff"],
          checks: [],
        },
        {
          id: "local_qa",
          label: "Local validation",
          required: true,
          evidence: ["test"],
          checks: ["bun run test"],
        },
      ],
      execution: { pauseAfterStage: "local_qa" },
      completion: { requiredStages: ["implementing", "local_qa"] },
    };
    chatWithProjectLlm.mockResolvedValue({
      conversationId: "briar:project-1:thread-tools",
      workspaceRoot: "/repo",
      message: JSON.stringify({
        requirements: [{
          id: "bun",
          label: "Bun",
          kind: "executable",
          tool: "bun",
          reason: "Runs repository validation.",
        }],
      }),
    });

    const result = await analyzeProjectWorkflowRequirements(
      "project-1",
      currentWorkflow,
    );

    expect(result.requirements).toEqual([
      expect.objectContaining({ id: "bun", tool: "bun" }),
    ]);
    expect(result.stages).toEqual(currentWorkflow.stages);
    expect(result.execution).toEqual(currentWorkflow.execution);
    expect(result.completion).toEqual(currentWorkflow.completion);
    expect(chatWithProjectLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        message: expect.stringContaining("current_workflow_json"),
        outputSchema: expect.objectContaining({ type: "object" }),
        workspaceMode: "latestRemoteBase",
      }),
    );
  });

  it("uses the current workflow as the baseline when regenerating", async () => {
    const currentWorkflow = {
      version: 1 as const,
      requirements: [],
      stages: [
        {
          id: "implementing",
          label: "Implement",
          required: true,
          evidence: ["diff"],
          checks: [],
        },
        {
          id: "local_qa",
          label: "Local validation",
          required: true,
          evidence: ["test"],
          checks: ["bun run test"],
        },
      ],
      execution: { pauseAfterStage: "local_qa" },
      completion: { requiredStages: ["implementing", "local_qa"] },
    };
    chatWithProjectLlm.mockResolvedValue({
      conversationId: "briar:project-1:thread-regenerate",
      workspaceRoot: "/repo",
      message: JSON.stringify(currentWorkflow),
    });

    await expect(
      generateProjectWorkflow("project-1", currentWorkflow),
    ).resolves.toMatchObject({
      stages: [{ id: "implementing" }, { id: "local_qa" }],
      execution: { pauseAfterStage: "local_qa" },
      completion: { requiredStages: ["implementing", "local_qa"] },
    });

    expect(chatWithProjectLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        message: expect.stringContaining("current_workflow_json"),
        instructions: expect.stringContaining(
          "preserve it as much as possible",
        ),
        workspaceMode: "latestRemoteBase",
      }),
    );
    expect(chatWithProjectLlm.mock.calls[0]?.[0].message).toContain(
      JSON.stringify(currentWorkflow, null, 2),
    );
  });

  it("rejects a workflow whose required stages contradict the stage contract", async () => {
    chatWithProjectLlm.mockResolvedValue({
      conversationId: "briar:project-1:thread-1",
      workspaceRoot: "/repo",
      message: JSON.stringify({
        version: 1,
        requirements: [],
        stages: [
          {
            id: "analyzing",
            label: "Analyze",
            required: true,
            evidence: [],
            checks: [],
          },
        ],
        execution: { pauseAfterStage: "analyzing" },
        completion: { requiredStages: [] },
      }),
    });

    await expect(generateProjectWorkflow("project-1")).rejects.toThrow(
      "실행 계약",
    );
  });

  it("rejects an execution boundary that is not a configured stage", async () => {
    chatWithProjectLlm.mockResolvedValue({
      conversationId: "briar:project-1:thread-1",
      workspaceRoot: "/repo",
      message: JSON.stringify({
        version: 1,
        requirements: [],
        stages: [
          {
            id: "implementing",
            label: "Implement",
            required: true,
            evidence: ["diff"],
            checks: [],
          },
        ],
        execution: { pauseAfterStage: "production_qa" },
        completion: { requiredStages: ["implementing"] },
      }),
    });

    await expect(generateProjectWorkflow("project-1")).rejects.toThrow(
      "실행 계약",
    );
  });

  it("revises the current workflow using the repository and natural-language request", async () => {
    const currentWorkflow = {
      version: 1 as const,
      requirements: [],
      stages: [
        {
          id: "implementing",
          label: "Implement",
          required: true,
          evidence: ["diff"],
          checks: [],
        },
        {
          id: "pr_open",
          label: "Open PR",
          required: true,
          evidence: ["pull_request"],
          checks: [],
        },
      ],
      execution: { pauseAfterStage: "pr_open" },
      completion: { requiredStages: ["implementing", "pr_open"] },
    };
    const revisedWorkflow = {
      ...currentWorkflow,
      stages: [
        ...currentWorkflow.stages,
        {
          id: "merged",
          label: "Merge to main",
          required: true,
          evidence: ["merge_commit"],
          checks: [],
        },
      ],
      completion: {
        requiredStages: ["implementing", "pr_open", "merged"],
      },
      execution: { pauseAfterStage: "merged" },
    };
    chatWithProjectLlm.mockResolvedValue({
      conversationId: "briar:project-1:thread-2",
      workspaceRoot: "/repo",
      message: JSON.stringify(revisedWorkflow),
    });

    await expect(
      reviseProjectWorkflow(
        "project-1",
        currentWorkflow,
        "main 에 머지되어야 complete가 되도록 수정해줘",
      ),
    ).resolves.toMatchObject({
      stages: [{ id: "implementing" }, { id: "pr_open" }, { id: "merged" }],
      completion: {
        requiredStages: ["implementing", "pr_open", "merged"],
      },
    });
    expect(chatWithProjectLlm).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        message: expect.stringContaining(
          "main 에 머지되어야 complete가 되도록 수정해줘",
        ),
        instructions: expect.stringContaining("existing workflow"),
        workspaceMode: "latestRemoteBase",
      }),
    );
    expect(chatWithProjectLlm.mock.calls[0]?.[0].instructions).toContain(
      "Preserve all unrelated",
    );
    expect(chatWithProjectLlm.mock.calls[0]?.[0].message).toContain(
      JSON.stringify(currentWorkflow, null, 2),
    );
  });

  it("rejects an empty workflow revision request before calling the agent", async () => {
    await expect(
      reviseProjectWorkflow(
        "project-1",
        {
          version: 1,
          stages: [
            {
              id: "implementing",
              label: "Implement",
              required: true,
              evidence: [],
              checks: [],
            },
          ],
          execution: { pauseAfterStage: "implementing" },
          completion: { requiredStages: ["implementing"] },
        },
        "   ",
      ),
    ).rejects.toThrow("수정 요청");
    expect(chatWithProjectLlm).not.toHaveBeenCalled();
  });
});
