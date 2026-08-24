import { type AutoHuntWorkflow } from "@/lib/auto-hunt-contract";
import type { HuntRun, RunEvidence } from "@/types";
export function hasResultReviews(run: Pick<HuntRun, "resultReviews">) {
  return (run.resultReviews?.length ?? 0) > 0;
}
export type DeploymentQaTarget = {
  environment: string;
  revision: number;
  url: string;
};
export const deploymentStagePattern = /(^|[\s_-])(deploy(?:ment)?|preview|publish|release|staging|production)([\s_-]|$)/i;
export const deploymentEvidenceTypePattern = /(^|[\s_-])(deploy(?:ed|ment)?|preview|staging|production)([\s_-]|$)/i;
export function metadataString(metadata: Record<string, unknown> | null, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
export function verifiedHttpUrl(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}
export function deploymentQaTargets(evidence: RunEvidence[], workflow: AutoHuntWorkflow): DeploymentQaTarget[] {
  const stages = new Map(workflow.stages.map(stage => [stage.id, stage]));
  const targets = evidence.flatMap(item => {
    if (!item.canonical || item.status !== "passed") return [];
    const url = verifiedHttpUrl(item.url);
    if (!url) return [];
    const stage = stages.get(item.stage);
    const environment = metadataString(item.metadata, ["environment", "environmentName", "environment_name", "deploymentEnvironment", "deployment_environment", "targetEnvironment", "target_environment"]);
    const isDeploymentStage = item.stage === "staging_qa" || item.stage === "production_qa" || deploymentStagePattern.test(item.stage);
    if (!isDeploymentStage && !deploymentEvidenceTypePattern.test(item.type)) {
      return [];
    }
    return [{
      environment: environment ?? stage?.label ?? item.stage,
      revision: item.revision,
      url
    }];
  });
  const environmentPriority = (target: DeploymentQaTarget) => {
    if (/production|prod/i.test(target.environment)) return 0;
    if (/staging/i.test(target.environment)) return 1;
    if (/preview/i.test(target.environment)) return 2;
    return 3;
  };
  const unique = new Map<string, DeploymentQaTarget>();
  for (const target of targets.sort((left, right) => environmentPriority(left) - environmentPriority(right))) {
    if (!unique.has(target.url)) unique.set(target.url, target);
  }
  return [...unique.values()];
}
