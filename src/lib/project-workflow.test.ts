import { beforeEach, describe, expect, it, vi } from "vitest";

const { chatWithProjectLlm } = vi.hoisted(() => ({
  chatWithProjectLlm: vi.fn(),
}));

vi.mock("./project-llm", () => ({ chatWithProjectLlm }));

import { generateProjectWorkflow } from "./project-workflow";

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
});
