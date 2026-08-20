import {
  normalizeAutoHuntWorkflow,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import type { LovableRepositoryCompatibility } from "./project-connection";

const packageManagerLabels = {
  bun: "Bun",
  npm: "npm",
  pnpm: "pnpm",
  yarn: "Yarn",
} as const;

const validationScriptOrder = ["lint", "typecheck", "test", "build"] as const;

export function lovableWorkflowPreset(
  compatibility: LovableRepositoryCompatibility,
): AutoHuntWorkflow | null {
  if (
    !compatibility.compatible ||
    !compatibility.stack ||
    !compatibility.packageManager
  ) {
    return null;
  }
  const packageManager = compatibility.packageManager;
  const availableScripts = new Set(compatibility.scripts);
  const checks = validationScriptOrder
    .filter((script) => availableScripts.has(script))
    .map((script) => `${packageManager} run ${script}`);
  const stackLabel = compatibility.stack === "tanstack-start"
    ? "TanStack Start"
    : "React + Vite";

  return normalizeAutoHuntWorkflow({
    version: 2,
    requirements: [{
      id: packageManager,
      label: packageManagerLabels[packageManager],
      kind: "executable",
      tool: packageManager,
      reason: `Runs the ${stackLabel} validation scripts used by this Lovable project.`,
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
        evidence: ["test"],
        checks,
      },
      {
        id: "pr_open",
        label: "Open pull request",
        required: true,
        evidence: ["pull_request"],
        checks: [],
      },
    ],
    execution: {
      checkpoints: [{
        key: "human_review",
        stage: "pr_open",
        position: "after",
      }],
    },
    completion: {
      requiredStages: ["analyzing", "implementing", "local_qa", "pr_open"],
    },
  });
}
