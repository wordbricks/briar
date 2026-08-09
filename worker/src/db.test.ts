import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
  repositoryWorkflowBootstrap,
} from "../../src/lib/auto-hunt-contract";
import type { HuntEventInput } from "./db";
import {
  acceptOrganizationInvitation,
  acceptIssueCreateProposal,
  acceptIssueUpdateProposal,
  acceptIssueReworkProposal,
  assertQueuedHuntClaim,
  claimNextProjectAgentTask,
  claimNextQueuedHuntRun,
  claimDueProjectAgentScheduleRun,
  addOrganizationMember,
  completeProjectAgentScheduleRun,
  completeIssueResultReview,
  createOrganization,
  createOrganizationInvitation,
  createIssueActionProposal,
  createIssueMessage,
  createProjectAgentTaskJob,
  createIssueReworkProposal,
  createProjectAgent,
  createProjectAgentSchedule,
  createProject,
  createIssueAttachments,
  createIssueDependency,
  createRunEvidenceImages,
  deleteAccountData,
  deleteProjectAgent,
  deleteIssue,
  transferIssue,
  deleteIssueDependency,
  deleteProjectAgentSchedule,
  deleteProject,
  findProjectIdByAgentTokenHash,
  getProject,
  getProjectSettings,
  getDashboardSyncCursor,
  getHuntRunForProject,
  getIssueAttachment,
  getIssueActionProposal,
  getOrganizationInvitationByTokenHash,
  getRunEvidenceImage,
  getIssueMessage,
  HuntClaimError,
  HuntTransitionError,
  listIssueAttachments,
  listIssueActionProposals,
  listIssueDependencies,
  listIssueConversationNotifications,
  listChannelConversationNotifications,
  listIssueMessages,
  listIssueThreadMessages,
  listIssueResultReviews,
  listIssueReworkProposals,
  updateIssueMessage,
  deleteIssueMessage,
  listInboxReadStates,
  listDashboardChanges,
  listDashboardRuns,
  listHuntRunEvents,
  listOrganizations,
  listOrganizationInvitations,
  listOrganizationMembers,
  listOrganizationUsageRuns,
  isOrganizationHandleAvailable,
  issueProjectAgentToken,
  listProjects,
  listProjectAgents,
  listProjectAgentSessions,
  listProjectAgentScheduleRuns,
  listProjectAgentSchedules,
  listRunEvidence,
  listRunEvidenceImages,
  moveHuntRun,
  planAccountDeletion,
  recoverHuntRun,
  reworkHuntRun,
  recordHuntEvent,
  recordRunEvidence,
  recordQaResult,
  resumeWorkflowCheckpoint,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  renewProjectAgentScheduleRunLease,
  completeProjectAgentTask,
  renewProjectAgentTaskLease,
  updateProjectSettings as persistProjectSettings,
  updateProjectAgent,
  updateProjectAgentSchedule,
  updateOrganization,
  updateOrganizationLogo,
  updateOrganizationMemberRole,
  updateProjectIcon,
  updateProjectIssueKeyPrefix,
  updateIssue,
  upsertInboxReadStates,
  upsertProjectAgentSession,
} from "./db";
import { registerExecutionWorker } from "./workers";

const releaseWorkflow = normalizeAutoHuntWorkflow({
  version: 2,
  requirements: [],
  stages: [
    { id: "analyzing", label: "Analyze", required: true },
    { id: "implementing", label: "Implement", required: true },
    { id: "pr_open", label: "Pull request", required: true },
    { id: "staging_qa", label: "Staging QA", required: true },
    { id: "production_qa", label: "Production QA", required: true },
  ],
  execution: {
    checkpoints: [{
      key: "project-after-production_qa",
      stage: "production_qa",
      position: "after",
    }],
  },
  completion: {
    requiredStages: [
      "analyzing",
      "implementing",
      "pr_open",
      "staging_qa",
      "production_qa",
    ],
  },
});
const pullRequestBoundaryWorkflow = normalizeAutoHuntWorkflow({
  version: 2,
  requirements: [],
  stages: releaseWorkflow.stages,
  execution: {
    checkpoints: [{
      key: "project-after-pr_open",
      stage: "pr_open",
      position: "after",
    }],
  },
  completion: releaseWorkflow.completion,
});
const localWorkflow = normalizeAutoHuntWorkflow({
  version: 2,
  requirements: [],
  stages: [
    { id: "analyzing", label: "Analyze", required: true },
    { id: "implementing", label: "Implement", required: true },
    {
      id: "local_qa",
      label: "Local validation",
      required: true,
      evidence: ["signoff/app-worker", "local QA"],
    },
  ],
  execution: {
    checkpoints: [{
      key: "project-after-local_qa",
      stage: "local_qa",
      position: "after",
    }],
  },
  completion: { requiredStages: ["analyzing", "implementing", "local_qa"] },
});
const revisionWorkflow = normalizeAutoHuntWorkflow({
  version: 2,
  requirements: [],
  stages: [
    {
      id: "analyzing",
      label: "Analyze",
      required: true,
      evidence: ["repository"],
    },
    {
      id: "implementing",
      label: "Implement",
      required: true,
      evidence: ["diff"],
    },
    {
      id: "reviewing",
      label: "Review",
      required: true,
      evidence: ["review_findings"],
    },
    {
      id: "local_qa",
      label: "Local QA",
      required: true,
      evidence: ["local_ci"],
    },
  ],
  execution: {
    checkpoints: [{
      key: "project-after-local_qa",
      stage: "local_qa",
      position: "after",
    }],
  },
  completion: {
    requiredStages: ["analyzing", "implementing", "reviewing", "local_qa"],
  },
});
const checkpointWorkflowSnapshot = (
  workflow: typeof releaseWorkflow,
  checkpointStage?: string,
) =>
  JSON.stringify({
    version: 2,
    requirements: workflow.requirements,
    stages: workflow.stages,
    execution: {
      checkpoints: [{
        key: `project-after-${checkpointStage ?? workflow.completion.requiredStages.at(-1)}`,
        stage: checkpointStage ?? workflow.completion.requiredStages.at(-1),
        position: "after",
      }],
    },
    completion: workflow.completion,
  });
const projectId = "11111111-1111-4111-8111-111111111111";
const baseTime = Date.parse("2026-07-21T00:00:00Z");
const atMinute = (minute: number) =>
  new Date(baseTime + minute * 60_000).toISOString();

const updateProjectSettings = async (
  db: D1Database,
  targetProjectId: string,
  input: Parameters<typeof persistProjectSettings>[2],
) => {
  const settings = await persistProjectSettings(db, targetProjectId, input);
  const workflow = normalizeAutoHuntWorkflow(input.workflow);
  await db
    .prepare(
      `update briar_project_settings
       set mandatory_checkpoints_json = ?
       where project_id = ?`,
    )
    .bind(JSON.stringify(workflow.execution.checkpoints), targetProjectId)
    .run();
  return settings;
};

const setStoredWorkflow = async (
  db: D1Database,
  targetProjectId: string,
  workflow: ReturnType<typeof normalizeAutoHuntWorkflow>,
) => {
  await db
    .prepare(
      `update briar_project_settings
       set workflow_json = ?, mandatory_checkpoints_json = ?
       where project_id = ?`,
    )
    .bind(
      JSON.stringify(workflow),
      JSON.stringify(workflow.execution.checkpoints),
      targetProjectId,
    )
    .run();
};
const completedStructuredResult = {
  summary: "Repository audit completed.",
  outcome: "completed",
  importance: "routine",
  urgency: "normal",
  impact: "issue",
  humanActionRequired: false,
  nextAction: null,
  dueAt: null,
} as const;
const executeSql = async (db: D1Database, sql: string) => {
  for (const statement of sql.split(/;\s*(?:\n|$)/u)) {
    if (statement.trim()) await db.prepare(statement).run();
  }
};

const executeTriggerMigration = async (db: D1Database, sql: string) => {
  let statement: string[] = [];
  let inTrigger = false;
  for (const line of sql.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed && statement.length === 0) continue;
    statement.push(line);
    if (/^create trigger\b/iu.test(trimmed)) inTrigger = true;
    const complete = inTrigger ? /^end;$/iu.test(trimmed) : trimmed.endsWith(";");
    if (!complete) continue;
    await db.prepare(statement.join("\n")).run();
    statement = [];
    inTrigger = false;
  }
  if (statement.some((line) => line.trim())) {
    throw new Error("Incomplete dashboard sync migration statement");
  }
};

const event = (
  stage: HuntEventInput["stage"],
  minute: number,
  overrides: Partial<HuntEventInput> = {},
): HuntEventInput => ({
  source: "issue",
  sourceKey: "integration-run",
  title: "D1 lifecycle integration",
  stage,
  eventKey: `integration:${stage}:${minute}`,
  occurredAt: atMinute(minute),
  actor: "vitest",
  repository: "example/repository",
  detail: `${stage} detail`,
  priority: null,
  branch: "codex/integration",
  commitSha: "abcdef1",
  tracker: null,
  issueDescription: null,
  resultSummary: null,
  structuredResult: null,
  pullRequestUrls: [],
  targetSha: null,
  sourceCreatedAt: null,
  qaStatus: null,
  stagingQaDetail: null,
  productionQaDetail: null,
  context: null,
  ...overrides,
});

describe("Briar Auto Hunt D1 lifecycle", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    d1Databases: { DB: "briar-test" },
  });
  let db: D1Database;

  const claimResumedRun = async (runId: string, minute: number) => {
    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "e".repeat(64),
      claimedBy: "resume-worker",
      claimedAt: atMinute(minute),
      leaseExpiresAt: atMinute(minute + 10),
      runId,
    });
    expect(claimed).toMatchObject({
      id: runId,
      status: "running",
      paused_at: null,
      resume_requested_at: expect.any(String),
    });
  };

  beforeAll(async () => {
    db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
    for (const migration of [
      "migrations/0001_briar.sql",
      "migrations/0002_remove_repository_path.sql",
      "migrations/0003_generalize_auto_hunt.sql",
      "migrations/0004_auto_hunt_claims.sql",
      "migrations/0005_auto_hunt_recovery.sql",
      "migrations/0006_issue_attachments.sql",
      "migrations/0007_configurable_workflows.sql",
      "migrations/0008_organizations.sql",
      "migrations/0009_auto_hunt_automation.sql",
      "migrations/0010_issue_messages.sql",
      "migrations/0011_issue_message_agents.sql",
      "migrations/0012_organization_handles.sql",
      "migrations/0013_execution_workers.sql",
      "migrations/0014_agent_provider_grok.sql",
    ]) {
      await executeSql(db, await readFile(resolve(migration), "utf8"));
    }
    await executeSql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('owner', 'Owner', 'owner@example.com', 1, '${atMinute(0)}', '${atMinute(0)}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values (
        '${projectId}', 'Example Org', 'example-org',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        '${projectId}', 'owner', 'owner', '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at
      ) values (
        '${projectId}', 'owner', '${projectId}', 'Example',
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_settings (
        project_id, velen_org, linear_enabled, workflow_json, created_at, updated_at
      ) values (
        '${projectId}', 'example', 0,
        '{"version":1,"preset":"release","stages":[{"id":"analyzing","label":"분석","required":true},{"id":"implementing","label":"구현","required":true},{"id":"pr_open","label":"PR 검증","required":true},{"id":"staging_qa","label":"Stage QA","required":true},{"id":"production_qa","label":"Production QA","required":true}]}',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_execution_workers (
        id, project_id, label, host_fingerprint, agent_provider, versions_json,
        state, last_heartbeat_at, created_at, updated_at
      ) values (
        'legacy-worker', '${projectId}', 'Legacy worker',
        'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
        'codex', '{"briar":"1.1.0"}', 'stale', '${atMinute(0)}',
        '${atMinute(0)}', '${atMinute(0)}'
      );
    `,
    );
    const migrationRunId = "99999999-9999-4999-8999-999999999999";
    await executeSql(
      db,
      `insert into briar_hunt_runs (
         id, project_id, source, source_key, title, stage, status,
         workflow_stage, detail, repository, branch, commit_sha, started_at,
         completed_at, last_event_at, created_at, updated_at
       ) values (
         '${migrationRunId}', '${projectId}', 'issue',
         'pre-backlog-migration', 'Pre-backlog migration sentinel',
         'cancelled', 'cancelled', null, 'cancelled detail',
         'example/repository', null, null, '${atMinute(1)}', '${atMinute(1)}',
         '${atMinute(1)}', '${atMinute(1)}', '${atMinute(1)}'
       );
       insert into briar_hunt_events (
         id, run_id, event_key, stage, status, workflow_stage, detail, actor,
         branch, commit_sha, occurred_at, recorded_at
       ) values (
         '88888888-8888-4888-8888-888888888888', '${migrationRunId}',
         'pre-backlog-migration:cancelled', 'cancelled', 'cancelled', null,
         'cancelled detail', 'vitest', null, null, '${atMinute(1)}',
         '${atMinute(1)}'
       );`,
    );
    await createIssueAttachments(db, projectId, migrationRunId, [
      {
        id: "11111111-2222-4333-8444-555555555555",
        object_key: "issue-attachments/pre-backlog-migration/sentinel",
        filename: "sentinel.png",
        content_type: "image/png",
        byte_size: 8,
      },
    ]);
    await createIssueMessage(db, {
      id: "66666666-7777-4888-8999-000000000000",
      projectId,
      runId: migrationRunId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "Preserve this message through the backlog migration.",
      createdAt: atMinute(1),
    });
    await executeSql(
      db,
      await readFile(resolve("migrations/0015_backlog_status.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0016_project_agents.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0017_default_auto_hunt_agent.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0018_project_agent_schedules.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0019_project_agent_schedule_runs.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0020_project_agent_calendar_color.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0021_run_evidence.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0022_remove_workflow_presets.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0023_project_agent_skills.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0024_project_agent_avatars.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0025_project_agent_codex_pets.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0026_flexible_project_agent_schedules.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0027_run_revisions.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0029_structured_agent_results.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0030_run_evidence_images.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0031_organization_logos.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0032_slack_integration.sql"), "utf8"),
    );
    await executeSql(
      db,
      `update briar_organizations
       set logo = 'data:image/webp;base64,bGVnYWN5'
       where id = '${projectId}'`,
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0033_organization_logo_browser_formats.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0034_execution_worker_credentials.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0035_detached_worker_dispatch.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0036_execution_worker_concurrency.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0037_workflow_stop_after_stage.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0038_project_execution_worker_policies.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0039_project_agent_tokens.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0040_run_execution_provider.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0041_issue_message_mentions.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0042_project_agent_sessions.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0043_execution_worker_icons.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0044_issue_agent_reply_jobs.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0045_issue_execution_preferences.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0046_project_icons.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0047_project_icon_browser_formats.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0048_issue_dependencies.sql"), "utf8"),
    );
    await executeTriggerMigration(
      db,
      await readFile(resolve("migrations/0049_dashboard_delta_sync.sql"), "utf8"),
    );
    await executeTriggerMigration(
      db,
      await readFile(resolve("migrations/0050_hunt_run_event_count.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0051_log_archives.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0051_user_profiles.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0052_project_agent_session_skipped.sql"),
        "utf8",
      ),
    );
    await executeTriggerMigration(
      db,
      await readFile(
        resolve("migrations/0053_issue_result_reviews.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0054_run_execution_metrics.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0057_organization_invitations.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0058_workflow_pause_after_stage.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0059_workflow_v2_progress.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0060_workflow_checkpoint_policies.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0061_resume_requested_state.sql"),
        "utf8",
      ),
    );
    await executeTriggerMigration(
      db,
      await readFile(
        resolve("migrations/0061_workflow_stage_status_events.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0062_issue_assignees.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0063_inbox_read_states.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0063_github_pull_request_sync.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0064_github_integration.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0065_issue_rework_proposals.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0066_normalize_project_workflows_v2.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0067_issue_checkpoints.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0068_issue_action_proposals.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0069_project_agent_effort.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0070_project_issue_key_prefix.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0056_ideas.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0071_organization_agents.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0072_organization_ideas.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0073_organization_channels.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(
        resolve("migrations/0077_project_agent_task_jobs.sql"),
        "utf8",
      ),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0079_agent_skills.sql"), "utf8"),
    );
    await executeSql(
      db,
      await readFile(resolve("migrations/0080_agent_skill_jobs.sql"), "utf8"),
    );
  }, 30_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("transfers an issue to another project with children and a source tombstone", async () => {
    const targetProjectId = "55555555-5555-4555-8555-555555555555";
    const attachmentId = "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1";
    const messageId = "f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2";
    await setStoredWorkflow(db, projectId, releaseWorkflow);
    await executeSql(
      db,
      `
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash, created_at, updated_at
      ) values (
        '${targetProjectId}', 'owner', '${projectId}', 'Target',
        'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_project_settings (
        project_id, velen_org, linear_enabled, workflow_json, github_repository,
        created_at, updated_at
      ) values (
        '${targetProjectId}', 'example', 0,
        '${JSON.stringify(localWorkflow).replace(/'/g, "''")}',
        'target/repository',
        '${atMinute(0)}', '${atMinute(0)}'
      );
    `,
    );

    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 80, {
        sourceKey: "transfer-issue-contract",
        eventKey: "transfer-issue-contract:queued",
        title: "Transfer me",
        status: "queued",
        branch: null,
        commitSha: null,
      }),
    );
    await createIssueAttachments(db, projectId, runId, [
      {
        id: attachmentId,
        object_key: "issue-attachments/source/transfer.png",
        filename: "transfer.png",
        content_type: "image/png",
        byte_size: 12,
      },
    ]);
    await createIssueMessage(db, {
      id: messageId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "Keep this conversation",
      createdAt: atMinute(81),
    });

    const sourceCursor = await getDashboardSyncCursor(db, projectId);
    const targetCursor = await getDashboardSyncCursor(db, targetProjectId);
    const outcome = await transferIssue(db, {
      sourceProjectId: projectId,
      targetProjectId,
      targetProjectName: "Target",
      runId,
      observedAt: atMinute(82),
    });
    expect(outcome).toBe("transferred");

    expect(await getHuntRunForProject(db, projectId, runId)).toBeNull();
    const moved = await getHuntRunForProject(db, targetProjectId, runId);
    expect(moved).toMatchObject({
      id: runId,
      project_id: targetProjectId,
      title: "Transfer me",
      repository: "target/repository",
    });
    expect(JSON.parse(moved!.workflow_snapshot_json).stages.map((s: { id: string }) => s.id))
      .toEqual(localWorkflow.stages.map((stage) => stage.id));

    const attachments = await listIssueAttachments(db, targetProjectId, runId);
    expect(attachments).toHaveLength(1);
    const messages = await listIssueMessages(db, targetProjectId, runId);
    expect(messages.map((message) => message.body)).toContain(
      "Keep this conversation",
    );

    const sourceChanges = await listDashboardChanges(db, projectId, sourceCursor);
    expect(sourceChanges.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: "run",
          entity_id: runId,
          operation: "delete",
        }),
      ]),
    );
    expect(await getDashboardSyncCursor(db, targetProjectId)).toBeGreaterThan(
      targetCursor,
    );
    const targetUpserts = await db
      .prepare(
        `select entity_type, entity_id, operation
         from briar_dashboard_changes
         where project_id = ? and entity_id = ? and operation = 'upsert'`,
      )
      .bind(targetProjectId, runId)
      .all<{ entity_type: string; entity_id: string; operation: string }>();
    expect(targetUpserts.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: "run",
          entity_id: runId,
          operation: "upsert",
        }),
      ]),
    );

    expect(
      await transferIssue(db, {
        sourceProjectId: projectId,
        targetProjectId,
        targetProjectName: "Target",
        runId,
        observedAt: atMinute(83),
      }),
    ).toBe("not_found");

    await setStoredWorkflow(db, projectId, repositoryWorkflowBootstrap);
  });

  it("records monotonic dashboard deltas and a deletion tombstone", async () => {
    await setStoredWorkflow(db, projectId, releaseWorkflow);
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 2, {
        sourceKey: "dashboard-delta-contract",
        eventKey: "dashboard-delta-contract:queued",
        title: "Dashboard delta contract",
        branch: null,
        commitSha: null,
      }),
    );
    const snapshotCursor = await getDashboardSyncCursor(db, projectId);

    await updateIssue(db, projectId, runId, {
      title: "Dashboard delta contract updated",
      description: "Only this run should be returned.",
      priority: 1,
      updatedAt: atMinute(3),
    });
    const updatePage = await listDashboardChanges(db, projectId, snapshotCursor);

    expect(updatePage.expired).toBe(false);
    expect(updatePage.nextCursor).toBeGreaterThan(snapshotCursor);
    expect(updatePage.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: "run",
          entity_id: runId,
          operation: "upsert",
        }),
      ]),
    );

    await deleteIssue(db, projectId, runId, atMinute(4));
    const deletePage = await listDashboardChanges(
      db,
      projectId,
      updatePage.nextCursor,
    );
    await setStoredWorkflow(db, projectId, repositoryWorkflowBootstrap);
    expect(deletePage.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entity_type: "run",
          entity_id: runId,
          operation: "delete",
        }),
      ]),
    );
    await db
      .prepare(
        `update briar_dashboard_changes
         set created_at = '2000-01-01 00:00:00'
         where project_id = ?`,
      )
      .bind(projectId)
      .run();
    await expect(listDashboardChanges(db, projectId, 0)).resolves.toMatchObject({
      expired: true,
      changes: [],
    });
  });

  it("preserves existing run data and child foreign keys in the backlog migration", async () => {
    const run = await db
      .prepare(
        `select id, stage, status from briar_hunt_runs
         where source_key = 'pre-backlog-migration'`,
      )
      .first<{ id: string; stage: string; status: string }>();

    expect(run).toMatchObject({ stage: "cancelled", status: "cancelled" });
    expect(
      await db
        .prepare("select event_count from briar_hunt_runs where id = ?")
        .bind(run!.id)
        .first<number>("event_count"),
    ).toBe(1);
    expect(
      JSON.parse((await getProjectSettings(db, projectId))!.workflow_json),
    ).toEqual(repositoryWorkflowBootstrap);
    expect(
      JSON.parse(
        (await getHuntRunForProject(db, projectId, run!.id))!
          .workflow_snapshot_json,
      ),
    ).not.toHaveProperty("preset");
    expect(
      await db
        .prepare(
          "select count(*) as count from briar_hunt_events where run_id = ?",
        )
        .bind(run!.id)
        .first<number>("count"),
    ).toBe(1);
    expect(
      await db
        .prepare(
          "select count(*) as count from briar_issue_attachments where run_id = ?",
        )
        .bind(run!.id)
        .first<number>("count"),
    ).toBe(1);
    expect(
      await db
        .prepare(
          "select count(*) as count from briar_issue_messages where run_id = ?",
        )
        .bind(run!.id)
        .first<number>("count"),
    ).toBe(1);
    expect(await db.prepare("pragma foreign_key_check").all()).toMatchObject({
      results: [],
    });
  });

  it("serves dashboard summaries without reading the event table", async () => {
    await updateProjectSettings(db, projectId, {
      velenOrg: "example",
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: null,
      workflow: releaseWorkflow,
    });
    const sourceKey = "dashboard-summary-read-model";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 1.1, {
        sourceKey,
        eventKey: `${sourceKey}:queued`,
      }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("analyzing", 1.2, {
        sourceKey,
        eventKey: `${sourceKey}:analyzing`,
      }),
    );
    await updateProjectSettings(db, projectId, {
      velenOrg: "example",
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: null,
      workflow: repositoryWorkflowBootstrap,
    });

    const summaries = await listDashboardRuns(db, projectId);
    const summary = summaries.find((candidate) => candidate.id === runId);
    expect(summary).toMatchObject({
      id: runId,
      event_count: 2,
      status: "running",
      workflow_stage: "analyzing",
    });
    expect(await listHuntRunEvents(db, projectId, runId)).toHaveLength(2);

    const plan = await db
      .prepare(
        `explain query plan
         select run.id, run.event_count
         from briar_hunt_runs run
         where run.project_id = ?
         order by
           case when run.status in ('completed', 'cancelled') then 1 else 0 end,
           run.updated_at desc
         limit 200`,
      )
      .bind(projectId)
      .all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toContain("briar_hunt_runs");
    expect(details).not.toContain("briar_hunt_events");
  });

  it("loads uncapped lightweight usage runs across an organization", async () => {
    const usageProject = await createProject(db, {
      ownerUserId: "owner",
      organizationId: projectId,
      name: "Usage Project",
      agentTokenHash: "1".repeat(64),
    });
    const recentAt = atMinute(200);
    await db
      .prepare(
        `with recursive sequence(value) as (
           values(1)
           union all
           select value + 1 from sequence where value < 205
         )
         insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           repository, started_at, completed_at, last_event_at, created_at,
           updated_at
         )
         select 'usage-cap-' || printf('%03d', value), ?, 'issue',
                'usage-cap-' || printf('%03d', value),
                'Usage run ' || value, 'completed', 'completed',
                'example/usage', ?, ?, ?, ?, ?
         from sequence`,
      )
      .bind(
        usageProject.id,
        recentAt,
        recentAt,
        recentAt,
        recentAt,
        recentAt,
      )
      .run();
    await db
      .prepare(
        `update briar_hunt_runs
         set execution_metrics_json = ?,
             requested_agent_provider = 'claude',
             requested_agent_model = 'opus'
         where id = 'usage-cap-001'`,
      )
      .bind(JSON.stringify({
        inputTokens: 10,
        outputTokens: 5,
        cacheReadTokens: 20,
        cacheWriteTokens: 2,
        reasoningOutputTokens: null,
        totalTokens: 37,
        durationMs: 1_000,
      }))
      .run();
    const oldAt = atMinute(99);
    await db
      .prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           repository, started_at, completed_at, last_event_at, created_at,
           updated_at
         ) values (
           'usage-before-range', ?, 'issue', 'usage-before-range',
           'Old usage run', 'completed', 'completed', 'example/usage',
           ?, ?, ?, ?, ?
         )`,
      )
      .bind(usageProject.id, oldAt, oldAt, oldAt, oldAt, oldAt)
      .run();
    await db
      .prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           repository, paused_at, started_at, completed_at, last_event_at,
           created_at, updated_at
         ) values
           (
             'usage-unclaimed', ?, 'issue', 'usage-unclaimed',
             'Unclaimed backlog item', 'queued', 'backlog', 'example/usage',
             null, ?, null, ?, ?, ?
           ),
           (
             'usage-unclaimed-queued', ?, 'issue', 'usage-unclaimed-queued',
             'Unclaimed queued item', 'queued', 'queued', 'example/usage',
             null, ?, null, ?, ?, ?
           ),
           (
             'usage-paused', ?, 'issue', 'usage-paused', 'Paused usage run',
             'queued', 'queued', 'example/usage', ?, ?, null, ?, ?, ?
           )`,
      )
      .bind(
        usageProject.id,
        recentAt,
        recentAt,
        recentAt,
        recentAt,
        usageProject.id,
        recentAt,
        recentAt,
        recentAt,
        recentAt,
        usageProject.id,
        recentAt,
        recentAt,
        recentAt,
        recentAt,
        recentAt,
      )
      .run();
    const otherOrganization = await createOrganization(db, {
      name: "Other Usage Organization",
      handle: "other-usage-organization",
      ownerUserId: "owner",
    });
    const otherProject = await createProject(db, {
      ownerUserId: "owner",
      organizationId: otherOrganization.id,
      name: "Other Usage Project",
      agentTokenHash: "f".repeat(64),
    });
    await db
      .prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, status,
           repository, started_at, completed_at, last_event_at, created_at,
           updated_at
         ) values (
           'usage-other-organization', ?, 'issue', 'usage-other-organization',
           'Other organization usage', 'completed', 'completed',
           'example/other', ?, ?, ?, ?, ?
         )`,
      )
      .bind(
        otherProject.id,
        recentAt,
        recentAt,
        recentAt,
        recentAt,
        recentAt,
      )
      .run();

    const rows = await listOrganizationUsageRuns(
      db,
      projectId,
      atMinute(100),
    );
    const usageProjectRows = rows.filter(
      (row) => row.project_id === usageProject.id,
    );

    expect(
      usageProjectRows.filter((row) => row.id.startsWith("usage-cap-")),
    ).toHaveLength(205);
    expect(rows.some((row) => row.id === "usage-before-range")).toBe(false);
    expect(rows.some((row) => row.id === "usage-unclaimed")).toBe(false);
    expect(
      rows.some((row) => row.id === "usage-unclaimed-queued"),
    ).toBe(false);
    expect(rows.some((row) => row.id === "usage-paused")).toBe(true);
    expect(
      rows.some((row) => row.id === "usage-other-organization"),
    ).toBe(false);
    expect(usageProjectRows[0]).not.toHaveProperty("workflow_snapshot_json");
    expect(
      usageProjectRows.find((row) => row.id === "usage-cap-001"),
    ).toMatchObject({
      requested_agent_provider: "claude",
      requested_agent_model: "opus",
      execution_provider: "claude",
      execution_model: "opus",
    });
  });

  it("synchronizes the newest project agent session snapshot", async () => {
    const sessionId = "77777777-7777-4777-8777-777777777777";
    const payload = {
      dispatchGroupId: "",
      agentId: null,
      sessionType: "task",
      trigger: "manual",
      scheduleId: null,
      scheduleRunId: null,
      parentSessionId: null,
      request: "Review the repository",
      status: "running",
      issues: [],
      startedAt: atMinute(2),
      completedAt: null,
      conversationId: null,
      summary: null,
      error: null,
      events: [],
      updatedAt: atMinute(2),
    };
    await upsertProjectAgentSession(db, {
      project_id: projectId,
      id: sessionId,
      agent_id: null,
      status: "running",
      session_type: "task",
      payload_json: JSON.stringify(payload),
      started_at: atMinute(2),
      completed_at: null,
      updated_at: atMinute(2),
    });
    await upsertProjectAgentSession(db, {
      project_id: projectId,
      id: sessionId,
      agent_id: null,
      status: "failed",
      session_type: "task",
      payload_json: JSON.stringify({ ...payload, status: "failed" }),
      started_at: atMinute(2),
      completed_at: atMinute(1),
      updated_at: atMinute(1),
    });

    const sessions = await listProjectAgentSessions(db, projectId);
    expect(sessions).toEqual([
      expect.objectContaining({
        id: sessionId,
        status: "running",
        updated_at: atMinute(2),
      }),
    ]);
  });

  it("persists skipped project agent session snapshots", async () => {
    const sessionId = "66666666-6666-4666-8666-666666666666";
    await upsertProjectAgentSession(db, {
      project_id: projectId,
      id: sessionId,
      agent_id: null,
      status: "skipped",
      session_type: "task",
      payload_json: JSON.stringify({ status: "skipped" }),
      started_at: atMinute(2),
      completed_at: atMinute(3),
      updated_at: atMinute(3),
    });

    await expect(
      db.prepare(
        "select status from briar_project_agent_sessions where project_id = ? and id = ?",
      ).bind(projectId, sessionId).first<{ status: string }>(),
    ).resolves.toEqual({ status: "skipped" });
  });

  it("backfills legacy workers as organization devices without issuing credentials", async () => {
    const binding = await db
      .prepare(
        `select project_id, device_id
         from briar_execution_workers
         where id = 'legacy-worker'`,
      )
      .first<{ project_id: string; device_id: string }>();
    expect(binding).toEqual({
      project_id: projectId,
      device_id: "legacy-worker",
    });
    const device = await db
      .prepare(
        `select organization_id, owner_user_id, state
         from briar_execution_worker_devices
         where id = 'legacy-worker'`,
      )
      .first<{
        organization_id: string;
        owner_user_id: string;
        state: string;
      }>();
    expect(device).toEqual({
      organization_id: projectId,
      owner_user_id: "owner",
      state: "stale",
    });
    expect(
      await db
        .prepare(
          `select token_hash from briar_execution_worker_credentials
           where device_id = 'legacy-worker'`,
        )
        .first(),
    ).toBeNull();
  });

  it("keeps the default project agent as a regular agent", async () => {
    await expect(listProjectAgents(db, projectId)).resolves.toEqual([
      expect.objectContaining({
        project_id: projectId,
        name: "Developer agent",
        avatar: null,
        provider: "codex",
        model: null,
        responsibility: "Perform Auto Hunt for every queued issue.",
        skill_markdown: expect.stringContaining("attached project workflow"),
        skills: [
          expect.objectContaining({
            name: "Issue processing",
            provider: "codex",
            kind: "issue_processing",
            is_default: 1,
          }),
        ],
        calendar_color: "#3275d5",
      }),
    ]);
  });

  it("localizes the default Developer Agent and Issue processing Skill", async () => {
    const localizedProject = await createProject(db, {
      ownerUserId: "owner",
      organizationId: projectId,
      name: "한국어 프로젝트",
      agentTokenHash: "7".repeat(64),
      locale: "ko",
    });

    await expect(listProjectAgents(db, localizedProject.id)).resolves.toEqual([
      expect.objectContaining({
        name: "개발자 에이전트",
        responsibility: "대기 중인 모든 이슈를 처리합니다.",
        skills: [
          expect.objectContaining({
            name: "이슈 처리",
            instructions: "대기 중인 모든 이슈를 처리합니다.",
            kind: "issue_processing",
            is_default: 1,
          }),
        ],
      }),
    ]);

    await expect(
      deleteProject(db, localizedProject.id, "owner"),
    ).resolves.toBe(true);
  });

  it("pins a direct Agent task to the selected Worker through completion", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const skill = agent.skills[0];
    const selected = await registerExecutionWorker(db, projectId, {
      id: "direct-task-worker-selected",
      deviceId: "direct-task-device-selected",
      organizationId: projectId,
      ownerUserId: "owner",
      label: "Selected direct task Worker",
      deviceIdentityHash: "d".repeat(64),
      credentialTokenHash: "e".repeat(64),
      agentProvider: "codex",
      providers: ["codex"],
      providerHealth: {
        codex: { installed: true, authenticated: true, healthy: true },
      },
      versions: { briar: "1.1.1" },
      observedAt: atMinute(10),
    });
    const other = await registerExecutionWorker(db, projectId, {
      id: "direct-task-worker-other",
      deviceId: "direct-task-device-other",
      organizationId: projectId,
      ownerUserId: "owner",
      label: "Other direct task Worker",
      deviceIdentityHash: "f".repeat(64),
      credentialTokenHash: "0".repeat(64),
      agentProvider: "codex",
      providers: ["codex"],
      providerHealth: {
        codex: { installed: true, authenticated: true, healthy: true },
      },
      versions: { briar: "1.1.1" },
      observedAt: atMinute(10),
    });
    const taskId = "55555555-5555-4555-8555-555555555555";
    const requestId = "44444444-4444-4444-8444-444444444444";
    const claimTokenHash = "1".repeat(64);

    try {
      await expect(
        createProjectAgentTaskJob(db, {
          id: taskId,
          projectId,
          agentId: agent.id,
          skillId: skill.id,
          request: "Summarize the repository without processing queued issues.",
          requestId,
          workerId: selected.worker.id,
          createdAt: atMinute(11),
        }),
      ).resolves.toMatchObject({
        id: taskId,
        status: "queued",
        preferred_worker_id: selected.worker.id,
      });

      await expect(
        claimNextProjectAgentTask(db, projectId, {
          workerId: other.worker.id,
          agentProviders: ["codex"],
          claimTokenHash,
          claimedAt: atMinute(12),
          leaseExpiresAt: atMinute(14),
        }),
      ).resolves.toBeNull();

      const claimed = await claimNextProjectAgentTask(db, projectId, {
        workerId: selected.worker.id,
        agentProviders: ["codex"],
        claimTokenHash,
        claimedAt: atMinute(12),
        leaseExpiresAt: atMinute(14),
      });
      expect(claimed).toMatchObject({
        id: taskId,
        request: "Summarize the repository without processing queued issues.",
        preferred_worker_id: selected.worker.id,
        claimed_worker_id: selected.worker.id,
        status: "running",
        attempts: 1,
        agent_provider: "codex",
        agent_skill: skill.instructions,
        selected_skill_id: skill.id,
        selected_skill_instructions: skill.instructions,
      });

      await expect(
        renewProjectAgentTaskLease(db, projectId, taskId, {
          workerId: selected.worker.id,
          claimTokenHash,
          leaseExpiresAt: atMinute(15),
          updatedAt: atMinute(13),
        }),
      ).resolves.toMatchObject({
        id: taskId,
        lease_expires_at: atMinute(15),
      });

      await expect(
        completeProjectAgentTask(db, projectId, taskId, {
          workerId: selected.worker.id,
          claimTokenHash,
          updatedAt: atMinute(14),
        }),
      ).resolves.toMatchObject({
        id: taskId,
        status: "completed",
        preferred_worker_id: selected.worker.id,
        claimed_worker_id: null,
        completed_at: atMinute(14),
      });
    } finally {
      await executeSql(
        db,
        `delete from briar_project_agent_task_jobs where id = '${taskId}';
         delete from briar_execution_worker_credentials
         where device_id in ('${selected.device.id}', '${other.device.id}');
         delete from briar_execution_workers
         where id in ('${selected.worker.id}', '${other.worker.id}');
         delete from briar_execution_worker_devices
         where id in ('${selected.device.id}', '${other.device.id}');`,
      );
    }
  });

  it("creates and lists custom agents scoped to a project", async () => {
    const agent = await createProjectAgent(db, projectId, {
      name: "Sentry 오류 탐지 에이전트",
      provider: "claude",
      model: "opus",
      effort: null,
      responsibility:
        "Sentry 오류를 분석해 이슈를 만들고 담당자에게 배정합니다.",
      calendarColor: "#8b5cf6",
    });

    expect(agent).toMatchObject({
      project_id: projectId,
      name: "Sentry 오류 탐지 에이전트",
      provider: "claude",
      model: "opus",
      skill_markdown: expect.stringContaining(
        "Sentry 오류를 분석해 이슈를 만들고 담당자에게 배정합니다.",
      ),
      calendar_color: "#8b5cf6",
    });
    await expect(listProjectAgents(db, projectId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Developer agent" }),
        agent,
      ]),
    );
    await expect(
      listProjectAgents(db, "22222222-2222-4222-8222-222222222222"),
    ).resolves.toEqual([]);
  });

  it("deletes an agent only within its project and cascades its schedules", async () => {
    const agent = await createProjectAgent(db, projectId, {
      name: "Disposable agent",
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Validate deletion behavior.",
      calendarColor: "#d97706",
    });
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Disposable schedule",
      recurrence: "daily",
      timeOfDay: "09:00",
      dayOfWeek: null,
      timeZone: "Asia/Seoul",
    });
    expect(schedule).not.toBeNull();

    const claimed = await claimDueProjectAgentScheduleRun(db, projectId, {
      claimTokenHash: "f".repeat(64),
      observedAt: "2099-07-29T00:00:00.000Z",
    });
    expect(claimed).not.toBeNull();
    await expect(deleteProjectAgent(db, projectId, agent.id)).resolves.toBe(
      "running",
    );
    await db
      .prepare(
        `update briar_project_agent_schedule_runs
         set status = 'failed', completed_at = updated_at
         where id = ?`,
      )
      .bind(claimed!.id)
      .run();

    await expect(
      deleteProjectAgent(db, "22222222-2222-4222-8222-222222222222", agent.id),
    ).resolves.toBeNull();
    await expect(
      deleteProjectAgent(db, projectId, agent.id),
    ).resolves.toMatchObject({
      id: agent.id,
      project_id: projectId,
    });
    await expect(listProjectAgents(db, projectId)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: agent.id })]),
    );
    await expect(listProjectAgentSchedules(db, projectId)).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: schedule!.id })]),
    );
  });

  it("creates recurring schedules for an agent in the same project", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Weekday repository audit",
      recurrence: "weekdays",
      timeOfDay: "09:00",
      dayOfWeek: null,
      timeZone: "Asia/Seoul",
    });

    expect(schedule).toMatchObject({
      project_id: projectId,
      agent_id: agent.id,
      agent_name: "Developer agent",
      agent_provider: "codex",
      name: "Weekday repository audit",
      recurrence: "weekdays",
      time_of_day: "09:00",
      day_of_week: null,
      time_zone: "Asia/Seoul",
      enabled: 1,
    });
    await expect(listProjectAgentSchedules(db, projectId)).resolves.toEqual([
      schedule,
    ]);
    await expect(
      createProjectAgentSchedule(db, projectId, {
        agentId: "22222222-2222-4222-8222-222222222222",
        name: "Missing agent",
        recurrence: "daily",
        timeOfDay: "12:00",
        dayOfWeek: null,
        timeZone: "Etc/UTC",
      }),
    ).resolves.toBeNull();
  });

  it("updates and deletes a recurring schedule within its project", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Original schedule",
      recurrence: "daily",
      timeOfDay: "08:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
    });

    await expect(
      updateProjectAgentSchedule(db, projectId, schedule!.id, {
        agentId: agent.id,
        name: "Weekly release review",
        recurrence: "weekly",
        timeOfDay: "16:30",
        dayOfWeek: 5,
        timeZone: "Asia/Seoul",
      }),
    ).resolves.toMatchObject({
      id: schedule!.id,
      name: "Weekly release review",
      recurrence: "weekly",
      time_of_day: "16:30",
      day_of_week: 5,
      time_zone: "Asia/Seoul",
    });
    await expect(
      updateProjectAgentSchedule(
        db,
        "22222222-2222-4222-8222-222222222222",
        schedule!.id,
        {
          agentId: agent.id,
          name: "Wrong project",
          recurrence: "daily",
          timeOfDay: "09:00",
          dayOfWeek: null,
          timeZone: "Etc/UTC",
        },
      ),
    ).resolves.toBeNull();
    await expect(
      deleteProjectAgentSchedule(
        db,
        "22222222-2222-4222-8222-222222222222",
        schedule!.id,
      ),
    ).resolves.toBe("not_found");
    await expect(
      deleteProjectAgentSchedule(db, projectId, schedule!.id),
    ).resolves.toBe("deleted");
    await expect(
      deleteProjectAgentSchedule(db, projectId, schedule!.id),
    ).resolves.toBe("not_found");
  });

  it("persists a custom multi-day cadence and notification preference", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Alternating release checks",
      recurrence: "custom",
      timeOfDay: "09:00",
      dayOfWeek: null,
      intervalValue: 2,
      intervalUnit: "week",
      daysOfWeek: [1, 3, 5],
      notificationLevel: "none",
      timeZone: "Etc/UTC",
    });

    expect(schedule).toMatchObject({
      recurrence: "daily",
      frequency: "custom",
      interval_value: 2,
      interval_unit: "week",
      days_of_week: "1,3,5",
      notification_level: "none",
    });
    await expect(
      deleteProjectAgentSchedule(db, projectId, schedule!.id),
    ).resolves.toBe("deleted");
  });

  it("claims a due schedule once and advances its next occurrence", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Daily project audit",
      recurrence: "daily",
      timeOfDay: "09:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
    });
    expect(schedule).not.toBeNull();
    await db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = '2026-07-27T09:00:00.000Z'
         where id = ?`,
      )
      .bind(schedule!.id)
      .run();

    const claimed = await claimDueProjectAgentScheduleRun(db, projectId, {
      claimTokenHash: "a".repeat(64),
      observedAt: "2026-07-27T09:00:10.000Z",
    });
    expect(claimed).toMatchObject({
      schedule_id: schedule!.id,
      schedule_name: "Daily project audit",
      agent_provider: "codex",
      agent_responsibility: "Perform Auto Hunt for every queued issue.",
      agent_skill_markdown: "Perform Auto Hunt for every queued issue.",
      agent_skills: [
        expect.objectContaining({
          name: "Issue processing",
          kind: "issue_processing",
          is_default: 1,
        }),
      ],
      workflow_json: expect.any(String),
      status: "running",
      scheduled_for: "2026-07-27T09:00:00.000Z",
    });
    expect(JSON.parse(claimed!.workflow_json)).toEqual(
      cloneAutoHuntWorkflow(),
    );
    await expect(
      claimDueProjectAgentScheduleRun(db, projectId, {
        claimTokenHash: "b".repeat(64),
        observedAt: "2026-07-27T09:00:10.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      deleteProjectAgentSchedule(db, projectId, schedule!.id),
    ).resolves.toBe("running");
    await expect(
      db
        .prepare(
          `select next_run_at from briar_project_agent_schedules where id = ?`,
        )
        .bind(schedule!.id)
        .first<string>("next_run_at"),
    ).resolves.toBe("2026-07-28T09:00:00.000Z");
    await expect(
      completeProjectAgentScheduleRun(db, projectId, claimed!.id, {
        claimTokenHash: "a".repeat(64),
        status: "completed",
        resultSummary: "Daily audit completed.",
        structuredResult: {
          ...completedStructuredResult,
          summary: "Daily audit completed.",
        },
        error: null,
        observedAt: "2026-07-27T09:01:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "completed" });
    await expect(listProjectAgentScheduleRuns(db, projectId)).resolves.toEqual([
      expect.objectContaining({
        id: claimed!.id,
        agent_id: agent.id,
        agent_name: "Developer agent",
        agent_skills: [
          expect.objectContaining({ name: "Issue processing" }),
        ],
        schedule_name: "Daily project audit",
        status: "completed",
        result_summary: "Daily audit completed.",
        structured_result_json: JSON.stringify({
          ...completedStructuredResult,
          summary: "Daily audit completed.",
        }),
      }),
    ]);
    await expect(
      listProjectAgentScheduleRuns(db, "22222222-2222-4222-8222-222222222222"),
    ).resolves.toEqual([]);
  });

  it("requires the active claim token to complete a scheduled run", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Result reporter",
      recurrence: "daily",
      timeOfDay: "10:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
    });
    await db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = '2026-07-27T10:00:00.000Z'
         where id = ?`,
      )
      .bind(schedule!.id)
      .run();
    const tokenHash = "c".repeat(64);
    const claimed = await claimDueProjectAgentScheduleRun(db, projectId, {
      claimTokenHash: tokenHash,
      observedAt: "2026-07-27T10:00:05.000Z",
    });

    await expect(
      completeProjectAgentScheduleRun(db, projectId, claimed!.id, {
        claimTokenHash: "d".repeat(64),
        status: "completed",
        resultSummary: "must not persist",
        structuredResult: {
          ...completedStructuredResult,
          summary: "must not persist",
        },
        error: null,
        observedAt: "2026-07-27T10:01:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      completeProjectAgentScheduleRun(db, projectId, claimed!.id, {
        claimTokenHash: tokenHash,
        status: "completed",
        resultSummary: "Repository audit completed.",
        structuredResult: completedStructuredResult,
        error: null,
        observedAt: "2026-07-27T10:01:00.000Z",
      }),
    ).resolves.toMatchObject({
      status: "completed",
      result_summary: "Repository audit completed.",
      completed_at: "2026-07-27T10:01:00.000Z",
    });
  });

  it("renews and safely reclaims an expired schedule execution", async () => {
    const agent = (await listProjectAgents(db, projectId))[0];
    const schedule = await createProjectAgentSchedule(db, projectId, {
      agentId: agent.id,
      name: "Lease recovery",
      recurrence: "daily",
      timeOfDay: "11:00",
      dayOfWeek: null,
      timeZone: "Etc/UTC",
    });
    await db
      .prepare(
        `update briar_project_agent_schedules
         set next_run_at = '2026-07-27T11:00:00.000Z'
         where id = ?`,
      )
      .bind(schedule!.id)
      .run();
    const originalHash = "e".repeat(64);
    const claimed = await claimDueProjectAgentScheduleRun(db, projectId, {
      claimTokenHash: originalHash,
      observedAt: "2026-07-27T11:00:00.000Z",
    });
    await expect(
      renewProjectAgentScheduleRunLease(db, projectId, claimed!.id, {
        claimTokenHash: originalHash,
        observedAt: "2026-07-27T12:00:00.000Z",
      }),
    ).resolves.toMatchObject({
      id: claimed!.id,
      lease_expires_at: "2026-07-27T14:00:00.000Z",
    });

    await expect(
      claimDueProjectAgentScheduleRun(db, projectId, {
        claimTokenHash: "f".repeat(64),
        observedAt: "2026-07-27T13:00:00.000Z",
      }),
    ).resolves.toBeNull();
    await expect(
      claimDueProjectAgentScheduleRun(db, projectId, {
        claimTokenHash: "f".repeat(64),
        observedAt: "2026-07-27T14:00:01.000Z",
      }),
    ).resolves.toMatchObject({
      id: claimed!.id,
      schedule_id: schedule!.id,
      started_at: "2026-07-27T14:00:01.000Z",
    });
  });

  it("updates a project agent only within its project", async () => {
    const current = (await listProjectAgents(db, projectId))[0];
    const avatar = "data:image/png;base64,aA==";
    const codexPet = {
      json: JSON.stringify({
        slug: "firefly--lingxiaotian",
        name: "Firefly",
        author: "Lingxiaotian",
        license: "CC BY-NC 4.0",
        spriteVersion: 1,
      }),
      objectKey: "project-agent-spritesheets/project/agent/firefly.webp",
    };
    const updated = await updateProjectAgent(db, projectId, current.id, {
      name: "Release coordinator",
      avatar,
      codexPet,
      provider: "claude",
      model: "sonnet",
      effort: "high",
      responsibility: "Coordinates release checks and reports the result.",
      skills: [
        {
          id: current.skills[0].id,
          name: "Issue processing",
          instructions: "Process queued issues.",
          provider: "codex",
          model: null,
          effort: "medium",
          kind: "issue_processing",
          isDefault: false,
          position: 0,
        },
        {
          name: "Desktop release",
          instructions: "Publish and verify the desktop release.",
          provider: "claude",
          model: "sonnet",
          effort: "high",
          kind: "custom",
          isDefault: true,
          position: 1,
        },
      ],
      calendarColor: "#0f9f76",
    });

    expect(updated).toMatchObject({
      id: current.id,
      project_id: projectId,
      name: "Release coordinator",
      avatar,
      avatar_pet_json: codexPet.json,
      avatar_spritesheet_object_key: codexPet.objectKey,
      provider: "claude",
      model: "sonnet",
      effort: "high",
      responsibility: "Coordinates release checks and reports the result.",
      skills: [
        expect.objectContaining({
          name: "Issue processing",
          provider: "codex",
          kind: "issue_processing",
          is_default: 0,
        }),
        expect.objectContaining({
          name: "Desktop release",
          provider: "claude",
          model: "sonnet",
          effort: "high",
          is_default: 1,
        }),
      ],
      skill_markdown: expect.stringContaining(
        "Coordinates release checks and reports the result.",
      ),
      calendar_color: "#0f9f76",
    });
    await expect(
      updateProjectAgent(
        db,
        "22222222-2222-4222-8222-222222222222",
        current.id,
        {
          name: "Wrong project",
          provider: "grok",
          model: null,
          effort: null,
          responsibility: "Must not update another project.",
          calendarColor: "#d97706",
        },
      ),
    ).resolves.toBeNull();
  });

  it("preserves retained Skill job references across name and default swaps", async () => {
    const agent = await createProjectAgent(db, projectId, {
      name: "Durable skill agent",
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Exercises durable Skill identity during profile edits.",
      skills: [
        {
          name: "Issue processing",
          instructions: "Process queued issues.",
          provider: "codex",
          model: null,
          effort: "medium",
          kind: "issue_processing",
          isDefault: true,
          position: 0,
        },
        {
          name: "Desktop release",
          instructions: "Publish the desktop release.",
          provider: "claude",
          model: "sonnet",
          effort: "high",
          kind: "custom",
          isDefault: false,
          position: 1,
        },
      ],
      calendarColor: "#3275d5",
    });
    const issueSkill = agent.skills.find(
      (skill) => skill.name === "Issue processing",
    )!;
    const releaseSkill = agent.skills.find(
      (skill) => skill.name === "Desktop release",
    )!;
    const taskId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

    try {
      await createProjectAgentTaskJob(db, {
        id: taskId,
        projectId,
        agentId: agent.id,
        skillId: releaseSkill.id,
        request: "Run the retained release Skill.",
        requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        workerId: "legacy-worker",
        createdAt: atMinute(20),
      });

      await expect(
        updateProjectAgent(db, projectId, agent.id, {
          name: "Must not partially update",
          provider: agent.provider,
          model: agent.model,
          effort: agent.effort,
          responsibility: agent.responsibility,
          skills: [
            {
              id: issueSkill.id,
              name: issueSkill.name,
              instructions: issueSkill.instructions,
              provider: issueSkill.provider,
              model: issueSkill.model,
              effort: issueSkill.effort,
              kind: issueSkill.kind,
              isDefault: true,
              position: 0,
            },
          ],
          calendarColor: agent.calendar_color,
        }),
      ).rejects.toThrow("cannot be deleted while queued or running work");
      await expect(
        db
          .prepare(
            `select skill_id from briar_project_agent_task_jobs where id = ?`,
          )
          .bind(taskId)
          .first<{ skill_id: string | null }>(),
      ).resolves.toEqual({ skill_id: releaseSkill.id });
      expect(
        (await listProjectAgents(db, projectId)).find(
          (candidate) => candidate.id === agent.id,
        )?.name,
      ).toBe("Durable skill agent");

      const updated = await updateProjectAgent(db, projectId, agent.id, {
        name: agent.name,
        provider: agent.provider,
        model: agent.model,
        effort: agent.effort,
        responsibility: agent.responsibility,
        skills: [
          {
            id: issueSkill.id,
            name: "Desktop release",
            instructions: issueSkill.instructions,
            provider: issueSkill.provider,
            model: issueSkill.model,
            effort: issueSkill.effort,
            kind: issueSkill.kind,
            isDefault: false,
            position: 0,
          },
          {
            id: releaseSkill.id,
            name: "Issue processing",
            instructions: releaseSkill.instructions,
            provider: releaseSkill.provider,
            model: releaseSkill.model,
            effort: releaseSkill.effort,
            kind: releaseSkill.kind,
            isDefault: true,
            position: 1,
          },
        ],
        calendarColor: agent.calendar_color,
      });

      expect(updated?.skills).toEqual([
        expect.objectContaining({
          id: issueSkill.id,
          name: "Desktop release",
          is_default: 0,
        }),
        expect.objectContaining({
          id: releaseSkill.id,
          name: "Issue processing",
          is_default: 1,
        }),
      ]);
      await expect(
        db
          .prepare(
            `select skill_id from briar_project_agent_task_jobs where id = ?`,
          )
          .bind(taskId)
          .first<{ skill_id: string | null }>(),
      ).resolves.toEqual({ skill_id: releaseSkill.id });
    } finally {
      await db
        .prepare(`delete from briar_project_agent_task_jobs where id = ?`)
        .bind(taskId)
        .run();
      await deleteProjectAgent(db, projectId, agent.id);
    }
  });

  it("applies legacy Agent execution updates to the default Skill", async () => {
    const agent = await createProjectAgent(db, projectId, {
      name: "Legacy settings agent",
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Run with the original default Skill settings.",
      calendarColor: "#3275d5",
    });

    try {
      const updated = await updateProjectAgent(db, projectId, agent.id, {
        name: agent.name,
        provider: "claude",
        model: "sonnet",
        effort: "high",
        responsibility: "Run with the settings saved by a legacy client.",
        calendarColor: agent.calendar_color,
      });

      expect(updated).toMatchObject({
        provider: "claude",
        model: "sonnet",
        effort: "high",
        responsibility: "Run with the settings saved by a legacy client.",
        skills: [
          expect.objectContaining({
            id: agent.skills[0].id,
            instructions: "Run with the settings saved by a legacy client.",
            provider: "claude",
            model: "sonnet",
            effort: "high",
            is_default: 1,
          }),
        ],
      });
    } finally {
      await deleteProjectAgent(db, projectId, agent.id);
    }
  });

  it("rolls back an Agent update when a Skill ID belongs to another Agent", async () => {
    const owner = (await listProjectAgents(db, projectId))[0];
    const agent = await createProjectAgent(db, projectId, {
      name: "Collision target",
      provider: "codex",
      model: null,
      effort: null,
      responsibility: "Must remain unchanged after a conflicting update.",
      calendarColor: "#3275d5",
    });

    try {
      await expect(
        updateProjectAgent(db, projectId, agent.id, {
          name: "Must roll back",
          provider: "claude",
          model: "sonnet",
          effort: "high",
          responsibility: "This profile update must roll back atomically.",
          skills: [
            {
              id: owner.skills[0].id,
              name: "Stolen Skill",
              instructions: "Must never move between Agents.",
              provider: "claude",
              model: "sonnet",
              effort: "high",
              kind: "custom",
              isDefault: true,
              position: 0,
            },
          ],
          calendarColor: "#0f9f76",
        }),
      ).rejects.toThrow();

      const persisted = (await listProjectAgents(db, projectId)).find(
        (candidate) => candidate.id === agent.id,
      );
      expect(persisted).toMatchObject({
        name: "Collision target",
        provider: "codex",
        model: null,
        effort: null,
        responsibility: "Must remain unchanged after a conflicting update.",
        calendar_color: "#3275d5",
      });
      expect(persisted?.skills).toEqual([
        expect.objectContaining({ id: agent.skills[0].id }),
      ]);
      expect(
        (await listProjectAgents(db, projectId))[0].skills[0].id,
      ).toBe(owner.skills[0].id);
    } finally {
      await deleteProjectAgent(db, projectId, agent.id);
    }
  });

  it("allows duplicate organization names but enforces unique handles", async () => {
    await expect(
      isOrganizationHandleAvailable(db, "another-example"),
    ).resolves.toBe(true);
    const organization = await createOrganization(db, {
      name: "Example Org",
      handle: "another-example",
      ownerUserId: "owner",
    });

    expect(organization.name).toBe("Example Org");
    expect(organization.handle).toBe("another-example");
    await expect(
      isOrganizationHandleAvailable(db, "another-example"),
    ).resolves.toBe(false);
    await expect(
      createOrganization(db, {
        name: "A different name",
        handle: "another-example",
        ownerUserId: "owner",
      }),
    ).rejects.toThrow();
  });

  it("links pull request evidence to its issue run", async () => {
    await updateProjectSettings(db, projectId, {
      velenOrg: "example",
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: "example/repository",
      workflow: releaseWorkflow,
    });
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 12.1, {
        sourceKey: "pull-request-evidence-run",
        eventKey: "pull-request-evidence-run:queued",
      }),
    );
    const pullRequestUrl = "https://github.com/example/repository/pull/42";
    const evidenceInput = {
      runId,
      evidenceKey: "pr_open:pull_request",
      stage: "pr_open",
      type: "pull_request",
      status: "passed" as const,
      detail: "Pull request created",
      command: "gh pr create",
      url: pullRequestUrl,
      metadata: {
        githubPullRequest: {
          repositoryId: 9_001,
          repository: "example/repository",
          pullRequestId: 10_042,
          pullRequestNodeId: "PR_test_42",
          pullRequestNumber: 42,
        },
      },
      actor: "vitest",
      observedAt: atMinute(12.2),
    };

    await recordRunEvidence(db, projectId, evidenceInput);
    await recordRunEvidence(db, projectId, evidenceInput);

    const linkedRun = await getHuntRunForProject(db, projectId, runId);
    expect(JSON.parse(linkedRun!.pull_request_urls)).toEqual([pullRequestUrl]);
  });

  it("stores images against a run evidence record", async () => {
    await updateProjectSettings(db, projectId, {
      velenOrg: "example",
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: "example/repository",
      workflow: releaseWorkflow,
    });
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 12.3, {
        sourceKey: "evidence-image-run",
        eventKey: "evidence-image-run:queued",
      }),
    );
    const evidence = await recordRunEvidence(db, projectId, {
      runId,
      evidenceKey: "analyzing:screenshot",
      stage: "analyzing",
      type: "repository",
      status: "passed",
      detail: "Screenshot captured",
      command: null,
      url: null,
      metadata: null,
      actor: "vitest",
      observedAt: atMinute(12.4),
    });
    expect(evidence).not.toBeNull();
    const imageId = "11111111-3333-4444-8555-666666666666";
    const stored = await createRunEvidenceImages(
      db,
      projectId,
      runId,
      evidence!.id,
      [
        {
          id: imageId,
          object_key: `run-evidence/${projectId}/${runId}/${evidence!.id}/${imageId}`,
          filename: "dashboard.png",
          content_type: "image/png",
          byte_size: 8,
          sha256: "a".repeat(64),
          position: 0,
        },
      ],
    );

    expect(stored).toHaveLength(1);
    await expect(listRunEvidenceImages(db, projectId, runId)).resolves.toEqual(
      stored,
    );
    await expect(
      getRunEvidenceImage(db, projectId, runId, imageId),
    ).resolves.toEqual(stored?.[0]);
  });

  it("deletes only a project owned by the requesting user", async () => {
    const project = await createProject(db, {
      ownerUserId: "owner",
      organizationId: projectId,
      name: "Disposable",
      agentTokenHash: "d".repeat(64),
    });

    await expect(listProjectAgents(db, project.id)).resolves.toEqual([
      expect.objectContaining({
        project_id: project.id,
        provider: "codex",
      }),
    ]);
    const settings = await getProjectSettings(db, project.id);
    expect(JSON.parse(settings!.workflow_json)).toEqual(
      cloneAutoHuntWorkflow(),
    );
    await expect(
      recordHuntEvent(
        db,
        project.id,
        event("queued", 12, { sourceKey: "workflow-pending" }),
      ),
    ).rejects.toThrow("Repository workflow has not been generated");
    await expect(deleteProject(db, project.id, "someone-else")).resolves.toBe(
      false,
    );
    await expect(getProject(db, project.id, "owner")).resolves.not.toBeNull();
    await expect(deleteProject(db, project.id, "owner")).resolves.toBe(true);
    await expect(getProject(db, project.id, "owner")).resolves.toBeNull();
    await expect(getProjectSettings(db, project.id)).resolves.toBeNull();
  });

  it("shares organization projects with members without granting owner deletion", async () => {
    await executeSql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values ('member', 'Member', 'member@example.com', 1, '${atMinute(0)}', '${atMinute(0)}');
    `,
    );
    await expect(
      addOrganizationMember(db, projectId, "member@example.com", "member"),
    ).resolves.toBe("member");

    const projects = await listProjects(db, "member");
    expect(projects.map((project) => project.id)).toContain(projectId);
    expect(projects[0]?.member_role).toBe("member");
    expect(await getProject(db, projectId, "member")).not.toBeNull();
    await expect(deleteProject(db, projectId, "member")).resolves.toBe(false);
    const memberTokenHash = "e".repeat(64);
    await expect(
      issueProjectAgentToken(db, projectId, "member", memberTokenHash),
    ).resolves.toBe(true);
    await expect(
      findProjectIdByAgentTokenHash(db, memberTokenHash),
    ).resolves.toBe(projectId);
    await expect(
      issueProjectAgentToken(db, projectId, "not-a-member", "f".repeat(64)),
    ).resolves.toBe(false);

    await expect(
      updateOrganizationMemberRole(db, projectId, "member", "admin"),
    ).resolves.toBe(true);
    const members = await listOrganizationMembers(db, projectId);
    expect(members.map((member) => member.email)).toEqual([
      "owner@example.com",
      "member@example.com",
    ]);
    expect(members.find((member) => member.user_id === "member")?.role).toBe(
      "admin",
    );
    await expect(
      updateOrganizationMemberRole(db, projectId, "owner", "member"),
    ).resolves.toBe(false);
    const assignedRunId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 13, {
        sourceKey: "member-assignment",
        assigneeUserId: "member",
      }),
    );
    await expect(
      removeOrganizationMember(db, projectId, "member"),
    ).resolves.toBe(true);
    await expect(
      getHuntRunForProject(db, projectId, assignedRunId),
    ).resolves.toMatchObject({ assignee_user_id: null });
    await expect(
      findProjectIdByAgentTokenHash(db, memberTokenHash),
    ).resolves.toBeNull();
  });

  it("invites an unregistered email and grants organization access on exact-email acceptance", async () => {
    const tokenHash = "1".repeat(64);
    const invitation = await createOrganizationInvitation(db, {
      id: "invitation-new-member",
      organizationId: projectId,
      initialProjectId: projectId,
      emailNormalized: "new-invitee@example.com",
      role: "member",
      tokenHash,
      invitedByUserId: "owner",
      expiresAt: atMinute(100),
      createdAt: atMinute(20),
    });
    expect(invitation).toMatchObject({
      outcome: "created",
      invitation: {
        email_normalized: "new-invitee@example.com",
        initial_project_id: projectId,
      },
    });
    await expect(listOrganizationInvitations(db, projectId)).resolves.toEqual([
      expect.objectContaining({ id: "invitation-new-member" }),
    ]);
    await expect(
      acceptOrganizationInvitation(db, {
        tokenHash,
        userId: "owner",
        emailNormalized: "owner@example.com",
        acceptedAt: atMinute(30),
      }),
    ).resolves.toEqual({ outcome: "email_mismatch" });

    await executeSql(
      db,
      `insert into user (id, name, email, emailVerified, createdAt, updatedAt)
       values (
         'new-invitee', 'New Invitee', 'new-invitee@example.com', 1,
         '${atMinute(30)}', '${atMinute(30)}'
       );`,
    );
    await expect(
      acceptOrganizationInvitation(db, {
        tokenHash,
        userId: "new-invitee",
        emailNormalized: "new-invitee@example.com",
        acceptedAt: atMinute(31),
      }),
    ).resolves.toMatchObject({ outcome: "accepted" });
    await expect(listProjects(db, "new-invitee")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: projectId, member_role: "member" }),
      ]),
    );
    await expect(
      acceptOrganizationInvitation(db, {
        tokenHash,
        userId: "new-invitee",
        emailNormalized: "new-invitee@example.com",
        acceptedAt: atMinute(32),
      }),
    ).resolves.toMatchObject({ outcome: "already_accepted" });
    await expect(listOrganizationInvitations(db, projectId)).resolves.toEqual(
      [],
    );
  });

  it("supports revoking and safely replacing pending invitation links", async () => {
    const first = await createOrganizationInvitation(db, {
      id: "invitation-replaced",
      organizationId: projectId,
      initialProjectId: projectId,
      emailNormalized: "replace-invite@example.com",
      role: "member",
      tokenHash: "2".repeat(64),
      invitedByUserId: "owner",
      expiresAt: atMinute(100),
      createdAt: atMinute(40),
    });
    expect(first.outcome).toBe("created");
    const replacement = await createOrganizationInvitation(db, {
      id: "invitation-replacement",
      organizationId: projectId,
      initialProjectId: projectId,
      emailNormalized: "replace-invite@example.com",
      role: "admin",
      tokenHash: "3".repeat(64),
      invitedByUserId: "owner",
      expiresAt: atMinute(110),
      createdAt: atMinute(41),
    });
    expect(replacement).toMatchObject({
      outcome: "created",
      invitation: { id: "invitation-replacement", role: "admin" },
    });
    await expect(
      getOrganizationInvitationByTokenHash(db, "2".repeat(64)),
    ).resolves.toMatchObject({ revoked_at: atMinute(41) });
    await expect(
      revokeOrganizationInvitation(
        db,
        projectId,
        "invitation-replacement",
        atMinute(42),
      ),
    ).resolves.toBe(true);
    await expect(
      acceptOrganizationInvitation(db, {
        tokenHash: "3".repeat(64),
        userId: "owner",
        emailNormalized: "replace-invite@example.com",
        acceptedAt: atMinute(43),
      }),
    ).resolves.toEqual({ outcome: "revoked" });
  });

  it("deletes a personal account, its sole-member organization, and auth data", async () => {
    const userId = "account-deletion-personal";
    const email = "account-deletion-personal@example.com";
    await executeSql(
      db,
      `insert into user (id, name, email, emailVerified, createdAt, updatedAt)
       values (
         '${userId}', 'Delete Me', '${email}', 1,
         '${atMinute(0)}', '${atMinute(0)}'
       );
       insert into verification (
         id, identifier, value, expiresAt, createdAt, updatedAt
       ) values (
         'account-deletion-verification', '${email}', 'token',
         '${atMinute(30)}', '${atMinute(0)}', '${atMinute(0)}'
       );
       insert into deviceCode (
         id, deviceCode, userCode, userId, expiresAt, status
       ) values (
         'account-deletion-device', 'device-code', 'user-code', '${userId}',
         '${atMinute(30)}', 'approved'
       );`,
    );
    const organization = await createOrganization(db, {
      name: "Disposable Organization",
      handle: "account-deletion-personal",
      ownerUserId: userId,
    });
    const project = await createProject(db, {
      ownerUserId: userId,
      organizationId: organization.id,
      name: "Disposable Project",
      agentTokenHash: "9".repeat(64),
    });

    const plan = await planAccountDeletion(db, userId);
    expect(plan.blockedOrganizations).toEqual([]);
    expect(plan.organizationIds).toEqual([organization.id]);
    expect(plan.projectIds).toEqual([project.id]);
    await expect(
      deleteAccountData(db, {
        userId,
        email,
        organizationIds: plan.organizationIds,
      }),
    ).resolves.toBe(true);

    await expect(
      db.prepare(`select id from "user" where id = ?`).bind(userId).first(),
    ).resolves.toBeNull();
    await expect(
      db
        .prepare(`select id from briar_organizations where id = ?`)
        .bind(organization.id)
        .first(),
    ).resolves.toBeNull();
    await expect(
      db.prepare(`select id from briar_projects where id = ?`).bind(project.id).first(),
    ).resolves.toBeNull();
    await expect(
      db
        .prepare(`select id from verification where identifier = ?`)
        .bind(email)
        .first(),
    ).resolves.toBeNull();
    await expect(
      db
        .prepare(`select id from deviceCode where userId = ?`)
        .bind(userId)
        .first(),
    ).resolves.toBeNull();
  });

  it("blocks shared owners while allowing a resource-free member to leave", async () => {
    const ownerId = "account-deletion-shared-owner";
    const memberId = "account-deletion-shared-member";
    const ownerEmail = "account-deletion-owner@example.com";
    const memberEmail = "account-deletion-member@example.com";
    await executeSql(
      db,
      `insert into user (id, name, email, emailVerified, createdAt, updatedAt)
       values
         ('${ownerId}', 'Shared Owner', '${ownerEmail}', 1,
          '${atMinute(0)}', '${atMinute(0)}'),
         ('${memberId}', 'Shared Member', '${memberEmail}', 1,
          '${atMinute(0)}', '${atMinute(0)}');`,
    );
    const organization = await createOrganization(db, {
      name: "Shared Organization",
      handle: "account-deletion-shared",
      ownerUserId: ownerId,
    });
    await expect(
      addOrganizationMember(db, organization.id, memberEmail, "member"),
    ).resolves.toBe(memberId);

    await expect(planAccountDeletion(db, ownerId)).resolves.toMatchObject({
      blockedOrganizations: [{ id: organization.id, name: organization.name }],
      organizationIds: [],
    });
    const memberPlan = await planAccountDeletion(db, memberId);
    expect(memberPlan).toEqual({
      blockedOrganizations: [],
      organizationIds: [],
      projectIds: [],
    });
    await expect(
      deleteAccountData(db, {
        userId: memberId,
        email: memberEmail,
        organizationIds: memberPlan.organizationIds,
      }),
    ).resolves.toBe(true);
    await expect(
      db
        .prepare(`select id from briar_organizations where id = ?`)
        .bind(organization.id)
        .first(),
    ).resolves.not.toBeNull();

    await db.batch([
      db.prepare(`delete from briar_organizations where id = ?`).bind(organization.id),
      db.prepare(`delete from "user" where id = ?`).bind(ownerId),
    ]);
  });

  it("updates an organization name while preserving its membership role", async () => {
    await expect(
      updateOrganization(db, projectId, "Renamed Org", "owner"),
    ).resolves.toMatchObject({
      id: projectId,
      name: "Renamed Org",
      role: "owner",
    });
    expect((await listProjects(db, "owner"))[0]?.organization_name).toBe(
      "Renamed Org",
    );
  });

  it("preserves logos stored before browser fallback formats were added", async () => {
    await expect(listOrganizations(db, "owner")).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: projectId,
          logo: "data:image/webp;base64,bGVnYWN5",
        }),
      ]),
    );
  });

  it("stores and removes an organization logo while preserving its role", async () => {
    for (const logo of [
      "data:image/webp;base64,bG9nbw==",
      "data:image/png;base64,bG9nbw==",
      "data:image/jpeg;base64,bG9nbw==",
    ]) {
      await expect(
        updateOrganizationLogo(db, projectId, logo, "owner"),
      ).resolves.toMatchObject({
        id: projectId,
        logo,
        role: "owner",
      });
    }
    await expect(
      updateOrganizationLogo(db, projectId, null, "owner"),
    ).resolves.toMatchObject({
      id: projectId,
      logo: null,
      role: "owner",
    });
  });

  it("stores and removes a project icon", async () => {
    for (const icon of [
      "data:image/webp;base64,bG9nbw==",
      "data:image/png;base64,bG9nbw==",
      "data:image/jpeg;base64,bG9nbw==",
    ]) {
      await expect(updateProjectIcon(db, projectId, icon)).resolves.toBe(true);
      await expect(getProject(db, projectId, "owner")).resolves.toMatchObject({
        id: projectId,
        icon,
      });
    }
    await expect(updateProjectIcon(db, projectId, null)).resolves.toBe(true);
    await expect(getProject(db, projectId, "owner")).resolves.toMatchObject({
      id: projectId,
      icon: null,
    });
  });

  it("stores a project issue key prefix", async () => {
    await expect(
      updateProjectIssueKeyPrefix(db, projectId, "BR"),
    ).resolves.toBe(true);
    await expect(getProject(db, projectId, "owner")).resolves.toMatchObject({
      id: projectId,
      issue_key_prefix: "BR",
    });
  });

  it("stores an app-created issue as a queued Auto Hunt run", async () => {
    await setStoredWorkflow(db, projectId, localWorkflow);
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 20, {
        sourceKey: "briar-issue:22222222-2222-4222-8222-222222222222",
        eventKey:
          "briar-issue:22222222-2222-4222-8222-222222222222:queued:intake",
        title: "App-created issue",
        actor: "briar-app",
        priority: 2,
        branch: null,
        commitSha: null,
        issueDescription: "Created directly in Briar",
        sourceCreatedAt: atMinute(20),
        context: {
          origin: "briar-app",
          issueId: "22222222-2222-4222-8222-222222222222",
        },
      }),
    );

    const run = await db
      .prepare(
        `select stage, source, title, priority, issue_description, context_json
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        stage: string;
        source: string;
        title: string;
        priority: number;
        issue_description: string;
        context_json: string;
      }>();

    expect(run).toEqual({
      stage: "queued",
      source: "issue",
      title: "App-created issue",
      priority: 2,
      issue_description: "Created directly in Briar",
      context_json:
        '{"origin":"briar-app","issueId":"22222222-2222-4222-8222-222222222222"}',
    });
  });

  it("stores issue conversations with nested threaded replies", async () => {
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 25, {
        sourceKey: "issue-message-run",
        eventKey: "issue-message-run:queued",
      }),
    );
    const rootId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const replyId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const agentReplyId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    expect(
      await createIssueMessage(db, {
        id: rootId,
        projectId,
        runId,
        parentMessageId: null,
        authorUserId: "owner",
        authorAgentProvider: null,
        body: "Please verify the edge case.",
        createdAt: atMinute(26),
      }),
    ).toEqual(
      expect.objectContaining({
        id: rootId,
        author_name: "Owner",
        reply_count: 0,
      }),
    );
    expect(
      await createIssueMessage(db, {
        id: replyId,
        projectId,
        runId,
        // Mobile JSON encoders can send UUIDs with uppercase hex digits.
        parentMessageId: rootId.toUpperCase(),
        authorUserId: "owner",
        authorAgentProvider: null,
        body: "The edge case is covered.",
        createdAt: atMinute(27),
      }),
    ).toEqual(
      expect.objectContaining({
        id: replyId,
        parent_message_id: rootId,
      }),
    );
    expect(
      await createIssueMessage(db, {
        id: agentReplyId,
        projectId,
        runId,
        parentMessageId: rootId,
        authorUserId: null,
        authorAgentProvider: "claude",
        body: "The original provider checked the follow-up.",
        createdAt: atMinute(28),
      }),
    ).toEqual(
      expect.objectContaining({
        id: agentReplyId,
        author_user_id: null,
        author_agent_provider: "claude",
      }),
    );

    const messages = await listIssueMessages(db, projectId, runId);
    expect(messages).toEqual([
      expect.objectContaining({ id: rootId, reply_count: 2 }),
      expect.objectContaining({
        id: replyId,
        parent_message_id: rootId,
        reply_count: 0,
      }),
      expect.objectContaining({
        id: agentReplyId,
        parent_message_id: rootId,
        author_agent_provider: "claude",
        reply_count: 0,
      }),
    ]);
    const nestedReplyId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    await expect(
      createIssueMessage(db, {
        id: nestedReplyId,
        projectId,
        runId,
        parentMessageId: replyId,
        authorUserId: "owner",
        authorAgentProvider: null,
        body: "A reply to the reply keeps the thread going.",
        createdAt: atMinute(29),
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: nestedReplyId,
        parent_message_id: replyId,
      }),
    );
    const thread = await listIssueThreadMessages(db, projectId, runId, rootId);
    expect(thread.map((message) => message.id)).toEqual([
      rootId,
      replyId,
      agentReplyId,
      nestedReplyId,
    ]);
    const nestedThread = await listIssueThreadMessages(
      db,
      projectId,
      runId,
      nestedReplyId,
    );
    expect(nestedThread.map((message) => message.id)).toEqual([
      rootId,
      replyId,
      agentReplyId,
      nestedReplyId,
    ]);
  });

  it("edits a user message body without spawning an agent reply and deletes a message with its replies", async () => {
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 30, {
        sourceKey: "issue-message-edit-run",
        eventKey: "issue-message-edit-run:queued",
      }),
    );
    const rootId = "eeeeeeee-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const replyId = "eeeeeeee-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    await createIssueMessage(db, {
      id: rootId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "Original body",
      createdAt: atMinute(30),
    });
    await createIssueMessage(db, {
      id: replyId,
      projectId,
      runId,
      parentMessageId: rootId,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "Original reply",
      createdAt: atMinute(31),
    });
    await executeSql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values (
        'issue-message-mention', 'Issue Mention',
        'mention@example.com', 1, '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        '${projectId}', 'issue-message-mention', 'member',
        '${atMinute(0)}', '${atMinute(0)}'
      );`,
    );
    const editedAt = atMinute(32);
    const edited = await updateIssueMessage(db, projectId, runId, rootId, {
      body: "@issue-message-mention 수정된 본문",
      mentionedUserIds: ["issue-message-mention"],
      updatedAt: editedAt,
    });
    expect(edited).toEqual(
      expect.objectContaining({
        id: rootId,
        body: "@issue-message-mention 수정된 본문",
        updated_at: editedAt,
        author_name: "Owner",
      }),
    );
    const mentionRows = await db
      .prepare(
        `select user_id from briar_issue_message_mentions
         where message_id = ?`,
      )
      .bind(rootId)
      .all<{ user_id: string }>();
    expect(mentionRows.results.map((row) => row.user_id)).toEqual([
      "issue-message-mention",
    ]);
    expect(await getIssueMessage(db, projectId, runId, rootId)).toEqual(
      expect.objectContaining({
        id: rootId,
        body: "@issue-message-mention 수정된 본문",
        reply_count: 1,
      }),
    );
    expect(
      await deleteIssueMessage(db, projectId, runId, rootId),
    ).toBe(true);
    const remaining = await listIssueMessages(db, projectId, runId);
    expect(remaining).toEqual([]);
    expect(await getIssueMessage(db, projectId, runId, rootId)).toBeNull();
    const mentionAfter = await db
      .prepare(
        `select count(*) as count from briar_issue_message_mentions
         where message_id = ?`,
      )
      .bind(rootId)
      .first<{ count: number }>();
    expect(mentionAfter?.count).toBe(0);
  });

  it("lists mentions and replies to a user's root messages for inbox delivery", async () => {
    await executeSql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values (
        'conversation-member', 'Conversation Member',
        'conversation@example.com', 1, '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        '${projectId}', 'conversation-member', 'member',
        '${atMinute(0)}', '${atMinute(0)}'
      );`,
    );
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 29, {
        sourceKey: "inbox-conversation-run",
        eventKey: "inbox-conversation-run:queued",
      }),
    );
    const ownerRootId = "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await createIssueMessage(db, {
      id: ownerRootId,
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "This is my thread.",
      createdAt: atMinute(29.1),
    });
    await createIssueMessage(db, {
      id: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      projectId,
      runId,
      parentMessageId: ownerRootId,
      authorUserId: "conversation-member",
      authorAgentProvider: null,
      body: "Replying to your thread.",
      createdAt: atMinute(29.2),
    });
    await createIssueMessage(db, {
      id: "33333333-cccc-4ccc-8ccc-cccccccccccc",
      projectId,
      runId,
      parentMessageId: null,
      authorUserId: "conversation-member",
      authorAgentProvider: null,
      body: "@owner please review this.",
      mentionedUserIds: ["owner"],
      createdAt: atMinute(29.3),
    });
    await createIssueMessage(db, {
      id: "44444444-dddd-4ddd-8ddd-dddddddddddd",
      projectId,
      runId,
      parentMessageId: ownerRootId,
      authorUserId: "owner",
      authorAgentProvider: null,
      body: "My own reply should not notify me.",
      mentionedUserIds: ["owner"],
      createdAt: atMinute(29.4),
    });

    const notifications = await listIssueConversationNotifications(
      db,
      projectId,
      "owner",
    );
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "33333333-cccc-4ccc-8ccc-cccccccccccc",
          notification_reason: "mention",
          root_message_id: "33333333-cccc-4ccc-8ccc-cccccccccccc",
        }),
        expect.objectContaining({
          id: "22222222-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          notification_reason: "thread_reply",
          root_message_id: ownerRootId,
        }),
      ]),
    );
    expect(
      notifications.some(
        (notification) =>
          notification.id === "44444444-dddd-4ddd-8ddd-dddddddddddd",
      ),
    ).toBe(false);

    await removeOrganizationMember(db, projectId, "conversation-member");
  });

  it("lists visible channel mentions and replies to a user's root message", async () => {
    const publicChannelId = "55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const privateChannelId = "55555555-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const rootId = "66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const replyId = "77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const mentionId = "88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await executeSql(
      db,
      `
      insert into user (id, name, email, emailVerified, createdAt, updatedAt)
      values (
        'channel-member', 'Channel Member', 'channel@example.com', 1,
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values (
        '${projectId}', 'channel-member', 'member',
        '${atMinute(0)}', '${atMinute(0)}'
      );
      insert into briar_channels (
        id, organization_id, slug, name, visibility, created_at, updated_at
      ) values
        ('${publicChannelId}', '${projectId}', 'inbox-public', 'Inbox Public',
         'public', '${atMinute(30)}', '${atMinute(30)}'),
        ('${privateChannelId}', '${projectId}', 'inbox-private', 'Inbox Private',
         'private', '${atMinute(30)}', '${atMinute(30)}');
      insert into briar_channel_messages (
        id, channel_id, parent_message_id, author_user_id, body, created_at, updated_at
      ) values
        ('${rootId}', '${publicChannelId}', null, 'owner', 'Owner root',
         '${atMinute(30.1)}', '${atMinute(30.1)}'),
        ('${replyId}', '${publicChannelId}', '${rootId}', 'channel-member', 'A reply',
         '${atMinute(30.2)}', '${atMinute(30.2)}'),
        ('${mentionId}', '${publicChannelId}', null, 'channel-member', '@owner review',
         '${atMinute(30.3)}', '${atMinute(30.3)}'),
        ('99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${publicChannelId}', '${rootId}',
         'owner', 'Own reply', '${atMinute(30.4)}', '${atMinute(30.4)}'),
        ('99999999-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '${privateChannelId}', null,
         'channel-member', 'Hidden mention', '${atMinute(30.5)}', '${atMinute(30.5)}');
      insert into briar_channel_message_mentions (message_id, user_id, created_at)
      values
        ('${mentionId}', 'owner', '${atMinute(30.3)}'),
        ('99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'owner', '${atMinute(30.4)}'),
        ('99999999-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'owner', '${atMinute(30.5)}');`,
    );

    const notifications = await listChannelConversationNotifications(
      db,
      projectId,
      "owner",
    );

    expect(notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: mentionId,
        channel_name: "Inbox Public",
        root_message_id: mentionId,
        notification_reason: "mention",
      }),
      expect.objectContaining({
        id: replyId,
        root_message_id: rootId,
        notification_reason: "thread_reply",
      }),
    ]));
    expect(notifications.map((notification) => notification.id)).not.toContain(
      "99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(notifications.map((notification) => notification.id)).not.toContain(
      "99999999-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    );
  });

  it("stores account-scoped inbox read versions for multi-device sync", async () => {
    const first = await upsertInboxReadStates(
      db,
      "owner",
      [
        {
          messageId: "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: "1:1:completed:merged:2026-08-02T01:00:00.000Z:3",
        },
      ],
      atMinute(40),
    );
    expect(first).toEqual([
      expect.objectContaining({
        message_id: "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        version: "1:1:completed:merged:2026-08-02T01:00:00.000Z:3",
      }),
    ]);

    const updated = await upsertInboxReadStates(
      db,
      "owner",
      [
        {
          messageId: "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: "2:1:blocked:reviewing:2026-08-02T02:00:00.000Z:5",
        },
        {
          messageId: "conversation:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        },
      ],
      atMinute(41),
    );
    expect(updated).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message_id: "issue:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          version: "2:1:blocked:reviewing:2026-08-02T02:00:00.000Z:5",
        }),
        expect.objectContaining({
          message_id: "conversation:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ]),
    );
    expect(await listInboxReadStates(db, "owner")).toHaveLength(2);
    expect(await listInboxReadStates(db, "member")).toEqual([]);
  });

  it("stores issue attachment metadata scoped to its project and run", async () => {
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 19.5, {
        sourceKey: "issue-attachment-run",
        eventKey: "issue-attachment-run:queued",
        title: "Issue attachment run",
        branch: null,
        commitSha: null,
      }),
    );
    const run = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "6".repeat(64),
      claimedBy: "attachment-worker",
      claimedAt: atMinute(19.6),
      leaseExpiresAt: atMinute(120),
      runId,
    });
    expect(run?.id).toBe(runId);
    const attachmentId = "66666666-6666-4666-8666-666666666666";
    await createIssueAttachments(db, projectId, runId, [
      {
        id: attachmentId,
        object_key: `issue-attachments/${projectId}/${runId}/${attachmentId}`,
        filename: "screen.png",
        content_type: "image/png",
        byte_size: 2048,
      },
    ]);

    expect(await listIssueAttachments(db, projectId, runId)).toEqual([
      expect.objectContaining({
        id: attachmentId,
        run_id: runId,
        project_id: projectId,
        filename: "screen.png",
        content_type: "image/png",
        byte_size: 2048,
      }),
    ]);
    expect(
      await getIssueAttachment(db, projectId, runId, attachmentId),
    ).toEqual(
      expect.objectContaining({
        object_key: expect.stringContaining(attachmentId),
      }),
    );
    expect(
      await getIssueAttachment(
        db,
        "99999999-9999-4999-8999-999999999999",
        runId,
        attachmentId,
      ),
    ).toBeNull();
  });

  it("updates issue fields without changing workflow state", async () => {
    const sourceKey = "editable-issue";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("cancelled", 18, {
        sourceKey,
        eventKey: `${sourceKey}:cancelled`,
        title: "Original title",
        issueDescription: "Original description",
        priority: 3,
        assigneeUserId: "owner",
      }),
    );

    const updated = await updateIssue(db, projectId, runId, {
      title: "Updated title",
      description: null,
      priority: 1,
      updatedAt: atMinute(19),
    });

    expect(updated).toEqual(
      expect.objectContaining({
        id: runId,
        title: "Updated title",
        issue_description: null,
        priority: 1,
        assignee_user_id: "owner",
        status: "cancelled",
        workflow_stage: null,
        updated_at: atMinute(19),
      }),
    );

    const unassigned = await updateIssue(db, projectId, runId, {
      title: "Updated title",
      description: null,
      priority: 1,
      assigneeUserId: null,
      updatedAt: atMinute(20),
    });
    expect(unassigned?.assignee_user_id).toBeNull();
  });

  it("records one result review per member and publishes a dashboard delta", async () => {
    const sourceKey = "reviewed-result";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("cancelled", 18.1, {
        sourceKey,
        eventKey: `${sourceKey}:cancelled`,
        title: "Review this result",
      }),
    );
    const cursor = await getDashboardSyncCursor(db, projectId);

    const first = await completeIssueResultReview(
      db,
      projectId,
      runId,
      "owner",
      atMinute(19),
    );
    const repeated = await completeIssueResultReview(
      db,
      projectId,
      runId,
      "owner",
      atMinute(20),
    );

    expect(first).toMatchObject({
      run_id: runId,
      user_id: "owner",
      name: "Owner",
      completed_at: atMinute(19),
    });
    expect(repeated?.completed_at).toBe(atMinute(19));
    await expect(listIssueResultReviews(db, projectId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ run_id: runId, user_id: "owner" }),
      ]),
    );
    await expect(listDashboardChanges(db, projectId, cursor)).resolves.toMatchObject({
      expired: false,
      changes: expect.arrayContaining([
        expect.objectContaining({
          entity_type: "run",
          entity_id: runId,
          operation: "upsert",
        }),
      ]),
    });
  });

  it("deletes an issue and cascades its stored records", async () => {
    const sourceKey = "deletable-issue";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("cancelled", 19, {
        sourceKey,
        eventKey: `${sourceKey}:cancelled`,
        title: "Delete this issue",
      }),
    );
    const attachmentId = "44444444-4444-4444-8444-444444444444";
    await createIssueAttachments(db, projectId, runId, [
      {
        id: attachmentId,
        object_key: `issue-attachments/${projectId}/${runId}/${attachmentId}`,
        filename: "delete-me.png",
        content_type: "image/png",
        byte_size: 128,
      },
    ]);

    await expect(deleteIssue(db, projectId, runId, atMinute(20))).resolves.toBe(
      "deleted",
    );
    expect(await getHuntRunForProject(db, projectId, runId)).toBeNull();
    expect(await listIssueAttachments(db, projectId, runId)).toEqual([]);
    expect(
      await db
        .prepare(
          "select count(*) as count from briar_hunt_events where run_id = ?",
        )
        .bind(runId)
        .first<number>("count"),
    ).toBe(0);
  });

  it("does not delete an active issue", async () => {
    const sourceKey = "active-delete-guard";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("analyzing", 20, {
        sourceKey,
        eventKey: `${sourceKey}:analyzing`,
        title: "Active issue",
      }),
    );

    await expect(deleteIssue(db, projectId, runId, atMinute(21))).resolves.toBe(
      "active",
    );
    expect(await getHuntRunForProject(db, projectId, runId)).not.toBeNull();
  });

  it("stores an acyclic issue dependency graph and exposes both directions", async () => {
    const prerequisiteRunId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 20.1, {
        sourceKey: "dependency-prerequisite",
        eventKey: "dependency-prerequisite:queued:intake",
        title: "Prepare the schema",
        branch: null,
        commitSha: null,
      }),
    );
    const dependentRunId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 20.2, {
        sourceKey: "dependency-dependent",
        eventKey: "dependency-dependent:queued:intake",
        title: "Use the schema",
        branch: null,
        commitSha: null,
      }),
    );
    const finalRunId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 20.3, {
        sourceKey: "dependency-final",
        eventKey: "dependency-final:queued:intake",
        title: "Release the feature",
        branch: null,
        commitSha: null,
      }),
    );
    const dependencyCursor = await getDashboardSyncCursor(db, projectId);

    await expect(
      createIssueDependency(db, projectId, {
        prerequisiteRunId,
        dependentRunId,
        createdByUserId: "owner",
        createdAt: atMinute(20.4),
      }),
    ).resolves.toBe("created");
    await expect(
      listDashboardChanges(db, projectId, dependencyCursor),
    ).resolves.toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({
          entity_type: "run",
          entity_id: prerequisiteRunId,
        }),
        expect.objectContaining({
          entity_type: "run",
          entity_id: dependentRunId,
        }),
      ]),
    });
    await expect(
      createIssueDependency(db, projectId, {
        prerequisiteRunId: dependentRunId,
        dependentRunId: finalRunId,
        createdByUserId: "owner",
        createdAt: atMinute(20.5),
      }),
    ).resolves.toBe("created");
    await expect(
      createIssueDependency(db, projectId, {
        prerequisiteRunId,
        dependentRunId,
        createdByUserId: "owner",
        createdAt: atMinute(20.6),
      }),
    ).resolves.toBe("already_exists");

    expect(await listIssueDependencies(db, projectId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prerequisite_run_id: prerequisiteRunId,
          prerequisite_title: "Prepare the schema",
          dependent_run_id: dependentRunId,
          dependent_title: "Use the schema",
        }),
        expect.objectContaining({
          prerequisite_run_id: dependentRunId,
          dependent_run_id: finalRunId,
        }),
      ]),
    );

    await expect(
      createIssueDependency(db, projectId, {
        prerequisiteRunId: finalRunId,
        dependentRunId: prerequisiteRunId,
        createdByUserId: "owner",
        createdAt: atMinute(20.7),
      }),
    ).resolves.toBe("cycle");
    await expect(
      createIssueDependency(db, projectId, {
        prerequisiteRunId,
        dependentRunId: prerequisiteRunId,
        createdByUserId: "owner",
        createdAt: atMinute(20.8),
      }),
    ).resolves.toBe("cycle");

    await db
      .prepare("update briar_hunt_runs set status = 'running' where id = ?")
      .bind(finalRunId)
      .run();
    await expect(
      createIssueDependency(db, projectId, {
        prerequisiteRunId,
        dependentRunId: finalRunId,
        createdByUserId: "owner",
        createdAt: atMinute(20.85),
      }),
    ).resolves.toBe("ineligible");
    await db
      .prepare("update briar_hunt_runs set status = 'queued' where id = ?")
      .bind(finalRunId)
      .run();

    await expect(
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: "9".repeat(64),
        claimedBy: "dependency-worker",
        claimedAt: atMinute(20.9),
        leaseExpiresAt: atMinute(30.9),
        runId: dependentRunId,
      }),
    ).resolves.toBeNull();

    await db
      .prepare(
        `update briar_hunt_runs
         set status = 'completed', stage = 'completed', completed_at = ?
         where id = ?`,
      )
      .bind(atMinute(21), prerequisiteRunId)
      .run();

    await expect(
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: "8".repeat(64),
        claimedBy: "dependency-worker",
        claimedAt: atMinute(21.1),
        leaseExpiresAt: atMinute(31.1),
        runId: dependentRunId,
      }),
    ).resolves.toMatchObject({ id: dependentRunId });

    const deleteDependencyCursor = await getDashboardSyncCursor(db, projectId);
    await expect(
      deleteIssueDependency(
        db,
        projectId,
        dependentRunId,
        finalRunId,
      ),
    ).resolves.toBe(true);
    await expect(
      listDashboardChanges(db, projectId, deleteDependencyCursor),
    ).resolves.toMatchObject({
      changes: expect.arrayContaining([
        expect.objectContaining({
          entity_type: "run",
          entity_id: dependentRunId,
        }),
        expect.objectContaining({
          entity_type: "run",
          entity_id: finalRunId,
        }),
      ]),
    });
    expect(await listIssueDependencies(db, projectId)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          prerequisite_run_id: dependentRunId,
          dependent_run_id: finalRunId,
        }),
      ]),
    );
  });

  it("claims the highest-priority oldest queued run", async () => {
    await recordHuntEvent(
      db,
      projectId,
      event("queued", 20, {
        sourceKey: "backlog-issue",
        eventKey: "backlog-issue:backlog:intake",
        title: "Backlog issue",
        status: "backlog",
        priority: 1,
        branch: null,
        commitSha: null,
      }),
    );
    const urgentId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 21, {
        sourceKey: "briar-issue:33333333-3333-4333-8333-333333333333",
        eventKey:
          "briar-issue:33333333-3333-4333-8333-333333333333:queued:intake",
        title: "Urgent queued issue",
        priority: 1,
        branch: null,
        commitSha: null,
      }),
    );

    const next = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "7".repeat(64),
      claimedBy: "priority-worker",
      claimedAt: atMinute(21),
      leaseExpiresAt: atMinute(31),
    });

    expect(next?.id).toBe(urgentId);
    expect(next?.title).toBe("Urgent queued issue");
    expect(next?.stage).toBe("queued");
    expect(next?.source_key).not.toBe("backlog-issue");

    await db
      .prepare(
        `update briar_hunt_runs
         set claim_token_hash = null, claimed_by = null, claimed_at = null,
             lease_expires_at = null, claim_attempts = 0
         where id = ?`,
      )
      .bind(urgentId)
      .run();
  });

  it("claims queued runs atomically and safely reassigns expired leases", async () => {
    const firstHash = "a".repeat(64);
    const secondHash = "b".repeat(64);
    const replacementHash = "c".repeat(64);
    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        {
          source: "issue",
          sourceKey: "briar-issue:22222222-2222-4222-8222-222222222222",
        },
        null,
        atMinute(21),
      ),
    ).rejects.toBeInstanceOf(HuntClaimError);

    const [first, second] = await Promise.all([
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: firstHash,
        claimedBy: "agent-one",
        claimedAt: atMinute(22),
        leaseExpiresAt: atMinute(32),
      }),
      claimNextQueuedHuntRun(db, projectId, {
        claimTokenHash: secondHash,
        claimedBy: "agent-two",
        claimedAt: atMinute(22),
        leaseExpiresAt: atMinute(32),
      }),
    ]);

    expect(new Set([first?.title, second?.title])).toEqual(
      new Set(["Urgent queued issue", "App-created issue"]),
    );
    expect(second?.id).not.toBe(first?.id);

    const replacement = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: replacementHash,
      claimedBy: "agent-three",
      claimedAt: atMinute(40),
      leaseExpiresAt: atMinute(50),
    });
    expect(replacement?.title).toBe("Urgent queued issue");
    expect(replacement?.claim_attempts).toBe(2);

    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        { source: "issue", sourceKey: replacement!.source_key },
        firstHash,
        atMinute(41),
      ),
    ).rejects.toBeInstanceOf(HuntClaimError);
    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        { source: "issue", sourceKey: replacement!.source_key },
        replacementHash,
        atMinute(41),
      ),
    ).resolves.toBeUndefined();
  });

  it("claims a specifically requested queued run without taking the queue head", async () => {
    const queueHeadId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 21.4, {
        sourceKey: "queue-head-issue",
        eventKey: "queue-head-issue:queued:intake",
        title: "Queue head issue",
        priority: 1,
        branch: null,
        commitSha: null,
      }),
    );
    const requestedId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 21.5, {
        sourceKey: "requested-queued-issue",
        eventKey: "requested-queued-issue:queued:intake",
        title: "Requested queued issue",
        priority: 4,
        branch: null,
        commitSha: null,
      }),
    );

    const claimed = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "d".repeat(64),
      claimedBy: "direct-dispatch",
      claimedAt: atMinute(22),
      leaseExpiresAt: atMinute(32),
      runId: requestedId,
    });

    expect(claimed?.id).toBe(requestedId);
    expect(claimed?.title).toBe("Requested queued issue");
    const queueHead = await claimNextQueuedHuntRun(db, projectId, {
      claimTokenHash: "e".repeat(64),
      claimedBy: "queue-worker",
      claimedAt: atMinute(22),
      leaseExpiresAt: atMinute(32),
    });
    expect(queueHead?.id).toBe(queueHeadId);
    expect(queueHead?.title).toBe("Queue head issue");
  });

  it("retries failed runs as a new attempt while preserving prior evidence", async () => {
    const sourceKey = "recovery-run";
    const sharedAnalyzingKey = "recovery:analyzing:stable";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 51, { sourceKey, eventKey: "recovery:queued:1" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("analyzing", 52, { sourceKey, eventKey: sharedAnalyzingKey }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("failed", 53, { sourceKey, eventKey: "recovery:failed:1" }),
    );

    const requestId = "44444444-4444-4444-8444-444444444444";
    expect(
      await recoverHuntRun(db, projectId, {
        runId,
        action: "retry",
        requestId,
        actor: "vitest",
        reason: "Retry after a transient failure",
        occurredAt: atMinute(54),
      }),
    ).toEqual({ outcome: "retried", attempt: 2, stage: "queued" });
    expect(
      await recoverHuntRun(db, projectId, {
        runId,
        action: "retry",
        requestId,
        actor: "vitest",
        reason: "Retry after a transient failure",
        occurredAt: atMinute(54),
      }),
    ).toEqual({ outcome: "already_retried", attempt: 2, stage: "queued" });

    await expect(
      recordHuntEvent(
        db,
        projectId,
        event("analyzing", 55, {
          sourceKey,
          eventKey: sharedAnalyzingKey,
          detail: "Second attempt analysis",
        }),
      ),
    ).resolves.toBe(runId);

    const run = await db
      .prepare(
        `select stage, current_attempt, branch, commit_sha, completed_at
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        stage: string;
        current_attempt: number;
        branch: string | null;
        commit_sha: string | null;
        completed_at: string | null;
      }>();
    expect(run).toEqual({
      stage: "analyzing",
      current_attempt: 2,
      branch: "codex/integration",
      commit_sha: "abcdef1",
      completed_at: null,
    });
    const events = await db
      .prepare(
        `select attempt, stage from briar_hunt_events
         where run_id = ? order by occurred_at`,
      )
      .bind(runId)
      .all<{ attempt: number; stage: string }>();
    expect(events.results).toEqual([
      { attempt: 1, stage: "queued" },
      { attempt: 1, stage: "analyzing" },
      { attempt: 1, stage: "failed" },
      { attempt: 2, stage: "queued" },
      { attempt: 2, stage: "analyzing" },
    ]);
  });

  it("cancels blocked runs idempotently without deleting evidence", async () => {
    const sourceKey = "cancel-run";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 60, { sourceKey, eventKey: "cancel:queued" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("blocked", 61, { sourceKey, eventKey: "cancel:blocked" }),
    );
    const input = {
      runId,
      action: "cancel" as const,
      requestId: "55555555-5555-4555-8555-555555555555",
      actor: "vitest",
      reason: null,
      occurredAt: atMinute(62),
    };
    expect(await recoverHuntRun(db, projectId, input)).toEqual({
      outcome: "cancelled",
      attempt: 1,
      stage: "cancelled",
    });
    expect(await recoverHuntRun(db, projectId, input)).toEqual({
      outcome: "already_cancelled",
      attempt: 1,
      stage: "cancelled",
    });
    expect(
      await db
        .prepare(
          "select count(*) as count from briar_hunt_events where run_id = ?",
        )
        .bind(runId)
        .first<number>("count"),
    ).toBe(3);
  });

  it("moves a run freely across workflow and terminal states with an audit trail", async () => {
    const manualWorkflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        { id: "analyzing", label: "Analyze", required: false },
        { id: "implementing", label: "Implement", required: false },
        { id: "local_qa", label: "Local QA", required: false },
        { id: "manual_pause", label: "Manual pause", required: false },
      ],
      execution: {
        checkpoints: [{
          key: "project-after-manual_pause",
          stage: "manual_pause",
          position: "after",
        }],
      },
      completion: { requiredStages: [] },
    });
    await updateProjectSettings(db, projectId, {
      velenOrg: null,
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: "example/repository",
      workflow: manualWorkflow,
    });
    const sourceKey = "manual-move-run";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 70, { sourceKey, eventKey: "move:queued" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("analyzing", 71, { sourceKey, eventKey: "move:analyzing" }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("implementing", 72, { sourceKey, eventKey: "move:implementing" }),
    );
    await db
      .prepare(
        `update briar_hunt_runs
         set claim_token_hash = ?, claimed_by = 'vitest-agent',
             claimed_at = ?, lease_expires_at = ?
         where id = ?`,
      )
      .bind("a".repeat(64), atMinute(72), atMinute(90), runId)
      .run();

    const regressInput = {
      runId,
      status: "running" as const,
      workflowStage: "analyzing",
      requestId: "66666666-6666-4666-8666-666666666666",
      actor: "briar-app:test-user",
      occurredAt: atMinute(73),
    };
    expect(await moveHuntRun(db, projectId, regressInput)).toEqual({
      outcome: "moved",
      status: "running",
      workflowStage: "analyzing",
    });
    expect(await moveHuntRun(db, projectId, regressInput)).toEqual({
      outcome: "already_moved",
      status: "running",
      workflowStage: "analyzing",
    });

    const regressed = await db
      .prepare(
        `select status, workflow_stage, current_attempt, current_revision,
                branch, commit_sha,
                claim_token_hash, claimed_by, lease_expires_at
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        status: string;
        workflow_stage: string | null;
        current_attempt: number;
        current_revision: number;
        branch: string | null;
        commit_sha: string | null;
        claim_token_hash: string | null;
        claimed_by: string | null;
        lease_expires_at: string | null;
      }>();
    expect(regressed).toEqual({
      status: "running",
      workflow_stage: "analyzing",
      current_attempt: 1,
      current_revision: 2,
      branch: "codex/integration",
      commit_sha: null,
      claim_token_hash: null,
      claimed_by: null,
      lease_expires_at: null,
    });
    await expect(
      assertQueuedHuntClaim(
        db,
        projectId,
        { source: "issue", sourceKey },
        "a".repeat(64),
        atMinute(74),
      ),
    ).rejects.toBeInstanceOf(HuntClaimError);

    await db
      .prepare("update briar_hunt_runs set result_summary = ? where id = ?")
      .bind("Manually verified", runId)
      .run();

    expect(
      await moveHuntRun(db, projectId, {
        ...regressInput,
        status: "completed",
        workflowStage: null,
        requestId: "77777777-7777-4777-8777-777777777777",
        occurredAt: atMinute(74),
      }),
    ).toEqual({
      outcome: "moved",
      status: "completed",
      workflowStage: "analyzing",
    });
    expect(
      await moveHuntRun(db, projectId, {
        ...regressInput,
        status: "queued",
        workflowStage: null,
        requestId: "88888888-8888-4888-8888-888888888888",
        occurredAt: atMinute(75),
      }),
    ).toEqual({
      outcome: "moved",
      status: "queued",
      workflowStage: null,
    });

    const requeued = await db
      .prepare(
        `select current_attempt, workflow_stage, branch, commit_sha
         from briar_hunt_runs where id = ?`,
      )
      .bind(runId)
      .first<{
        current_attempt: number;
        workflow_stage: string | null;
        branch: string | null;
        commit_sha: string | null;
      }>();
    expect(requeued).toEqual({
      current_attempt: 2,
      workflow_stage: null,
      branch: "codex/integration",
      commit_sha: null,
    });

    const events = await db
      .prepare(
        `select status, workflow_stage, actor
         from briar_hunt_events
         where run_id = ? and event_key like 'admin:move:%'
         order by occurred_at`,
      )
      .bind(runId)
      .all<{
        status: string;
        workflow_stage: string | null;
        actor: string;
      }>();
    expect(events.results).toEqual([
      {
        status: "running",
        workflow_stage: "analyzing",
        actor: "briar-app:test-user",
      },
      {
        status: "completed",
        workflow_stage: "analyzing",
        actor: "briar-app:test-user",
      },
      {
        status: "queued",
        workflow_stage: null,
        actor: "briar-app:test-user",
      },
    ]);
  });

  it("rejects a manual running state outside the run workflow", async () => {
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 80, {
        sourceKey: "manual-invalid-stage",
        eventKey: "move-invalid:queued",
      }),
    );
    await expect(
      moveHuntRun(db, projectId, {
        runId,
        status: "running",
        workflowStage: "not_configured",
        requestId: "99999999-9999-4999-8999-999999999999",
        actor: "briar-app:test-user",
        occurredAt: atMinute(81),
      }),
    ).rejects.toBeInstanceOf(HuntTransitionError);
  });

  it("keeps completed work history and selectively revises an accepted @briar proposal", async () => {
    await setStoredWorkflow(db, projectId, releaseWorkflow);
    const sourceKey = "completed-rework-proposal";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 76, {
        sourceKey,
        eventKey: `${sourceKey}:queued`,
      }),
    );
    await db
      .prepare(
        `update briar_hunt_runs
         set status = 'completed', stage = 'completed',
             workflow_stage = 'production_qa', branch = 'codex/original',
             commit_sha = 'aabbcc1', target_sha = 'ddeeff2',
             pull_request_urls = '["https://github.example/pr/1"]',
             result_summary = 'Original result',
             structured_result_json = '{"summary":"Original result"}',
             staging_qa_status = 'passed', production_qa_status = 'passed',
             completed_at = ?, last_event_at = ?, updated_at = ?
         where id = ?`,
      )
      .bind(atMinute(77), atMinute(77), atMinute(77), runId)
      .run();
    await db
      .prepare(
        `insert into briar_run_evidence (
           id, project_id, run_id, attempt, revision, evidence_key, workflow_stage,
           evidence_type, status, detail, actor, observed_at, recorded_at
         ) values (?, ?, ?, 1, 1, ?, 'analyzing', 'analysis', 'passed',
                   'A/B/C verified', 'vitest', ?, ?),
                  (?, ?, ?, 1, 1, ?, 'implementing', 'tests', 'passed',
                   'D verified', 'vitest', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        projectId,
        runId,
        `${sourceKey}:analysis`,
        atMinute(77),
        atMinute(77),
        crypto.randomUUID(),
        projectId,
        runId,
        `${sourceKey}:implementing`,
        atMinute(77),
        atMinute(77),
      )
      .run();

    const proposalId = "abababab-abab-4bab-8bab-abababababab";
    const proposal = await createIssueReworkProposal(db, {
      id: proposalId,
      projectId,
      runId,
      triggerMessageId: "cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd",
      replyMessageId: "efefefef-efef-4fef-8fef-efefefefefef",
      workflowStage: "implementing",
      reason: "Replace D with D' and rerun affected QA.",
      createdAt: atMinute(78),
    });
    expect(proposal).toMatchObject({
      status: "pending",
      expected_attempt: 1,
      expected_revision: 1,
    });
    expect((await getHuntRunForProject(db, projectId, runId))?.status)
      .toBe("completed");

    const reworked = await reworkHuntRun(db, projectId, {
      runId,
      workflowStage: proposal!.workflow_stage,
      requestId: proposalId,
      actor: "briar-app:owner",
      reason: proposal!.reason,
      occurredAt: atMinute(79),
      completed: { expectedAttempt: 1, expectedRevision: 1 },
    });
    const accepted = await acceptIssueReworkProposal(db, {
      projectId,
      runId,
      proposalId,
      userId: "owner",
      acceptedAt: atMinute(79),
      appliedRevision: reworked.revision!,
    });
    expect(accepted).toMatchObject({ status: "accepted", applied_revision: 2 });

    const run = await getHuntRunForProject(db, projectId, runId);
    expect(run).toMatchObject({
      status: "queued",
      current_attempt: 1,
      current_revision: 2,
      workflow_stage: "implementing",
      branch: "codex/original",
      pull_request_urls: '["https://github.example/pr/1"]',
      commit_sha: null,
      target_sha: null,
      result_summary: null,
      staging_qa_status: null,
      production_qa_status: null,
    });
    expect(await listIssueReworkProposals(db, projectId, runId))
      .toHaveLength(1);
    const oldEvidence = await db
      .prepare(
        `select workflow_stage from briar_run_evidence
         where run_id = ? and attempt = 1 and revision = 1
         order by workflow_stage`,
      )
      .bind(runId)
      .all<{ workflow_stage: string }>();
    expect(oldEvidence.results.map((item) => item.workflow_stage)).toEqual([
      "analyzing",
      "implementing",
    ]);
    const requiredRevisions = await db
      .prepare(
        `select workflow_stage, required_revision from briar_run_stage_revisions
         where run_id = ? order by workflow_stage`,
      )
      .bind(runId)
      .all<{ workflow_stage: string; required_revision: number }>();
    expect(requiredRevisions.results).toEqual([
      { workflow_stage: "implementing", required_revision: 2 },
      { workflow_stage: "pr_open", required_revision: 2 },
      { workflow_stage: "production_qa", required_revision: 2 },
      { workflow_stage: "staging_qa", required_revision: 2 },
    ]);
  });

  it("applies conversation issue writes only after acceptance and rejects stale edits", async () => {
    const sourceKey = "conversation-issue-action";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 81, {
        sourceKey,
        title: "Original title",
        status: "backlog",
        eventKey: `${sourceKey}:backlog`,
      }),
    );
    const updateProposal = await createIssueActionProposal(db, {
      id: "11111111-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId,
      conversationRunId: runId,
      triggerMessageId: "22222222-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      replyMessageId: "33333333-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actionType: "request_issue_update",
      payloadJson: JSON.stringify({ changes: { title: "Approved title" } }),
      createdAt: atMinute(82),
    });
    expect(updateProposal).toMatchObject({ status: "pending" });
    expect((await getHuntRunForProject(db, projectId, runId))?.title)
      .toBe("Original title");

    const accepted = await acceptIssueUpdateProposal(db, {
      projectId,
      conversationRunId: runId,
      proposalId: updateProposal!.id,
      userId: "owner",
      acceptedAt: atMinute(83),
      title: "Approved title",
      description: "Approved description",
      priority: 2,
    });
    expect(accepted).toMatchObject({
      status: "accepted",
      result_run_id: runId,
    });
    expect(await getHuntRunForProject(db, projectId, runId)).toMatchObject({
      title: "Approved title",
      issue_description: "Approved description",
      priority: 2,
    });

    const staleProposal = await createIssueActionProposal(db, {
      id: "44444444-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId,
      conversationRunId: runId,
      triggerMessageId: "55555555-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      replyMessageId: "66666666-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actionType: "request_issue_update",
      payloadJson: JSON.stringify({ changes: { priority: 1 } }),
      createdAt: atMinute(84),
    });
    await updateIssue(db, projectId, runId, {
      title: "Human edit",
      description: "Approved description",
      priority: 3,
      updatedAt: atMinute(85),
    });
    expect(await acceptIssueUpdateProposal(db, {
      projectId,
      conversationRunId: runId,
      proposalId: staleProposal!.id,
      userId: "owner",
      acceptedAt: atMinute(86),
      title: "Human edit",
      description: "Approved description",
      priority: 1,
    })).toBeNull();
    expect((await getIssueActionProposal(
      db,
      projectId,
      runId,
      staleProposal!.id,
    ))?.status).toBe("pending");

    const createProposal = await createIssueActionProposal(db, {
      id: "77777777-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      projectId,
      conversationRunId: runId,
      triggerMessageId: "88888888-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      replyMessageId: "99999999-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      actionType: "request_issue_create",
      payloadJson: JSON.stringify({
        issue: {
          title: "Follow-up",
          description: null,
          priority: null,
          status: "backlog",
        },
      }),
      createdAt: atMinute(87),
    });
    expect(await acceptIssueCreateProposal(db, {
      projectId,
      conversationRunId: runId,
      proposalId: createProposal!.id,
      userId: "owner",
      acceptedAt: atMinute(88),
      resultRunId: runId,
    })).toMatchObject({ status: "accepted", result_run_id: runId });
    expect(await listIssueActionProposals(db, projectId, runId)).toHaveLength(3);
  });

  it("allows manual complete without agent evidence required for run completion", async () => {
    const strictWorkflow = normalizeAutoHuntWorkflow({
      version: 2,
      requirements: [],
      stages: [
        {
          id: "implementing",
          label: "Implement",
          required: true,
          evidence: ["diff"],
        },
        {
          id: "merged",
          label: "Merge",
          required: true,
          evidence: ["merge_commit"],
        },
      ],
      execution: { checkpoints: [] },
      completion: { requiredStages: ["implementing", "merged"] },
    });
    await updateProjectSettings(db, projectId, {
      velenOrg: null,
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: "example/repository",
      workflow: strictWorkflow,
    });
    const sourceKey = "manual-complete-without-evidence";
    const runId = await recordHuntEvent(
      db,
      projectId,
      event("queued", 82, {
        sourceKey,
        eventKey: "move-complete-no-evidence:queued",
      }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("implementing", 83, {
        sourceKey,
        eventKey: "move-complete-no-evidence:implementing",
      }),
    );
    await recordHuntEvent(
      db,
      projectId,
      event("implementing", 84, {
        sourceKey,
        eventKey: "move-complete-no-evidence:merged",
        status: "running",
        workflowStage: "merged",
      }),
    );

    // Agent completion still requires missing evidence.
    await expect(
      recordHuntEvent(
        db,
        projectId,
        event("completed", 85, {
          sourceKey,
          eventKey: "move-complete-no-evidence:agent-complete",
          resultSummary: "Should not complete without evidence",
        }),
      ),
    ).rejects.toThrow("terminal stage merged");

    // Manual board/list move is an operator override and must not surface that
    // error on the issue list.
    expect(
      await moveHuntRun(db, projectId, {
        runId,
        status: "completed",
        workflowStage: null,
        requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        actor: "briar-app:test-user",
        occurredAt: atMinute(86),
      }),
    ).toEqual({
      outcome: "moved",
      status: "completed",
      workflowStage: "merged",
    });
    await expect(getHuntRunForProject(db, projectId, runId)).resolves.toMatchObject({
      status: "completed",
      workflow_stage: "merged",
    });
  });

});
