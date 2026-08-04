import {
  canonicalizeCheckpointSet,
  normalizeAutoHuntWorkflow,
  resolveCheckpointPolicy,
  workflowWithEffectiveCheckpoints,
  type AutoHuntWorkflow,
  type AutoHuntWorkflowCheckpoint,
  type AutoHuntWorkflowInput,
} from "../../src/lib/auto-hunt-contract";

type ProjectPolicyRow = {
  workflow_json: string;
  mandatory_checkpoints_json: string | null;
  checkpoint_policy_revision: number;
};

type UserPolicyRow = {
  checkpoints_json: string;
  revision: number;
};

type StoredUserPolicyRow = UserPolicyRow & { user_id: string };

const parseCheckpoints = (value: string | null | undefined) => {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed) ? parsed as AutoHuntWorkflowCheckpoint[] : [];
};

export function isStoredWorkflowUnchanged(
  storedWorkflowJson: string | null | undefined,
  workflowInput: AutoHuntWorkflowInput | null | undefined,
) {
  if (!storedWorkflowJson) return false;
  const storedWorkflow = normalizeAutoHuntWorkflow(
    JSON.parse(storedWorkflowJson),
  );
  const nextWorkflow = normalizeAutoHuntWorkflow(workflowInput);
  return JSON.stringify(storedWorkflow) === JSON.stringify(nextWorkflow);
}

export async function loadWorkflowCheckpointPolicy(
  db: D1Database,
  projectId: string,
  userId?: string | null,
) {
  const project = await db
    .prepare(
      `select workflow_json, mandatory_checkpoints_json,
              checkpoint_policy_revision
       from briar_project_settings where project_id = ?`,
    )
    .bind(projectId)
    .first<ProjectPolicyRow>();
  const workflow = normalizeAutoHuntWorkflow(
    project?.workflow_json ? JSON.parse(project.workflow_json) : undefined,
  );
  // A null value means the project has never saved the v2 policy editor. Its
  // existing workflow checkpoints remain the lazy, backwards-compatible
  // mandatory policy until the first explicit save.
  const projectMandatory = project?.mandatory_checkpoints_json === null ||
      project?.mandatory_checkpoints_json === undefined
    ? [...workflow.execution.checkpoints]
    : parseCheckpoints(project.mandatory_checkpoints_json);
  const user = userId
    ? await db
        .prepare(
          `select checkpoints_json, revision
           from briar_user_workflow_checkpoint_defaults
           where project_id = ? and user_id = ?`,
        )
        .bind(projectId, userId)
        .first<UserPolicyRow>()
    : null;
  const policy = resolveCheckpointPolicy(
    workflow,
    projectMandatory,
    parseCheckpoints(user?.checkpoints_json),
  );
  return {
    workflow,
    ...policy,
    projectRevision: project?.checkpoint_policy_revision ?? 1,
    userRevision: user?.revision ?? 0,
  };
}

export async function workflowSnapshotForRun(
  db: D1Database,
  projectId: string,
  userId?: string | null,
): Promise<AutoHuntWorkflow> {
  const policy = await loadWorkflowCheckpointPolicy(db, projectId, userId);
  return workflowWithEffectiveCheckpoints(
    policy.workflow,
    policy.projectMandatory,
    policy.userDefaults,
  );
}

export async function assertStoredCheckpointPoliciesCompatible(
  db: D1Database,
  projectId: string,
  workflowInput: AutoHuntWorkflowInput | null | undefined,
) {
  const workflow = normalizeAutoHuntWorkflow(workflowInput);
  const [project, users] = await Promise.all([
    db
      .prepare(
        `select mandatory_checkpoints_json
         from briar_project_settings where project_id = ?`,
      )
      .bind(projectId)
      .first<{ mandatory_checkpoints_json: string | null }>(),
    db
      .prepare(
        `select user_id, checkpoints_json, revision
         from briar_user_workflow_checkpoint_defaults where project_id = ?`,
      )
      .bind(projectId)
      .all<StoredUserPolicyRow>(),
  ]);
  // Null is the lazy-upgrade sentinel: the replacement workflow's own
  // checkpoints become the mandatory policy, so there is no old set to carry.
  if (project?.mandatory_checkpoints_json !== null &&
      project?.mandatory_checkpoints_json !== undefined) {
    canonicalizeCheckpointSet(
      workflow,
      parseCheckpoints(project.mandatory_checkpoints_json),
      "project",
    );
  }
  for (const user of users.results) {
    canonicalizeCheckpointSet(
      workflow,
      parseCheckpoints(user.checkpoints_json),
      "user",
    );
  }
  return workflow;
}

export function checkpointPolicyJson(
  policy: Awaited<ReturnType<typeof loadWorkflowCheckpointPolicy>>,
) {
  return {
    availableBoundaries: policy.workflow.stages.flatMap((stage) => [
      { stage: stage.id, stageLabel: stage.label, position: "before" as const },
      { stage: stage.id, stageLabel: stage.label, position: "after" as const },
    ]),
    projectMandatory: policy.projectMandatory,
    userDefaults: policy.userDefaults,
    effective: policy.effective,
    projectRevision: policy.projectRevision,
    userRevision: policy.userRevision,
  };
}
