import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatWithProjectLlm } = vi.hoisted(() => ({
  chatWithProjectLlm: vi.fn(),
}));

vi.mock("./project-llm", () => ({ chatWithProjectLlm }));

import {
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
        stages: [
          { id: "analyzing", label: "Analyze", required: true, evidence: ["repository"], checks: [] },
          { id: "implementing", label: "Implement", required: true, evidence: ["diff"], checks: [] },
          {
            id: "local_qa",
            label: "Local validation",
            required: true,
            evidence: ["signoff/app-worker", "local QA"],
            checks: ["bun run test"],
          },
        ],
        completion: {
          requiredStages: ["analyzing", "implementing", "local_qa"],
        },
        release: { enabled: false },
      }),
    });

    await expect(generateProjectWorkflow("project-1")).resolves.toMatchObject({
      release: { enabled: false },
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

  it("rejects a workflow whose required stages contradict the stage contract", async () => {
    chatWithProjectLlm.mockResolvedValue({
      conversationId: "briar:project-1:thread-1",
      workspaceRoot: "/repo",
      message: JSON.stringify({
        version: 1,
        stages: [{ id: "analyzing", label: "Analyze", required: true, evidence: [], checks: [] }],
        completion: { requiredStages: [] },
        release: { enabled: false },
      }),
    });

    await expect(generateProjectWorkflow("project-1")).rejects.toThrow(
      "실행 계약",
    );
  });

  it("revises the current workflow using the repository and natural-language request", async () => {
    const currentWorkflow = {
      version: 1 as const,
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
      completion: { requiredStages: ["implementing", "pr_open"] },
      release: { enabled: false },
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
          completion: { requiredStages: ["implementing"] },
          release: { enabled: false },
        },
        "   ",
      ),
    ).rejects.toThrow("수정 요청");
    expect(chatWithProjectLlm).not.toHaveBeenCalled();
  });
});
