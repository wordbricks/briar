import {
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import type { ProjectSettingsRow } from "./project-settings-repository";
import type { checkpointPolicyJson } from "./workflow-policy";

export const settingsJson = (
  row: ProjectSettingsRow | null,
  checkpointPolicy?: ReturnType<typeof checkpointPolicyJson>,
) => {
  const settings = {
    velenOrg: row?.velen_org ?? null,
    dataSource: row?.data_source ?? null,
    linear: {
      enabled: row?.linear_enabled === 1,
      source: row?.linear_source ?? null,
      teamKey: row?.linear_team_key ?? null,
    },
    githubRepositoryId: row?.github_repository_id ?? null,
    githubRepository: row?.github_repository ?? null,
    workflow: row?.workflow_json
      ? normalizeAutoHuntWorkflow(JSON.parse(row.workflow_json))
      : cloneAutoHuntWorkflow(),
  };
  return checkpointPolicy ? { ...settings, checkpointPolicy } : settings;
};
