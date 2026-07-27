import { z } from "zod";
import {
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import { chatWithProjectLlm, type JsonSchema } from "./project-llm";

const workflowStageSchema = z.object({
  id: z.string().trim().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/u),
  label: z.string().trim().min(1).max(80),
  required: z.boolean(),
  evidence: z.array(z.string().trim().min(1).max(80)).max(20),
  checks: z.array(z.string().trim().min(1).max(300)).max(20),
});

const generatedWorkflowSchema = z
  .object({
    version: z.literal(1),
    stages: z.array(workflowStageSchema).min(1).max(30),
    completion: z.object({
      requiredStages: z.array(z.string().trim().min(1).max(64)).max(30),
    }),
    release: z.object({ enabled: z.boolean() }),
  })
  .superRefine((workflow, context) => {
    const stageIds = workflow.stages.map((stage) => stage.id);
    const uniqueIds = new Set(stageIds);
    if (uniqueIds.size !== stageIds.length) {
      context.addIssue({
        code: "custom",
        message: "Workflow stage ids must be unique.",
        path: ["stages"],
      });
    }
    const expectedRequired = workflow.stages
      .filter((stage) => stage.required)
      .map((stage) => stage.id);
    if (
      workflow.completion.requiredStages.length !== expectedRequired.length ||
      workflow.completion.requiredStages.some((id) => !expectedRequired.includes(id))
    ) {
      context.addIssue({
        code: "custom",
        message: "Completion stages must match stages marked as required.",
        path: ["completion", "requiredStages"],
      });
    }
  });

const workflowOutputSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["version", "stages", "completion", "release"],
  properties: {
    version: { type: "integer", enum: [1] },
    stages: {
      type: "array",
      minItems: 1,
      maxItems: 30,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "label", "required", "evidence", "checks"],
        properties: {
          id: { type: "string", pattern: "^[a-z][a-z0-9_]*$", maxLength: 64 },
          label: { type: "string", minLength: 1, maxLength: 80 },
          required: { type: "boolean" },
          evidence: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 80 },
          },
          checks: {
            type: "array",
            maxItems: 20,
            items: { type: "string", minLength: 1, maxLength: 300 },
          },
        },
      },
    },
    completion: {
      type: "object",
      additionalProperties: false,
      required: ["requiredStages"],
      properties: {
        requiredStages: {
          type: "array",
          maxItems: 30,
          items: { type: "string", minLength: 1, maxLength: 64 },
        },
      },
    },
    release: {
      type: "object",
      additionalProperties: false,
      required: ["enabled"],
      properties: { enabled: { type: "boolean" } },
    },
  },
};

const workflowInstructions = `You design repository-specific Briar Auto Hunt workflows.
Inspect only the provided repository checkout using read-only tools. Briar prepares it from the latest origin default-branch commit when an origin exists, and otherwise uses the connected local checkout. Review manifests and scripts, CI configuration, release or deployment configuration, tests, documentation, and repository instructions before deciding.
Return only the JSON object required by the output schema.

Rules:
- Model the stages that an autonomous coding task actually needs in this repository.
- Prefer these stable ids when they fit: analyzing, planning, implementing, reviewing, pr_open, local_qa, ci_qa, staging_qa, production_qa, monitoring.
- Never use the reserved repository_workflow_pending stage id.
- Custom snake_case ids are allowed only when the repository has a genuinely distinct step.
- Use concise English labels so the stored workflow is portable across UI locales.
- Include exact validation commands in checks only when they are supported by repository files.
- Include evidence names that can be collected during that stage.
- Return empty evidence or checks arrays when a stage has none; never omit those fields.
- Mark a stage required only when every successful Auto Hunt task must complete it.
- completion.requiredStages must contain exactly the ids marked required, in stage order.
- Do not invent pull requests, CI, staging, production, deployment, or monitoring. Include them only when repository evidence proves they exist and are usable.
- release.enabled must be false unless the repository has an actual release or deployment path that Auto Hunt can run.
- Do not modify files and do not run commands that can change the repository.`;

const workflowRequest = `Analyze this repository and generate the most appropriate Briar Auto Hunt workflow for future autonomous issue, feedback, and error work. Keep it minimal, executable, and grounded in the repository's actual tooling.`;

export async function generateProjectWorkflow(
  projectId: string,
): Promise<AutoHuntWorkflow> {
  const response = await chatWithProjectLlm({
    projectId,
    message: workflowRequest,
    instructions: workflowInstructions,
    outputSchema: workflowOutputSchema,
    workspaceMode: "latestRemoteBase",
  });
  let parsed: unknown;
  try {
    parsed = JSON.parse(response.message);
  } catch {
    throw new Error("Codex가 유효한 워크플로우 JSON을 반환하지 않았습니다.");
  }
  const generated = generatedWorkflowSchema.safeParse(parsed);
  if (!generated.success) {
    throw new Error("Codex가 생성한 워크플로우가 실행 계약을 충족하지 않습니다.");
  }
  return normalizeAutoHuntWorkflow(generated.data);
}
