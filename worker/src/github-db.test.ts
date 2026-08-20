import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import type {
  GithubPullRequestSyncInput,
  HuntEventInput,
  RunPullRequestRow,
} from "./db";
import { createIsolatedTestDatabase } from "./test-helpers/d1";
import {
  claimGithubDelivery,
  connectGithubInstallation,
  completeGithubDelivery,
  completeWorkflowStageLifecycle,
  createOrganization,
  createProject,
  disconnectGithubInstallation,
  getHuntRunForProject,
  getWorkflowProgress,
  recordHuntEvent,
  recordRunEvidence,
  reconcileGithubMergedRuns,
  releaseGithubDelivery,
  reworkHuntRun,
  resumeRunAfterGithubMerge,
  resumeWorkflowCheckpoint,
  startWorkflowStageLifecycle,
  syncGithubPullRequest,
  updateProjectSettings,
} from "./db";

const repository = "example/repository";
const ownerId = "github-db-test-owner";
const baseTime = Date.parse("2030-01-01T00:00:00.000Z");
let timeTick = 0;
let scenarioNumber = 0;
let pullRequestNumber = 100;
let deliveryNumber = 0;

const nextTime = () =>
  new Date(baseTime + timeTick++ * 60_000).toISOString();

const nextDeliveryId = () => {
  deliveryNumber += 1;
  return `github-db-delivery-${deliveryNumber}`;
};

type Checkpoint = {
  key: string;
  stage: "implementing" | "pr_open" | "merged";
  position: "before" | "after";
};

type Scenario = {
  projectId: string;
  runId: string;
  sourceKey: string;
  checkpoint: Checkpoint;
};

const eventFor = (sourceKey: string): HuntEventInput => ({
  source: "issue",
  sourceKey,
  title: `GitHub sync ${sourceKey}`,
  stage: "queued",
  status: "queued",
  workflowStage: null,
  eventKey: `${sourceKey}:queued`,
  occurredAt: nextTime(),
  actor: "vitest",
  repository,
  detail: "Queued for GitHub sync testing",
  priority: null,
  branch: null,
  commitSha: null,
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
});

const workflowFor = (checkpoint: Checkpoint) => {
  const stages = checkpoint.stage === "implementing"
    ? [
        {
          id: "implementing",
          label: "Implement",
          required: false,
          evidence: [],
        },
        {
          id: "pr_open",
          label: "Pull request",
          required: false,
          evidence: [],
        },
        {
          id: "staging_qa",
          label: "Staging QA",
          required: false,
          evidence: [],
        },
      ]
    : checkpoint.stage === "merged"
    ? [
        {
          id: "pr_open",
          label: "Pull request",
          required: false,
          evidence: [],
        },
        {
          id: "merged",
          label: "Merge",
          required: false,
          evidence: [],
        },
      ]
    : [
        {
          id: "pr_open",
          label: "Pull request",
          required: false,
          evidence: [],
        },
        {
          id: "staging_qa",
          label: "Staging QA",
          required: false,
          evidence: [],
        },
      ];
  return normalizeAutoHuntWorkflow({
    version: 2,
    stages,
    execution: { checkpoints: [checkpoint] },
    completion: { requiredStages: [] },
  });
};

describe("GitHub pull request D1 integration", () => {
  let miniflare: Miniflare;
  let db: D1Database;
  let organizationId: string;

  const createScenario = async (
    checkpoint: Checkpoint = {
      key: "project-after-pr_open",
      stage: "pr_open",
      position: "after",
    },
  ): Promise<Scenario> => {
    scenarioNumber += 1;
    const project = await createProject(db, {
      ownerUserId: ownerId,
      organizationId,
      name: `GitHub DB project ${scenarioNumber}`,
      agentTokenHash: scenarioNumber.toString(16).padStart(64, "0"),
    });
    await updateProjectSettings(db, project.id, {
      velenOrg: null,
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: repository,
      workflow: workflowFor(checkpoint),
    });
    const sourceKey = `github-db-${scenarioNumber}`;
    const runId = await recordHuntEvent(
      db,
      project.id,
      eventFor(sourceKey),
    );
    return { projectId: project.id, runId, sourceKey, checkpoint };
  };

  const addPullRequestEvidence = async (
    scenario: Scenario,
    number = ++pullRequestNumber,
    evidenceKey = `pr-open:pull-request:${number}`,
  ) => {
    const url = `https://github.com/${repository}/pull/${number}`;
    await recordRunEvidence(db, scenario.projectId, {
      runId: scenario.runId,
      evidenceKey,
      stage: "pr_open",
      type: "pull_request",
      status: "passed",
      detail: `Pull request #${number} opened`,
      command: "gh pr create",
      url,
      metadata: {
        githubPullRequest: {
          repositoryId: 9001,
          repository,
          pullRequestId: 10_000 + number,
          pullRequestNodeId: `PR_node_${number}`,
          pullRequestNumber: number,
        },
      },
      actor: "vitest",
      observedAt: nextTime(),
    });
    return {
      number,
      url,
      projectId: scenario.projectId,
      runId: scenario.runId,
    };
  };

  const pullRequestEvent = (
    pullRequest: {
      number: number;
      url: string;
      projectId?: string;
      runId?: string;
    },
    state: GithubPullRequestSyncInput["state"],
    overrides: Partial<GithubPullRequestSyncInput> = {},
  ): GithubPullRequestSyncInput => {
    const providerUpdatedAt = nextTime();
    const closed = state === "closed" || state === "merged";
    return {
      deliveryId: nextDeliveryId(),
      installationId: 77,
      repositoryId: 9001,
      repository,
      pullRequestId: 10_000 + pullRequest.number,
      pullRequestNodeId: `PR_node_${pullRequest.number}`,
      pullRequestNumber: pullRequest.number,
      url: pullRequest.url,
      state,
      draft: false,
      headSha: "a".repeat(40),
      baseSha: "b".repeat(40),
      mergeCommitSha: state === "merged" ? "c".repeat(40) : null,
      openedAt: "2029-12-31T00:00:00.000Z",
      closedAt: closed ? providerUpdatedAt : null,
      mergedAt: state === "merged" ? providerUpdatedAt : null,
      providerUpdatedAt,
      linkedIssues: pullRequest.projectId && pullRequest.runId
        ? [{ projectId: pullRequest.projectId, runId: pullRequest.runId }]
        : [],
      actor: "github-webhook",
      observedAt: nextTime(),
      ...overrides,
    };
  };

  const pauseAtConfiguredCheckpoint = async (scenario: Scenario) => {
    const started = await startWorkflowStageLifecycle(
      db,
      scenario.projectId,
      {
        runId: scenario.runId,
        stageId: scenario.checkpoint.stage,
        startedAt: nextTime(),
        actor: "vitest",
      },
    );
    if (scenario.checkpoint.position === "before") {
      expect(started).toMatchObject({
        outcome: "paused",
        checkpoint: { key: scenario.checkpoint.key },
      });
      return;
    }
    expect(started.outcome).toBe("started");
    await expect(
      completeWorkflowStageLifecycle(db, scenario.projectId, {
        runId: scenario.runId,
        stageId: scenario.checkpoint.stage,
        finishedAt: nextTime(),
      }),
    ).resolves.toMatchObject({
      outcome: "paused",
      checkpoint: { key: scenario.checkpoint.key },
    });
  };

  const useSinglePullRequestPause = async (scenario: Scenario) => {
    const workflow = workflowFor(scenario.checkpoint);
    await db
      .prepare(
        `update briar_hunt_runs set workflow_snapshot_json = ?
         where id = ? and project_id = ?`,
      )
      .bind(
        JSON.stringify({
          version: 2,
          requirements: workflow.requirements,
          stages: workflow.stages,
          execution: {
            checkpoints: [{
              key: "project-after-pr_open",
              stage: "pr_open",
              position: "after",
            }],
          },
          completion: workflow.completion,
        }),
        scenario.runId,
        scenario.projectId,
      )
      .run();
  };

  const pullRequestRow = async (
    scenario: Scenario,
    url: string,
  ) =>
    db
      .prepare(
        `select * from briar_run_pull_requests
         where project_id = ? and run_id = ? and url = ?`,
      )
      .bind(scenario.projectId, scenario.runId, url)
      .first<RunPullRequestRow>();

  beforeAll(async () => {
    const database = await createIsolatedTestDatabase({
      suite: "github-db",
    });
    miniflare = database.miniflare;
    db = database.db;
    const createdAt = nextTime();
    await db
      .prepare(
        `insert into "user" (
           id, name, email, emailVerified, createdAt, updatedAt
         ) values (?, ?, ?, 1, ?, ?)`,
      )
      .bind(
        ownerId,
        "GitHub DB Test Owner",
        "github-db-test@example.com",
        createdAt,
        createdAt,
      )
      .run();
    const organization = await createOrganization(db, {
      name: "GitHub DB Test Organization",
      handle: "github-db-test",
      ownerUserId: ownerId,
    });
    organizationId = organization.id;
  }, 60_000);

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("links pull_request evidence to the current attempt and revision", async () => {
    const scenario = await createScenario();
    await db
      .prepare(
        `update briar_hunt_runs
         set current_attempt = 2, current_revision = 3
         where id = ? and project_id = ?`,
      )
      .bind(scenario.runId, scenario.projectId)
      .run();

    const pullRequest = await addPullRequestEvidence(scenario);
    const link = await pullRequestRow(scenario, pullRequest.url);

    expect(link).toMatchObject({
      project_id: scenario.projectId,
      run_id: scenario.runId,
      attempt: 2,
      revision: 3,
      url: pullRequest.url,
      state: "unknown",
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({ pull_request_urls: JSON.stringify([pullRequest.url]) });
  });

  it("rejects new URL-only evidence before storing a false success", async () => {
    const scenario = await createScenario();
    const number = ++pullRequestNumber;
    const url = `https://github.com/${repository}/pull/${number}`;
    await expect(
      recordRunEvidence(db, scenario.projectId, {
        runId: scenario.runId,
        evidenceKey: `legacy-pr-open:${number}`,
        stage: "pr_open",
        type: "pull_request",
        status: "passed",
        detail: "Recorded by a legacy CLI without immutable GitHub IDs",
        command: "gh pr create",
        url,
        metadata: null,
        actor: "legacy-cli",
        observedAt: nextTime(),
      }),
    ).rejects.toThrow("update and use the bundled Briar CLI");

    await expect(pullRequestRow(scenario, url)).resolves.toBeNull();
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({ pull_request_urls: "[]" });
    await expect(
      db
        .prepare(
          `select count(*) as count from briar_run_evidence
           where project_id = ? and run_id = ?`,
        )
        .bind(scenario.projectId, scenario.runId)
        .first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 0 });
    await expect(
      syncGithubPullRequest(db, pullRequestEvent({ number, url }, "merged")),
    ).resolves.toMatchObject({
      matchedRunCount: 0,
      updatedRunCount: 0,
      resumedRunCount: 0,
    });
  });

  it("does not authorize a pull request from another repository", async () => {
    const scenario = await createScenario();
    const number = ++pullRequestNumber;
    const pullRequest = {
      number,
      url: `https://github.com/other/repository/pull/${number}`,
    };
    await expect(
      recordRunEvidence(db, scenario.projectId, {
        runId: scenario.runId,
        evidenceKey: `pr-open:pull-request:${number}`,
        stage: "pr_open",
        type: "pull_request",
        status: "passed",
        detail: `Pull request #${number} opened in another repository`,
        command: "gh pr create",
        url: pullRequest.url,
        metadata: {
          githubPullRequest: {
            repositoryId: 9002,
            repository: "other/repository",
            pullRequestId: 20_000 + number,
            pullRequestNodeId: `PR_other_${number}`,
            pullRequestNumber: number,
          },
        },
        actor: "vitest",
        observedAt: nextTime(),
      }),
    ).rejects.toThrow("configured GitHub repository");
    await pauseAtConfiguredCheckpoint(scenario);

    await expect(
      pullRequestRow(scenario, pullRequest.url),
    ).resolves.toBeNull();
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      pull_request_urls: "[]",
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });

    await expect(
      syncGithubPullRequest(db, pullRequestEvent(pullRequest, "merged", {
        repositoryId: 9002,
        repository: "other/repository",
      })),
    ).resolves.toMatchObject({
      matchedRunCount: 0,
      updatedRunCount: 0,
      resumedRunCount: 0,
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });
  });

  it("fences evidence writes from a superseded worker claim", async () => {
    const scenario = await createScenario();
    const number = ++pullRequestNumber;
    const url = `https://github.com/${repository}/pull/${number}`;
    const authenticatedClaimHash = "a".repeat(64);
    await db
      .prepare(
        `update briar_hunt_runs
         set claim_token_hash = ?, lease_expires_at = ?
         where id = ? and project_id = ?`,
      )
      .bind(
        "b".repeat(64),
        "2099-01-01T00:00:00.000Z",
        scenario.runId,
        scenario.projectId,
      )
      .run();

    await expect(
      recordRunEvidence(db, scenario.projectId, {
        runId: scenario.runId,
        evidenceKey: `pr-open:stale-claim:${number}`,
        stage: "pr_open",
        type: "pull_request",
        status: "passed",
        detail: "This request authenticated before the claim changed",
        command: "gh pr create",
        url,
        metadata: {
          githubPullRequest: {
            repositoryId: 9001,
            repository,
            pullRequestId: 10_000 + number,
            pullRequestNodeId: `PR_node_${number}`,
            pullRequestNumber: number,
          },
        },
        actor: "stale-worker",
        observedAt: nextTime(),
      }, {
        claimTokenHash: authenticatedClaimHash,
        authenticatedAt: new Date().toISOString(),
      }),
    ).rejects.toThrow("Run claim or revision changed");
    await expect(pullRequestRow(scenario, url)).resolves.toBeNull();
    await expect(
      db
        .prepare(
          `select count(*) as count from briar_run_evidence
           where project_id = ? and run_id = ?`,
        )
        .bind(scenario.projectId, scenario.runId)
        .first<{ count: number }>(),
    ).resolves.toMatchObject({ count: 0 });
  });

  it("does not trust a worker-supplied repository ID with another signed name", async () => {
    const scenario = await createScenario();
    const number = ++pullRequestNumber;
    const configuredUrl = `https://github.com/${repository}/pull/${number}`;
    const otherRepositoryMerge = pullRequestEvent({
      number,
      url: configuredUrl,
    }, "merged", {
      repositoryId: 9002,
      repository: "other/repository",
      pullRequestId: 20_000 + number,
      pullRequestNodeId: `PR_other_${number}`,
      linkedIssues: [{ projectId: scenario.projectId, runId: scenario.runId }],
    });
    await syncGithubPullRequest(db, otherRepositoryMerge);

    await recordRunEvidence(db, scenario.projectId, {
      runId: scenario.runId,
      evidenceKey: `pr-open:forged-repository-id:${number}`,
      stage: "pr_open",
      type: "pull_request",
      status: "passed",
      detail: `Pull request #${number} opened`,
      command: "gh pr create",
      url: configuredUrl,
      metadata: {
        githubPullRequest: {
          repositoryId: 9002,
          repository,
          pullRequestId: 20_000 + number,
          pullRequestNodeId: `PR_other_${number}`,
          pullRequestNumber: number,
        },
      },
      actor: "untrusted-worker",
      observedAt: nextTime(),
    });
    await expect(
      pullRequestRow(scenario, configuredUrl),
    ).resolves.toMatchObject({ state: "unknown", last_delivery_id: null });
    await pauseAtConfiguredCheckpoint(scenario);

    await expect(
      syncGithubPullRequest(db, otherRepositoryMerge),
    ).resolves.toMatchObject({
      matchedRunCount: 0,
      updatedRunCount: 0,
      resumedRunCount: 0,
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });
  });

  it("canonicalizes decorated GitHub pull request evidence URLs", async () => {
    const scenario = await createScenario();
    const number = ++pullRequestNumber;
    const canonicalUrl = `https://github.com/${repository}/pull/${number}`;
    const decoratedUrl = `${canonicalUrl}/?diff=split#discussion_r1`;
    await recordRunEvidence(db, scenario.projectId, {
      runId: scenario.runId,
      evidenceKey: `pr-open:pull-request:${number}`,
      stage: "pr_open",
      type: "pull_request",
      status: "passed",
      detail: `Pull request #${number} opened`,
      command: "gh pr create",
      url: decoratedUrl,
      metadata: {
        githubPullRequest: {
          repositoryId: 9001,
          repository,
          pullRequestId: 10_000 + number,
          pullRequestNodeId: `PR_node_${number}`,
          pullRequestNumber: number,
        },
      },
      actor: "vitest",
      observedAt: nextTime(),
    });

    await expect(
      pullRequestRow(scenario, decoratedUrl),
    ).resolves.toBeNull();
    await expect(
      pullRequestRow(scenario, canonicalUrl),
    ).resolves.toMatchObject({ state: "unknown", url: canonicalUrl });
    await pauseAtConfiguredCheckpoint(scenario);
    await expect(
      syncGithubPullRequest(db, pullRequestEvent({
        number,
        url: canonicalUrl,
        projectId: scenario.projectId,
        runId: scenario.runId,
      }, "merged")),
    ).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 1,
    });
  });

  it("keeps reused repository names separated by immutable identity", async () => {
    const scenario = await createScenario();
    const number = ++pullRequestNumber;
    const pullRequest = {
      number,
      url: `https://github.com/${repository}/pull/${number}`,
      projectId: scenario.projectId,
      runId: scenario.runId,
    };
    await addPullRequestEvidence(
      scenario,
      number,
      `pr-open:original-repository:${number}`,
    );
    await recordRunEvidence(db, scenario.projectId, {
      runId: scenario.runId,
      evidenceKey: `pr-open:recreated-repository:${number}`,
      stage: "pr_open",
      type: "pull_request",
      status: "passed",
      detail: `Pull request #${number} opened after repository recreation`,
      command: "gh pr create",
      url: pullRequest.url,
      metadata: {
        githubPullRequest: {
          repositoryId: 9002,
          repository,
          pullRequestId: 20_000 + number,
          pullRequestNodeId: `PR_recreated_${number}`,
          pullRequestNumber: number,
        },
      },
      actor: "vitest",
      observedAt: nextTime(),
    });

    await expect(
      db
        .prepare(
          `select repository_id from briar_run_pull_requests
           where project_id = ? and run_id = ?
           order by repository_id`,
        )
        .bind(scenario.projectId, scenario.runId)
        .all<{ repository_id: number }>(),
    ).resolves.toMatchObject({
      results: [{ repository_id: 9001 }, { repository_id: 9002 }],
    });

    await pauseAtConfiguredCheckpoint(scenario);
    await expect(
      syncGithubPullRequest(db, pullRequestEvent(pullRequest, "merged")),
    ).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 0,
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });

    await expect(
      syncGithubPullRequest(db, pullRequestEvent(pullRequest, "merged", {
        repositoryId: 9002,
        pullRequestId: 20_000 + number,
        pullRequestNodeId: `PR_recreated_${number}`,
      })),
    ).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 1,
    });
  });

  it("synchronizes a current pull request from open to merged", async () => {
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);

    await expect(
      syncGithubPullRequest(db, pullRequestEvent(pullRequest, "open")),
    ).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 0,
    });
    expect(await pullRequestRow(scenario, pullRequest.url)).toMatchObject({
      repository_id: 9001,
      repository,
      pull_request_number: pullRequest.number,
      state: "open",
    });
    const merged = pullRequestEvent(pullRequest, "merged");
    await expect(syncGithubPullRequest(db, merged)).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 0,
      resumeOutcomes: [{ runId: scenario.runId, outcome: "ineligible" }],
    });

    expect(await pullRequestRow(scenario, pullRequest.url)).toMatchObject({
      repository_id: 9001,
      repository,
      pull_request_number: pullRequest.number,
      state: "merged",
      merge_commit_sha: "c".repeat(40),
      merged_at: merged.mergedAt,
      last_delivery_id: merged.deliveryId,
    });

    const postMergeClose = pullRequestEvent(pullRequest, "closed");
    await syncGithubPullRequest(db, postMergeClose);
    expect(await pullRequestRow(scenario, pullRequest.url)).toMatchObject({
      state: "merged",
      last_delivery_id: merged.deliveryId,
    });
    await expect(
      db
        .prepare(
          `select state, last_delivery_id from briar_github_pull_requests
           where repository_id = ? and pull_request_number = ?`,
        )
        .bind(merged.repositoryId, pullRequest.number)
        .first(),
    ).resolves.toMatchObject({
      state: "merged",
      last_delivery_id: merged.deliveryId,
    });
  });

  it("restricts a mapped installation to projects in its Briar organization", async () => {
    const otherOrganization = await createOrganization(db, {
      name: `Other GitHub organization ${scenarioNumber}`,
      handle: `other-github-${scenarioNumber}`,
      ownerUserId: ownerId,
    });
    await expect(connectGithubInstallation(db, {
      organizationId: otherOrganization.id,
      installationId: 177,
      installationAccountId: 277,
      accountLogin: "other-github-org",
      accountAvatarUrl: "https://avatars.githubusercontent.com/u/277?v=4",
      authorizedGithubUserId: 377,
      authorizedGithubUserLogin: "octocat",
      connectedByUserId: ownerId,
      repositories: [],
      observedAt: nextTime(),
    })).resolves.toEqual({ outcome: "connected" });

    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    await pauseAtConfiguredCheckpoint(scenario);
    await expect(syncGithubPullRequest(
      db,
      pullRequestEvent(pullRequest, "merged", {
        installationId: 177,
        organizationId: otherOrganization.id,
      }),
    )).resolves.toMatchObject({
      matchedRunCount: 0,
      updatedRunCount: 0,
      resumedRunCount: 0,
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });
  });

  it("quarantines merged snapshots when an installation disconnects", async () => {
    await expect(connectGithubInstallation(db, {
      organizationId,
      installationId: 178,
      installationAccountId: 278,
      accountLogin: "github-db-test",
      accountAvatarUrl: "https://avatars.githubusercontent.com/u/278?v=4",
      authorizedGithubUserId: 378,
      authorizedGithubUserLogin: "octocat",
      connectedByUserId: ownerId,
      repositories: [],
      observedAt: nextTime(),
    })).resolves.toEqual({ outcome: "connected" });
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    await expect(syncGithubPullRequest(
      db,
      pullRequestEvent(pullRequest, "merged", {
        installationId: 178,
        organizationId,
      }),
    )).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 0,
    });

    await disconnectGithubInstallation(db, organizationId, nextTime());
    await pauseAtConfiguredCheckpoint(scenario);
    await expect(reconcileGithubMergedRuns(db)).resolves.toMatchObject({
      resumed: 0,
    });
    await expect(pullRequestRow(scenario, pullRequest.url)).resolves
      .toMatchObject({ state: "unknown", last_delivery_id: null });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });
  });

  it("accepts a delivery rounded down to the revision-start second", async () => {
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    const revisionStartedAt = "2035-01-01T00:00:12.789Z";
    const providerUpdatedAt = "2035-01-01T00:00:12.000Z";
    await db
      .prepare(
        `update briar_run_pull_requests
         set revision_started_at = ?, created_at = ?
         where project_id = ? and run_id = ?`,
      )
      .bind(
        revisionStartedAt,
        revisionStartedAt,
        scenario.projectId,
        scenario.runId,
      )
      .run();
    await pauseAtConfiguredCheckpoint(scenario);

    await expect(
      syncGithubPullRequest(db, pullRequestEvent(pullRequest, "merged", {
        providerUpdatedAt,
        closedAt: providerUpdatedAt,
        mergedAt: providerUpdatedAt,
        observedAt: "2035-01-01T00:00:13.000Z",
      })),
    ).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 1,
    });
  });

  it("resumes only a waiting checkpoint after pr_open", async () => {
    const eligible = await createScenario();
    const eligiblePullRequest = await addPullRequestEvidence(eligible);
    await pauseAtConfiguredCheckpoint(eligible);

    const eligibleMerge = pullRequestEvent(eligiblePullRequest, "merged");
    await expect(syncGithubPullRequest(db, eligibleMerge)).resolves.toMatchObject({
      resumedRunCount: 1,
      resumeOutcomes: [{ runId: eligible.runId, outcome: "resumed" }],
    });
    await expect(
      getHuntRunForProject(db, eligible.projectId, eligible.runId),
    ).resolves.toMatchObject({
      resume_requested_at: eligibleMerge.mergedAt,
      waiting_checkpoint_key: null,
      workflow_stage: "staging_qa",
    });
    await expect(
      getWorkflowProgress(db, eligible.projectId, eligible.runId),
    ).resolves.toMatchObject({
      waitingCheckpoint: null,
      checkpoints: [
        expect.objectContaining({
          checkpoint_key: eligible.checkpoint.key,
          state: "approved",
          approved_request_id: `github:${eligibleMerge.deliveryId}`,
        }),
      ],
    });

    for (const checkpoint of [
      { key: "project-before-pr_open", stage: "pr_open", position: "before" },
      { key: "project-after-implementing", stage: "implementing", position: "after" },
    ] as const) {
      const ineligible = await createScenario(checkpoint);
      const pullRequest = await addPullRequestEvidence(ineligible);
      await pauseAtConfiguredCheckpoint(ineligible);
      await expect(
        syncGithubPullRequest(db, pullRequestEvent(pullRequest, "merged")),
      ).resolves.toMatchObject({
        resumedRunCount: 0,
        resumeOutcomes: [{ runId: ineligible.runId, outcome: "ineligible" }],
      });
      await expect(
        getHuntRunForProject(db, ineligible.projectId, ineligible.runId),
      ).resolves.toMatchObject({
        resume_requested_at: null,
        waiting_checkpoint_key: checkpoint.key,
      });
    }
  });

  it("does not resume when a pull request closes without merging", async () => {
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    await pauseAtConfiguredCheckpoint(scenario);

    await expect(
      syncGithubPullRequest(db, pullRequestEvent(pullRequest, "closed")),
    ).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 0,
      resumeOutcomes: [],
    });
    expect(await pullRequestRow(scenario, pullRequest.url)).toMatchObject({
      state: "closed",
      merged_at: null,
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });
  });

  it("promotes a delayed merge over a newer closed update", async () => {
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    await pauseAtConfiguredCheckpoint(scenario);
    const delayedMerge = pullRequestEvent(pullRequest, "merged");
    const newerClosedUpdate = pullRequestEvent(pullRequest, "closed");

    await expect(
      syncGithubPullRequest(db, newerClosedUpdate),
    ).resolves.toMatchObject({ resumedRunCount: 0 });
    await expect(
      syncGithubPullRequest(db, delayedMerge),
    ).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 1,
    });
    await expect(
      pullRequestRow(scenario, pullRequest.url),
    ).resolves.toMatchObject({
      state: "merged",
      last_delivery_id: delayedMerge.deliveryId,
    });
  });

  it("keeps a bound pull request matched across a repository rename", async () => {
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    await syncGithubPullRequest(db, pullRequestEvent(pullRequest, "open"));
    await pauseAtConfiguredCheckpoint(scenario);

    const renamedRepository = "example/renamed-repository";
    const merge = pullRequestEvent({
      ...pullRequest,
      url: `https://github.com/${renamedRepository}/pull/${pullRequest.number}`,
    }, "merged", {
      repository: renamedRepository,
    });
    await expect(syncGithubPullRequest(db, merge)).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 1,
    });
    await expect(
      pullRequestRow(scenario, merge.url),
    ).resolves.toMatchObject({
      repository_id: merge.repositoryId,
      repository: renamedRepository,
      state: "merged",
    });
  });

  it("claims deliveries idempotently and permits a released claim to retry", async () => {
    const deliveryId = nextDeliveryId();
    const firstClaimAt = nextTime();
    const input = {
      deliveryId,
      eventName: "pull_request",
      action: "closed",
      claimedAt: firstClaimAt,
      staleBefore: new Date(Date.parse(firstClaimAt) - 5 * 60_000).toISOString(),
    };

    await expect(claimGithubDelivery(db, input)).resolves.toBe(true);
    await expect(claimGithubDelivery(db, input)).resolves.toBe(false);
    await releaseGithubDelivery(db, deliveryId, firstClaimAt);

    const retryClaimAt = nextTime();
    await expect(
      claimGithubDelivery(db, {
        ...input,
        claimedAt: retryClaimAt,
        staleBefore: new Date(Date.parse(retryClaimAt) - 5 * 60_000).toISOString(),
      }),
    ).resolves.toBe(true);
    await completeGithubDelivery(db, deliveryId, retryClaimAt, nextTime());
    await releaseGithubDelivery(db, deliveryId, retryClaimAt);
    await expect(
      claimGithubDelivery(db, {
        ...input,
        claimedAt: nextTime(),
        staleBefore: retryClaimAt,
      }),
    ).resolves.toBe(false);
  });

  it("fences a stale delivery owner after another worker takes over", async () => {
    const deliveryId = nextDeliveryId();
    const firstClaimAt = nextTime();
    await claimGithubDelivery(db, {
      deliveryId,
      eventName: "pull_request",
      action: "closed",
      claimedAt: firstClaimAt,
      staleBefore: new Date(Date.parse(firstClaimAt) - 5 * 60_000).toISOString(),
    });
    const takeoverAt = new Date(
      Date.parse(firstClaimAt) + 10 * 60_000,
    ).toISOString();
    await expect(
      claimGithubDelivery(db, {
        deliveryId,
        eventName: "pull_request",
        action: "closed",
        claimedAt: takeoverAt,
        staleBefore: new Date(Date.parse(takeoverAt) - 5 * 60_000).toISOString(),
      }),
    ).resolves.toBe(true);

    await expect(
      releaseGithubDelivery(db, deliveryId, firstClaimAt),
    ).resolves.toBe(false);
    await expect(
      completeGithubDelivery(db, deliveryId, firstClaimAt, nextTime()),
    ).resolves.toBe(false);
    await expect(
      db
        .prepare(
          `select status, claimed_at from briar_github_deliveries
           where delivery_id = ?`,
        )
        .bind(deliveryId)
        .first(),
    ).resolves.toMatchObject({ status: "processing", claimed_at: takeoverAt });
    await expect(
      completeGithubDelivery(db, deliveryId, takeoverAt, nextTime()),
    ).resolves.toBe(true);
  });

  it("reconciles a merge that arrived before the run paused", async () => {
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    const merge = pullRequestEvent(pullRequest, "merged");

    await expect(syncGithubPullRequest(db, merge)).resolves.toMatchObject({
      updatedRunCount: 1,
      resumedRunCount: 0,
      resumeOutcomes: [{ runId: scenario.runId, outcome: "ineligible" }],
    });
    await pauseAtConfiguredCheckpoint(scenario);

    await expect(
      resumeRunAfterGithubMerge(db, scenario.projectId, scenario.runId),
    ).resolves.toEqual({ outcome: "resumed" });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: merge.mergedAt,
      waiting_checkpoint_key: null,
    });
  });

  it("does not infer a checkpoint from a status event after a merge", async () => {
    const scenario = await createScenario();
    await useSinglePullRequestPause(scenario);
    const pullRequest = await addPullRequestEvidence(scenario);
    const merge = pullRequestEvent(pullRequest, "merged");

    await expect(syncGithubPullRequest(db, merge)).resolves.toMatchObject({
      updatedRunCount: 1,
      resumedRunCount: 0,
      resumeOutcomes: [{ runId: scenario.runId, outcome: "ineligible" }],
    });
    const pausedAt = nextTime();
    await recordHuntEvent(db, scenario.projectId, {
      ...eventFor(scenario.sourceKey),
      stage: "pr_open",
      status: "running",
      workflowStage: "pr_open",
      eventKey: `${scenario.sourceKey}:status-pr-open`,
      occurredAt: pausedAt,
      pullRequestUrls: [pullRequest.url],
    });

    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      status: "running",
      stage: "pr_open",
      workflow_stage: "pr_open",
      paused_at: null,
      resume_requested_at: null,
      waiting_checkpoint_key: null,
    });
  });

  it("keeps status-event replay idempotent without checkpoint identity", async () => {
    const scenario = await createScenario();
    await useSinglePullRequestPause(scenario);
    const pullRequest = await addPullRequestEvidence(scenario);
    const pausedAt = nextTime();
    const statusEvent: HuntEventInput = {
      ...eventFor(scenario.sourceKey),
      stage: "pr_open",
      status: "running",
      workflowStage: "pr_open",
      eventKey: `${scenario.sourceKey}:retryable-status-pr-open`,
      occurredAt: pausedAt,
      pullRequestUrls: [pullRequest.url],
    };
    await recordHuntEvent(db, scenario.projectId, statusEvent);
    const mergedAt = nextTime();
    const deliveryId = nextDeliveryId();
    await db
      .prepare(
        `update briar_run_pull_requests
         set state = 'merged', merged_at = ?, provider_updated_at = ?,
             last_delivery_id = ?, updated_at = ?
         where project_id = ? and run_id = ? and url = ?`,
      )
      .bind(
        mergedAt,
        mergedAt,
        deliveryId,
        mergedAt,
        scenario.projectId,
        scenario.runId,
        pullRequest.url,
      )
      .run();

    await expect(
      recordHuntEvent(db, scenario.projectId, statusEvent),
    ).resolves.toBe(scenario.runId);
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      stage: "pr_open",
      workflow_stage: "pr_open",
      paused_at: null,
      resume_requested_at: null,
    });
  });

  it("does not adopt a merge delivery that predates PR evidence", async () => {
    const scenario = await createScenario();
    const number = ++pullRequestNumber;
    const pullRequest = {
      number,
      url: `https://github.com/${repository}/pull/${number}`,
    };
    const merge = pullRequestEvent(pullRequest, "merged");

    await expect(syncGithubPullRequest(db, merge)).resolves.toMatchObject({
      matchedRunCount: 0,
      updatedRunCount: 0,
      resumedRunCount: 0,
    });
    await addPullRequestEvidence(scenario, number);
    expect(await pullRequestRow(scenario, pullRequest.url)).toMatchObject({
      state: "unknown",
      repository_id: merge.repositoryId,
      pull_request_number: number,
      last_delivery_id: null,
    });

    await pauseAtConfiguredCheckpoint(scenario);
    await expect(
      resumeRunAfterGithubMerge(db, scenario.projectId, scenario.runId),
    ).resolves.toEqual({ outcome: "not_ready" });
  });

  it("adopts a signed merge snapshot for evidence that finishes after the webhook", async () => {
    const first = await createScenario();
    const second = await createScenario();
    const pullRequest = await addPullRequestEvidence(first);
    await updateProjectSettings(db, second.projectId, {
      velenOrg: null,
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: null,
      workflow: workflowFor(second.checkpoint),
    });
    const secondEvidence = {
      runId: second.runId,
      evidenceKey: `pr-open:in-flight:${pullRequest.number}`,
      stage: "pr_open",
      type: "pull_request",
      status: "passed" as const,
      detail: "Evidence request authenticated before the merge webhook",
      command: "gh pr create",
      url: pullRequest.url,
      metadata: {
        githubPullRequest: {
          repositoryId: 9001,
          repository,
          pullRequestId: 10_000 + pullRequest.number,
          pullRequestNodeId: `PR_node_${pullRequest.number}`,
          pullRequestNumber: pullRequest.number,
        },
      },
      actor: "vitest",
      observedAt: nextTime(),
    };
    await recordRunEvidence(db, second.projectId, secondEvidence);
    await updateProjectSettings(db, second.projectId, {
      velenOrg: null,
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: repository,
      workflow: workflowFor(second.checkpoint),
    });
    const associationStartedAt = "2035-01-01T00:00:00.000Z";
    const webhookAt = "2035-01-01T00:00:01.000Z";
    const evidenceRecordedAt = "2035-01-01T00:00:02.000Z";
    await db
      .prepare(
        `update briar_run_evidence
         set github_association_started_at = ?, recorded_at = ?
         where run_id = ? and evidence_key = ?`,
      )
      .bind(
        associationStartedAt,
        evidenceRecordedAt,
        second.runId,
        secondEvidence.evidenceKey,
      )
      .run();
    const merge = pullRequestEvent(pullRequest, "merged", {
      providerUpdatedAt: webhookAt,
      closedAt: webhookAt,
      mergedAt: webhookAt,
      observedAt: webhookAt,
      linkedIssues: [
        { projectId: first.projectId, runId: first.runId },
        { projectId: second.projectId, runId: second.runId },
      ],
    });

    await expect(syncGithubPullRequest(db, merge)).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
    });
    await recordRunEvidence(db, second.projectId, secondEvidence);
    await expect(
      pullRequestRow(second, pullRequest.url),
    ).resolves.toMatchObject({
      state: "merged",
      last_delivery_id: merge.deliveryId,
    });

    await pauseAtConfiguredCheckpoint(second);
    await expect(reconcileGithubMergedRuns(db)).resolves.toMatchObject({
      examined: 1,
      resumed: 1,
    });
    await expect(
      getHuntRunForProject(db, second.projectId, second.runId),
    ).resolves.toMatchObject({
      resume_requested_at: merge.mergedAt,
      waiting_checkpoint_key: null,
    });
  });

  it("rejects a merge timestamp older than its evidence link", async () => {
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    const evidenceLinkedAt = "2035-01-01T00:00:00.000Z";
    await db
      .prepare(
        `update briar_run_pull_requests set created_at = ?
         where project_id = ? and run_id = ?`,
      )
      .bind(evidenceLinkedAt, scenario.projectId, scenario.runId)
      .run();
    await pauseAtConfiguredCheckpoint(scenario);
    const mergedAt = "2034-12-31T23:59:59.000Z";
    const providerUpdatedAt = "2036-01-01T00:00:00.000Z";

    await expect(
      syncGithubPullRequest(db, pullRequestEvent(pullRequest, "merged", {
        mergedAt,
        closedAt: mergedAt,
        providerUpdatedAt,
      })),
    ).resolves.toMatchObject({
      matchedRunCount: 0,
      updatedRunCount: 0,
      resumedRunCount: 0,
    });
    await expect(
      pullRequestRow(scenario, pullRequest.url),
    ).resolves.toMatchObject({ state: "unknown", last_delivery_id: null });
  });

  it("does not adopt a provider snapshot older than the run revision", async () => {
    const scenario = await createScenario();
    const run = await db
      .prepare(
        `select created_at from briar_hunt_runs
         where id = ? and project_id = ?`,
      )
      .bind(scenario.runId, scenario.projectId)
      .first<{ created_at: string }>();
    expect(run).not.toBeNull();
    const number = ++pullRequestNumber;
    const pullRequest = {
      number,
      url: `https://github.com/${repository}/pull/${number}`,
    };
    const staleAt = new Date(
      Date.parse(run!.created_at) - 60_000,
    ).toISOString();
    await syncGithubPullRequest(db, pullRequestEvent(pullRequest, "merged", {
      providerUpdatedAt: staleAt,
      closedAt: staleAt,
      mergedAt: staleAt,
    }));

    await addPullRequestEvidence(scenario, number);
    await expect(
      pullRequestRow(scenario, pullRequest.url),
    ).resolves.toMatchObject({
      state: "unknown",
      repository_id: 9001,
      last_delivery_id: null,
    });
    await expect(
      syncGithubPullRequest(db, pullRequestEvent(pullRequest, "merged", {
        providerUpdatedAt: staleAt,
        closedAt: staleAt,
        mergedAt: staleAt,
      })),
    ).resolves.toMatchObject({
      matchedRunCount: 0,
      updatedRunCount: 0,
      resumedRunCount: 0,
    });
    await expect(
      pullRequestRow(scenario, pullRequest.url),
    ).resolves.toMatchObject({ state: "unknown", repository_id: 9001 });
  });

  it("does not reuse a merge from an earlier run revision", async () => {
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    await syncGithubPullRequest(db, pullRequestEvent(pullRequest, "merged"));
    await pauseAtConfiguredCheckpoint(scenario);
    const reworkedAt = nextTime();
    await expect(
      reworkHuntRun(db, scenario.projectId, {
        runId: scenario.runId,
        workflowStage: "pr_open",
        requestId: crypto.randomUUID(),
        actor: "vitest",
        reason: "Require a fresh pull request review",
        occurredAt: reworkedAt,
      }),
    ).resolves.toMatchObject({ outcome: "reworked", revision: 2 });

    await addPullRequestEvidence(
      scenario,
      pullRequest.number,
      "pr-open:pull-request:revision-2",
    );
    await expect(
      db
        .prepare(
          `select revision, revision_started_at, state, repository_id,
                  last_delivery_id
           from briar_run_pull_requests
           where project_id = ? and run_id = ? and revision = 2 and url = ?`,
        )
        .bind(scenario.projectId, scenario.runId, pullRequest.url)
        .first(),
    ).resolves.toMatchObject({
      revision: 2,
      revision_started_at: reworkedAt,
      state: "unknown",
      repository_id: 9001,
      last_delivery_id: null,
    });
  });

  it("sweeps a durable merged state after immediate reconciliation fails", async () => {
    const scenario = await createScenario();
    const pullRequest = await addPullRequestEvidence(scenario);
    await pauseAtConfiguredCheckpoint(scenario);
    const mergedAt = nextTime();
    await db
      .prepare(
        `update briar_run_pull_requests
         set state = 'merged', merged_at = ?, provider_updated_at = ?,
             last_delivery_id = ?, updated_at = ?
         where project_id = ? and run_id = ? and url = ?`,
      )
      .bind(
        mergedAt,
        mergedAt,
        nextDeliveryId(),
        mergedAt,
        scenario.projectId,
        scenario.runId,
        pullRequest.url,
      )
      .run();

    await expect(reconcileGithubMergedRuns(db)).resolves.toMatchObject({
      examined: 1,
      resumed: 1,
      deferred: 0,
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: mergedAt,
      waiting_checkpoint_key: null,
    });
  });

  it("does not resume from a pull request linked to a stale revision", async () => {
    const scenario = await createScenario();
    const stalePullRequest = await addPullRequestEvidence(scenario);
    await db
      .prepare(
        `update briar_hunt_runs
         set current_revision = 2
         where id = ? and project_id = ?`,
      )
      .bind(scenario.runId, scenario.projectId)
      .run();
    await pauseAtConfiguredCheckpoint(scenario);

    const staleMerge = pullRequestEvent(stalePullRequest, "merged");
    await expect(
      syncGithubPullRequest(db, staleMerge),
    ).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 0,
      resumeOutcomes: [],
    });
    expect(await pullRequestRow(scenario, stalePullRequest.url)).toMatchObject({
      revision: 1,
      state: "merged",
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      current_revision: 2,
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });
    await expect(
      db
        .prepare(
          `select count(*) as count from briar_hunt_events
           where run_id = ? and event_key = ?`,
        )
        .bind(scenario.runId, `github:pull_request:${staleMerge.deliveryId}`)
        .first<number>("count"),
    ).resolves.toBe(0);
  });

  it("waits for every current pull request at the canonical merge checkpoint", async () => {
    const scenario = await createScenario({
      key: "project-before-merged",
      stage: "merged",
      position: "before",
    });
    const first = await addPullRequestEvidence(scenario);
    const second = await addPullRequestEvidence(scenario);
    await pauseAtConfiguredCheckpoint(scenario);

    await expect(
      syncGithubPullRequest(db, pullRequestEvent(first, "merged")),
    ).resolves.toMatchObject({
      resumedRunCount: 0,
      resumeOutcomes: [{ runId: scenario.runId, outcome: "not_ready" }],
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });
    await expect(
      resumeWorkflowCheckpoint(db, scenario.projectId, {
        runId: scenario.runId,
        checkpointKey: scenario.checkpoint.key,
        attempt: 1,
        revision: 1,
        requestId: crypto.randomUUID(),
        actor: "github-webhook-race-test",
        approvedAt: nextTime(),
        requireAllGithubPullRequestsMerged: true,
      }),
    ).resolves.toMatchObject({ outcome: "conflict" });
    await expect(
      getWorkflowProgress(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      waitingCheckpoint: expect.objectContaining({
        checkpoint_key: scenario.checkpoint.key,
        state: "waiting",
      }),
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });

    const finalMerge = pullRequestEvent(second, "merged");
    await expect(syncGithubPullRequest(db, finalMerge)).resolves.toMatchObject({
      resumedRunCount: 1,
      resumeOutcomes: [{ runId: scenario.runId, outcome: "resumed" }],
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: finalMerge.mergedAt,
      waiting_checkpoint_key: null,
    });
  });

  it("keeps a revision with legacy unbound PR evidence on manual review", async () => {
    const scenario = await createScenario();
    await updateProjectSettings(db, scenario.projectId, {
      velenOrg: null,
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: null,
      workflow: workflowFor(scenario.checkpoint),
    });
    const legacyNumber = ++pullRequestNumber;
    await recordRunEvidence(db, scenario.projectId, {
      runId: scenario.runId,
      evidenceKey: `legacy-pr-open:${legacyNumber}`,
      stage: "pr_open",
      type: "pull_request",
      status: "passed",
      detail: "Recorded before immutable GitHub identity was required",
      command: "gh pr create",
      url: `https://github.com/${repository}/pull/${legacyNumber}`,
      metadata: null,
      actor: "legacy-cli",
      observedAt: nextTime(),
    });
    await updateProjectSettings(db, scenario.projectId, {
      velenOrg: null,
      dataSource: null,
      linear: { enabled: false, source: null, teamKey: null },
      githubRepository: repository,
      workflow: workflowFor(scenario.checkpoint),
    });
    const current = await addPullRequestEvidence(scenario);
    await pauseAtConfiguredCheckpoint(scenario);

    await expect(
      syncGithubPullRequest(db, pullRequestEvent(current, "merged")),
    ).resolves.toMatchObject({
      matchedRunCount: 1,
      updatedRunCount: 1,
      resumedRunCount: 0,
      resumeOutcomes: [{ runId: scenario.runId, outcome: "not_ready" }],
    });
    await expect(reconcileGithubMergedRuns(db)).resolves.toMatchObject({
      examined: 0,
      resumed: 0,
    });
    await expect(
      getHuntRunForProject(db, scenario.projectId, scenario.runId),
    ).resolves.toMatchObject({
      resume_requested_at: null,
      waiting_checkpoint_key: scenario.checkpoint.key,
    });
  });
});
