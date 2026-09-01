import {
  canonicalizeProjectWorkflow,
  type AutoHuntWorkflow,
} from "./auto-hunt-contract";
import type {
  LovablePackageManager,
  LovableRepositoryCompatibility,
  LovableStack,
} from "../generated/tauri";

const packageManagerLabels = {
  bun: "Bun",
  npm: "npm",
  pnpm: "pnpm",
  yarn: "Yarn",
} as const satisfies Record<LovablePackageManager, string>;

const stackLabels = {
  "tanstack-start": "TanStack Start",
  "vite-react": "React + Vite",
} as const satisfies Record<LovableStack, string>;

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
  const stackLabel = stackLabels[compatibility.stack];

  return canonicalizeProjectWorkflow({
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
        id: "reviewing",
        label: "Review",
        required: true,
        evidence: ["review findings"],
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
        label: "Create pull request",
        required: true,
        evidence: ["branch", "commit", "push", "pull_request"],
        checks: [],
      },
      {
        id: "ci_qa",
        label: "Required CI and signoff",
        required: true,
        evidence: ["ci", "signoff"],
        checks: [],
      },
      {
        id: "merged",
        label: "Merge to main",
        required: true,
        evidence: ["merge_commit"],
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
      requiredStages: [
        "analyzing",
        "implementing",
        "reviewing",
        "local_qa",
        "pr_open",
        "ci_qa",
        "merged",
      ],
    },
  });
}
