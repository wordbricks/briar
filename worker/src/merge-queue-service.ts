import { MERGE_GROUP_STATUS_CONTEXTS } from "../../src/lib/merge-group-validation-contract";
import {
  createGitHubInstallationToken,
  enqueueExactPullRequestWithApp,
  GitHubAppRequestError,
  publishGitHubAppCommitStatus,
  StaleGitHubMergeGroupError,
  transientGitHubAppError,
  verifyExactPullRequestWithApp,
  verifySealedMergeGroup,
  type GitHubAppCredentials,
} from "./github-app";
import {
  claimNextMergeQueueAdmission,
  collectReadyMergeQueueGeneration,
  completeMergeQueueAdmission,
  failMergeQueueGeneration,
  generationMembers,
  listDueMergeQueueGenerations,
  MAX_MERGE_GROUP_AUTHORITY_ATTEMPTS,
  MAX_MERGE_QUEUE_ADMISSION_ATTEMPTS,
  nextAdmissionContext,
  recordMergeQueueAdmissionReceipt,
  recordMergeQueueGenerationEnqueue,
  releaseMergeQueueAdmission,
  type MergeQueueAdmissionRow,
  type MergeQueueGenerationRow,
  type MergeQueueMember,
} from "./merge-queue-coordinator";
import {
  authorizeMergeGroupValidationJob,
  claimNextMergeGroupAuthorityJob,
  releaseMergeGroupAuthorityJob,
  type MergeGroupValidationJobRow,
} from "./merge-group-validation";
import { reworkTerminalMergeQueueGeneration } from "./merge-queue-recovery";

const retryAt = (observedAt: string, attempts: number) =>
  new Date(
    Date.parse(observedAt) + Math.min(300, 2 ** Math.min(attempts, 8)) * 1_000,
  ).toISOString();

const admissionMember = (row: MergeQueueAdmissionRow): MergeQueueMember => ({
  projectId: row.project_id,
  runId: row.run_id,
  attempt: row.attempt,
  revision: row.revision,
  installationId: row.installation_id,
  repositoryId: row.repository_id,
  repository: row.repository,
  pullRequestId: row.pull_request_id,
  pullRequestNodeId: row.pull_request_node_id,
  pullRequestNumber: row.pull_request_number,
  headSha: row.head_sha,
  baseSha: row.base_sha,
  readyAt: "1970-01-01T00:00:00.000Z",
});

async function processAdmission(
  db: D1Database,
  credentials: GitHubAppCredentials,
  row: MergeQueueAdmissionRow,
  observedAt: string,
) {
  const member = admissionMember(row);
  try {
    const token = await createGitHubInstallationToken({
      credentials,
      installationId: row.installation_id,
      repositoryId: row.repository_id,
      permissions: {
        contents: "read",
        metadata: "read",
        pull_requests: "read",
        statuses: "write",
      },
    });
    await verifyExactPullRequestWithApp({ accessToken: token.token, member });
    let current: MergeQueueAdmissionRow = row;
    for (;;) {
      const context = nextAdmissionContext(current, MERGE_GROUP_STATUS_CONTEXTS);
      if (!context) break;
      const receipt = await publishGitHubAppCommitStatus({
        accessToken: token.token,
        repository: row.repository,
        headSha: row.head_sha,
        context,
        passed: true,
        description: "Briar claim-fenced PR admission passed",
        targetUrl: `https://github.com/${row.repository}/commit/${row.head_sha}`,
      });
      const recorded = await recordMergeQueueAdmissionReceipt(db, {
        row: current,
        context,
        receipt,
        observedAt,
      });
      if (!recorded) throw new Error("PR admission receipt fence changed");
      current = recorded;
    }
    // A force-push or base update between publication and enqueue admission
    // must invalidate the row instead of carrying a green status forward.
    await verifyExactPullRequestWithApp({ accessToken: token.token, member });
    const completed = await completeMergeQueueAdmission(db, {
      row: current,
      observedAt,
      contextCount: MERGE_GROUP_STATUS_CONTEXTS.length,
    });
    if (!completed) throw new Error("PR admission completion fence changed");
    return "ready" as const;
  } catch (error) {
    const stale = error instanceof StaleGitHubMergeGroupError;
    const transient = transientGitHubAppError(error);
    const terminal = stale || !transient ||
      row.merge_queue_admission_attempts >= MAX_MERGE_QUEUE_ADMISSION_ATTEMPTS;
    await releaseMergeQueueAdmission(db, {
      row,
      observedAt,
      nextAttemptAt: retryAt(observedAt, row.merge_queue_admission_attempts),
      terminal,
      code: stale
        ? "admission_stale"
        : transient
          ? terminal ? "admission_retry_exhausted" : "admission_retry"
          : "admission_rejected",
      detail: error instanceof Error ? error.message : String(error),
    });
    return terminal ? "failed" as const : "retry" as const;
  }
}

async function readyLanes(db: D1Database) {
  const result = await db.prepare(
    `select distinct project_id, repository_id
     from briar_run_pull_requests
     where merge_queue_admission_state = 'ready'
       and merge_queue_generation_id is null
     order by project_id, repository_id
     limit 25`,
  ).all<{ project_id: string; repository_id: number }>();
  return result.results;
}

async function enqueueGeneration(
  db: D1Database,
  credentials: GitHubAppCredentials,
  generation: MergeQueueGenerationRow,
  observedAt: string,
) {
  const members = generationMembers(generation);
  const member = members[generation.enqueue_cursor];
  if (!member) {
    throw new Error("Sealed generation enqueue cursor is outside its exact set");
  }
  if (members.some((candidate) => candidate.baseSha !== members[0]!.baseSha)) {
    await failMergeQueueGeneration(db, {
      generationId: generation.id,
      observedAt,
      code: "base_set_mismatch",
      detail: "Sealed pull requests do not share one exact base SHA",
    });
    return "failed" as const;
  }
  try {
    const token = await createGitHubInstallationToken({
      credentials,
      installationId: generation.installation_id,
      repositoryId: generation.repository_id,
      permissions: {
        contents: "read",
        metadata: "read",
        merge_queues: "write",
        pull_requests: "read",
      },
    });
    const queued = await enqueueExactPullRequestWithApp({
      accessToken: token.token,
      member,
    });
    await recordMergeQueueGenerationEnqueue(db, {
      generationId: generation.id,
      member,
      cursor: generation.enqueue_cursor,
      queueEntryId: queued.queueEntryId,
      observedAt,
      complete: generation.enqueue_cursor + 1 === members.length,
    });
    return "enqueued" as const;
  } catch (error) {
    const stale = error instanceof StaleGitHubMergeGroupError;
    if (stale || !transientGitHubAppError(error)) {
      await failMergeQueueGeneration(db, {
        generationId: generation.id,
        observedAt,
        code: stale ? "enqueue_stale" : "enqueue_rejected",
        detail: error instanceof Error ? error.message : String(error),
        superseded: stale,
      });
      return "failed" as const;
    }
    // No cursor advance means a response loss is crash-safe: the next pass
    // reads mergeQueueEntry first and never enqueues with a different head.
    return "retry" as const;
  }
}

async function generationForAuthority(
  db: D1Database,
  job: MergeGroupValidationJobRow,
) {
  return db.prepare(
    `select * from merge_queue_generations
     where project_id = ? and repository_id = ? and base_ref = ?
       and state in ('collecting', 'enqueuing', 'awaiting_tail')
     limit 1`,
  ).bind(job.project_id, job.repository_id, job.base_ref)
    .first<MergeQueueGenerationRow>();
}

async function processAuthority(
  db: D1Database,
  credentials: GitHubAppCredentials,
  job: MergeGroupValidationJobRow,
  observedAt: string,
) {
  const generation = await generationForAuthority(db, job);
  if (!generation || generation.state !== "awaiting_tail") {
    const waiting = generation?.state === "collecting" ||
      generation?.state === "enqueuing";
    const terminal = !waiting ||
      job.authority_attempts >= MAX_MERGE_GROUP_AUTHORITY_ATTEMPTS;
    await releaseMergeGroupAuthorityJob(db, {
      jobId: job.id,
      observedAt,
      nextAuthorityAt: terminal ? null : retryAt(observedAt, job.authority_attempts),
      terminal,
      stale: !waiting,
      code: waiting ? "generation_not_sealed" : "generation_not_current",
      detail: waiting
        ? "Signed merge-group arrived before its generation finished sealing"
        : "No current sealed generation accepts this signed merge-group",
    });
    return terminal ? "stale" as const : "retry" as const;
  }
  const members = generationMembers(generation);
  try {
    if (members.some((member) => member.baseSha !== job.base_sha)) {
      throw new StaleGitHubMergeGroupError(
        "Signed merge-group base does not match the sealed admission base",
      );
    }
    const token = await createGitHubInstallationToken({
      credentials,
      installationId: job.installation_id,
      repositoryId: job.repository_id,
      permissions: {
        contents: "read",
        metadata: "read",
        merge_queues: "read",
        pull_requests: "read",
      },
    });
    const authority = await verifySealedMergeGroup({
      accessToken: token.token,
      repository: job.repository,
      baseRef: job.base_ref,
      baseSha: job.base_sha,
      headRef: job.head_ref,
      headSha: job.head_sha,
      expectedMembers: members,
    });
    const tailEntry = authority.entries.at(-1)!;
    await authorizeMergeGroupValidationJob(db, {
      jobId: job.id,
      generationId: generation.id,
      tailPullRequestNumber: authority.tail.pullRequestNumber,
      tailPosition: tailEntry.position,
      authorityCheckedAt: observedAt,
    });
    // Only a GitHub-authoritative exact set may supersede older deliveries;
    // arrival timestamp is never used as queue authority.
    await db.prepare(
      `update merge_group_validation_jobs
       set state = 'superseded', error_code = 'authoritative_tail_replaced',
           error_detail = 'A sealed GitHub-authoritative tail replaced this delivery',
           next_authority_at = null, superseded_at = ?, updated_at = ?
       where repository_id = ? and base_ref = ? and id <> ?
         and state in ('authority_pending', 'authority_retry')`,
    ).bind(
      observedAt,
      observedAt,
      job.repository_id,
      job.base_ref,
      job.id,
    ).run();
    return "queued" as const;
  } catch (error) {
    const stale = error instanceof StaleGitHubMergeGroupError ||
      (error instanceof GitHubAppRequestError && error.status === 404);
    const transient = transientGitHubAppError(error);
    const terminal = stale || !transient ||
      job.authority_attempts >= MAX_MERGE_GROUP_AUTHORITY_ATTEMPTS;
    await releaseMergeGroupAuthorityJob(db, {
      jobId: job.id,
      observedAt,
      nextAuthorityAt: terminal ? null : retryAt(observedAt, job.authority_attempts),
      terminal,
      stale,
      code: stale
        ? "authority_stale"
        : transient
          ? terminal ? "authority_retry_exhausted" : "authority_retry"
          : "authority_rejected",
      detail: error instanceof Error ? error.message : String(error),
    });
    if (terminal) {
      await failMergeQueueGeneration(db, {
        generationId: generation.id,
        observedAt,
        code: stale ? "queue_window_changed" : "authority_failed",
        detail: error instanceof Error ? error.message : String(error),
        superseded: stale,
      });
      await reworkTerminalMergeQueueGeneration(db, {
        generationId: generation.id,
        jobId: job.id,
        observedAt,
        code: stale ? "queue_window_changed" : "authority_failed",
        detail: error instanceof Error ? error.message : String(error),
        superseded: stale,
      });
    }
    return terminal ? "failed" as const : "retry" as const;
  }
}

/**
 * One bounded pass used by webhook waitUntil, ci_qa completion, and the
 * minute reconciliation cron. Every external operation has durable state
 * before it begins, so a Worker/API restart only repeats an idempotent read or
 * exact-head mutation.
 */
export async function processMergeQueueCoordinator(input: {
  db: D1Database;
  credentials: GitHubAppCredentials;
  observedAt?: string;
  limit?: number;
}) {
  const observedAt = input.observedAt ?? new Date().toISOString();
  const limit = input.limit ?? 25;
  const result = {
    admissionsReady: 0,
    admissionsRetried: 0,
    admissionsFailed: 0,
    generationsSealed: 0,
    entriesEnqueued: 0,
    authoritiesQueued: 0,
    authoritiesRetried: 0,
    authoritiesFailed: 0,
  };
  for (let index = 0; index < limit; index += 1) {
    const row = await claimNextMergeQueueAdmission(input.db, observedAt);
    if (!row) break;
    const outcome = await processAdmission(
      input.db,
      input.credentials,
      row,
      observedAt,
    );
    if (outcome === "ready") result.admissionsReady += 1;
    else if (outcome === "retry") result.admissionsRetried += 1;
    else result.admissionsFailed += 1;
  }
  for (const lane of await readyLanes(input.db)) {
    const generation = await collectReadyMergeQueueGeneration(input.db, {
      projectId: lane.project_id,
      repositoryId: lane.repository_id,
      observedAt,
    });
    if (generation?.state === "enqueuing" && generation.enqueue_cursor === 0) {
      result.generationsSealed += 1;
    }
  }
  for (const generation of await listDueMergeQueueGenerations(input.db, limit)) {
    if (generation.state === "collecting") {
      const sealed = await collectReadyMergeQueueGeneration(input.db, {
        projectId: generation.project_id,
        repositoryId: generation.repository_id,
        observedAt,
      });
      if (sealed?.state === "enqueuing") result.generationsSealed += 1;
      continue;
    }
    if (generation.state === "enqueuing") {
      const outcome = await enqueueGeneration(
        input.db,
        input.credentials,
        generation,
        observedAt,
      );
      if (outcome === "enqueued") result.entriesEnqueued += 1;
    }
  }
  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextMergeGroupAuthorityJob(input.db, observedAt);
    if (!job) break;
    const outcome = await processAuthority(
      input.db,
      input.credentials,
      job,
      observedAt,
    );
    if (outcome === "queued") result.authoritiesQueued += 1;
    else if (outcome === "retry") result.authoritiesRetried += 1;
    else result.authoritiesFailed += 1;
  }
  return result;
}
