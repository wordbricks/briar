import type {
  GitHubPullRequestIdentity,
} from "@briar/contracts/gen/briar/types/v1/github_pb";
import {
  githubPullRequestEvidenceIdentity,
  type GithubPullRequestEvidenceIdentity,
  githubPullRequestUrlTarget,
} from "./github-pull-request-repository";
import {
  parseWorkflow,
  stableJson,
} from "./hunt-run-codec";
import {
  EventKeyConflictError,
  HuntTransitionError,
} from "./hunt-run-errors";
import { getHuntRunForProject } from "./hunt-run-repository";
import { scopedEvidenceKey } from "./run-identity";
import {
  consumeUploadStatements,
  type ScopedUploadRow,
  type UploadScope,
  uploadAvailabilityGuard,
} from "./upload-repository";

export type RunEvidenceRow = {
  id: string;
  run_id: string;
  attempt: number;
  revision: number;
  evidence_key: string;
  workflow_stage: string;
  evidence_type: string;
  status: "pending" | "passed" | "failed" | "skipped";
  detail: string | null;
  command: string | null;
  url: string | null;
  metadata_json: string | null;
  actor: string;
  observed_at: string;
  recorded_at: string;
  image_upload_ids_json?: string;
  github_association_started_at?: string | null;
  github_repository_id?: number | null;
  github_pull_request_id?: number | null;
  github_pull_request_node_id?: string | null;
  github_pull_request_number?: number | null;
};

export type RunEvidenceImageRow = {
  id: string;
  project_id: string;
  run_id: string;
  evidence_id: string;
  object_key: string;
  filename: string;
  content_type: string;
  byte_size: number;
  sha256: string;
  position: number;
  created_at: string;
};

export async function recordRunEvidence(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    evidenceKey: string;
    stage: string;
    type: string;
    status: RunEvidenceRow["status"];
    detail: string | null;
    command: string | null;
    url: string | null;
    metadata: Record<string, unknown> | null;
    githubPullRequest?: GitHubPullRequestIdentity | null;
    actor: string;
    observedAt: string;
    imageUploadIds?: readonly string[];
    requireExisting?: boolean;
    imageUploads?: {
      scope: UploadScope;
      uploads: readonly ScopedUploadRow[];
      consumedAt: string;
    };
  },
  fence?: { claimTokenHash: string; authenticatedAt: string },
) {
  const run = await getHuntRunForProject(db, projectId, input.runId);
  if (!run) return null;
  const runFenceSql = `
    and run.current_attempt = ? and run.current_revision = ?
    and run.status = ? and run.workflow_stage is ?
    and run.paused_at is ? and run.resume_requested_at is ?
    ${
    fence
      ? "and run.claim_token_hash = ? and run.lease_expires_at > ?"
      : "and run.claim_token_hash is ? and run.lease_expires_at is ?"
  }`;
  const runFenceBindings = (checkedAt: string) => [
    run.current_attempt,
    run.current_revision,
    run.status,
    run.workflow_stage ?? null,
    run.paused_at ?? null,
    run.resume_requested_at ?? null,
    fence?.claimTokenHash ?? run.claim_token_hash ?? null,
    fence ? checkedAt : run.lease_expires_at ?? null,
  ];
  const workflow = parseWorkflow(run.workflow_snapshot_json);
  const evidenceStageRank = workflow.stages.findIndex(
    (stage) => stage.id === input.stage,
  );
  if (evidenceStageRank < 0) {
    throw new HuntTransitionError(
      `Workflow stage is not configured for this run: ${input.stage}`,
    );
  }
  if (run.paused_at && input.stage !== run.workflow_stage) {
    throw new HuntTransitionError(
      "Run is paused; resume it before recording later-stage evidence",
    );
  }
  let verifiedGithubPullRequest: {
    target: { repository: string; number: number };
    identity: GithubPullRequestEvidenceIdentity;
  } | null = null;
  const linksPullRequest =
    input.type === "pull_request" &&
    ["pending", "passed"].includes(input.status);
  if (input.githubPullRequest && !linksPullRequest) {
    throw new HuntTransitionError(
      "GitHub pull request identity is only valid for active pull request evidence",
    );
  }
  if (linksPullRequest) {
    const target = input.url ? githubPullRequestUrlTarget(input.url) : null;
    const settings = await db
      .prepare(
        `select github_repository
         from briar_project_settings
         where project_id = ?`,
      )
      .bind(projectId)
      .first<{ github_repository: string | null }>();
    const configuredRepository = settings?.github_repository
      ?.trim()
      .toLowerCase();
    if (
      configuredRepository &&
      (!target || configuredRepository !== target.repository)
    ) {
      throw new HuntTransitionError(
        `Pull request evidence must use the project's configured GitHub repository: ${configuredRepository}`,
      );
    }
    if (target) {
      const identity = githubPullRequestEvidenceIdentity(
        input.githubPullRequest,
        target,
      );
      if (!identity) {
        throw new HuntTransitionError(
          "GitHub pull request evidence requires its typed immutable identity; use the bundled Briar CLI",
        );
      }
      verifiedGithubPullRequest = { target, identity };
    } else if (input.githubPullRequest) {
      throw new HuntTransitionError(
        "GitHub pull request identity requires a canonical GitHub pull request URL",
      );
    }
  }
  const metadataJson = input.metadata ? stableJson(input.metadata) : null;
  const imageUploadIdsJson = stableJson(input.imageUploadIds ?? []);
  const storedEvidenceKey = await scopedEvidenceKey(
    input.evidenceKey,
    run.current_revision,
  );
  const existing = await db
    .prepare(
      `select evidence.*,
              link.repository_id as github_repository_id,
              link.pull_request_id as github_pull_request_id,
              link.pull_request_node_id as github_pull_request_node_id,
              link.pull_request_number as github_pull_request_number
       from briar_run_evidence evidence
       left join briar_run_evidence_pull_requests association
         on association.evidence_id = evidence.id
       left join briar_run_pull_requests link
         on link.run_id = association.run_id
        and link.attempt = association.attempt
        and link.revision = association.revision
        and link.repository_id = association.repository_id
        and link.pull_request_number = association.pull_request_number
        and link.pull_request_id = association.pull_request_id
        and link.pull_request_node_id = association.pull_request_node_id
       where evidence.run_id = ? and evidence.attempt = ?
         and evidence.evidence_key = ?`,
    )
    .bind(run.id, run.current_attempt, storedEvidenceKey)
    .first<RunEvidenceRow>();
  const revisionStartedAtSql = `coalesce((
    select min(max(event.recorded_at, event.occurred_at))
    from briar_hunt_events event
    where event.run_id = run.id
      and event.attempt = run.current_attempt
      and event.revision = run.current_revision
  ), run.created_at)`;
  const pullRequestStatements = (
    evidenceId: string,
    url: string | null,
    recordedAt: string,
    associationStartedAt: string,
  ): D1PreparedStatement[] => {
    if (
      input.type !== "pull_request" ||
      !url ||
      !["pending", "passed"].includes(input.status)
    ) {
      return [];
    }
    const checkedAt = new Date().toISOString();
    const statements: D1PreparedStatement[] = [
      db.prepare(
        `update briar_hunt_runs as run
         set pull_request_urls = json_insert(pull_request_urls, '$[#]', ?),
             updated_at = max(updated_at, ?)
         where run.id = ? and run.project_id = ?
           and not exists (
             select 1 from json_each(run.pull_request_urls)
             where value = ?
           )
           ${runFenceSql}`,
      ).bind(
        url,
        recordedAt,
        run.id,
        projectId,
        url,
        ...runFenceBindings(checkedAt),
      ),
    ];
    if (verifiedGithubPullRequest) {
      const { target, identity } = verifiedGithubPullRequest;
      const canonicalUrl =
        `https://github.com/${target.repository}/pull/${target.number}`;
      statements.push(db.prepare(
        `insert into briar_run_pull_requests (
           project_id, run_id, attempt, revision, revision_started_at, url,
           installation_id, repository_id, repository,
           pull_request_id, pull_request_node_id, pull_request_number,
           state, draft, head_sha, base_sha, base_branch, merge_commit_sha,
           opened_at, closed_at, merged_at, provider_updated_at,
           last_delivery_id, created_at, updated_at
         )
         select run.project_id, run.id, run.current_attempt,
                run.current_revision,
                ${revisionStartedAtSql},
                ?, snapshot.installation_id,
                ?, ?, ?, ?, ?,
                coalesce(snapshot.state, 'unknown'), snapshot.draft,
                snapshot.head_sha, snapshot.base_sha, snapshot.base_branch,
                snapshot.merge_commit_sha, snapshot.opened_at,
                snapshot.closed_at, snapshot.merged_at,
                snapshot.provider_updated_at, snapshot.last_delivery_id,
                ?, ?
         from briar_hunt_runs run
         left join briar_github_pull_requests snapshot
           on snapshot.repository_id = ?
          and snapshot.pull_request_number = ?
          and snapshot.pull_request_id = ?
          and snapshot.pull_request_node_id = ?
         and snapshot.repository = ?
         and unixepoch(snapshot.provider_updated_at) >=
            unixepoch(${revisionStartedAtSql})
          and (
            snapshot.installation_id is null
            or not exists (
              select 1 from briar_github_connections connection
              where connection.installation_id = snapshot.installation_id
            )
            or exists (
              select 1
              from briar_github_connections connection
              join briar_projects project
                on project.organization_id = connection.organization_id
              where connection.installation_id = snapshot.installation_id
                and connection.status = 'connected'
                and project.id = run.project_id
            )
          )
          and (
            (
              snapshot.state in ('open', 'closed')
              and snapshot.merged_at is null
            )
            or (
              snapshot.state = 'merged'
              and snapshot.merged_at is not null
              and snapshot.updated_at >= ?
              and unixepoch(snapshot.merged_at) >= unixepoch(?)
              and exists (
                select 1 from json_each(snapshot.briar_issue_links_json) issue
                where json_extract(issue.value, '$.projectId') = run.project_id
                  and json_extract(issue.value, '$.runId') = run.id
              )
            )
          )
         where run.id = ? and run.project_id = ?
           ${runFenceSql}
         on conflict(
           run_id, attempt, revision, repository_id, pull_request_number
         ) do update set
           url = excluded.url,
           installation_id = excluded.installation_id,
           repository = excluded.repository,
           pull_request_id = excluded.pull_request_id,
           pull_request_node_id = excluded.pull_request_node_id,
           state = excluded.state,
           draft = excluded.draft,
           head_sha = excluded.head_sha,
           base_sha = excluded.base_sha,
           base_branch = excluded.base_branch,
           merge_commit_sha = excluded.merge_commit_sha,
           opened_at = excluded.opened_at,
           closed_at = excluded.closed_at,
           merged_at = excluded.merged_at,
           provider_updated_at = excluded.provider_updated_at,
           last_delivery_id = excluded.last_delivery_id,
           updated_at = excluded.updated_at
         where briar_run_pull_requests.state = 'unknown'
           and excluded.last_delivery_id is not null`,
      ).bind(
        canonicalUrl,
        identity.repositoryId,
        identity.repository,
        identity.pullRequestId,
        identity.pullRequestNodeId,
        identity.pullRequestNumber,
        associationStartedAt,
        recordedAt,
        identity.repositoryId,
        identity.pullRequestNumber,
        identity.pullRequestId,
        identity.pullRequestNodeId,
        identity.repository,
        associationStartedAt,
        associationStartedAt,
        run.id,
        projectId,
        ...runFenceBindings(checkedAt),
      ));
      statements.push(db.prepare(
        `insert into briar_run_evidence_pull_requests (
           evidence_id, run_id, attempt, revision,
           repository_id, pull_request_number,
           pull_request_id, pull_request_node_id
         ) values (?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(evidence_id) do nothing`,
      ).bind(
        evidenceId,
        run.id,
        run.current_attempt,
        run.current_revision,
        identity.repositoryId,
        identity.pullRequestNumber,
        identity.pullRequestId,
        identity.pullRequestNodeId,
      ));
    }
    return statements;
  };
  if (existing) {
    const sameGithubPullRequest = verifiedGithubPullRequest
      ? existing.github_repository_id ===
          verifiedGithubPullRequest.identity.repositoryId &&
        existing.github_pull_request_id ===
          verifiedGithubPullRequest.identity.pullRequestId &&
        existing.github_pull_request_node_id ===
          verifiedGithubPullRequest.identity.pullRequestNodeId &&
        existing.github_pull_request_number ===
          verifiedGithubPullRequest.identity.pullRequestNumber
      : existing.github_repository_id == null;
    const same =
      existing.workflow_stage === input.stage &&
      existing.evidence_type === input.type &&
      existing.status === input.status &&
      existing.detail === input.detail &&
      existing.command === input.command &&
      existing.url === input.url &&
      existing.metadata_json === metadataJson &&
      (existing.image_upload_ids_json ?? "[]") === imageUploadIdsJson &&
      existing.actor === input.actor &&
      existing.observed_at === input.observedAt &&
      sameGithubPullRequest;
    if (!same) throw new EventKeyConflictError();
    // An exact replay is read-only. The original mutation already committed
    // evidence, the immutable PR link, and their association in one batch.
    return existing;
  }
  if (input.requireExisting) {
    throw new HuntTransitionError(
      "Evidence image references are unavailable for this active claim",
    );
  }
  const recordedAt = new Date().toISOString();
  const githubAssociationStartedAt = input.type === "pull_request" &&
      input.url && ["pending", "passed"].includes(input.status)
    ? fence?.authenticatedAt ?? recordedAt
    : null;
  const evidence: RunEvidenceRow = {
    id: crypto.randomUUID(),
    run_id: run.id,
    attempt: run.current_attempt,
    revision: run.current_revision,
    evidence_key: storedEvidenceKey,
    workflow_stage: input.stage,
    evidence_type: input.type,
    status: input.status,
    detail: input.detail,
    command: input.command,
    url: input.url,
    metadata_json: metadataJson,
    actor: input.actor,
    observed_at: input.observedAt,
    recorded_at: recordedAt,
    image_upload_ids_json: imageUploadIdsJson,
    github_association_started_at: githubAssociationStartedAt,
  };
  const uploadGuard = input.imageUploads
    ? uploadAvailabilityGuard({
        ...input.imageUploads.scope,
        uploadIds: input.imageUploads.uploads.map((upload) => upload.upload_id),
        observedAt: input.imageUploads.consumedAt,
      })
    : { sql: "", bindings: [] as unknown[] };
  const insertEvidence = db.prepare(
      `insert into briar_run_evidence (
         id, project_id, run_id, attempt, revision, evidence_key, workflow_stage,
         evidence_type, status, detail, command, url, metadata_json,
         actor, observed_at, recorded_at, github_association_started_at,
         image_upload_ids_json
       )
       select ?, run.project_id, run.id, run.current_attempt,
              run.current_revision, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
       from briar_hunt_runs run
       where run.id = ? and run.project_id = ?
         ${runFenceSql}
         ${uploadGuard.sql}`,
    )
    .bind(
      evidence.id,
      evidence.evidence_key,
      evidence.workflow_stage,
      evidence.evidence_type,
      evidence.status,
      evidence.detail,
      evidence.command,
      evidence.url,
      evidence.metadata_json,
      evidence.actor,
      evidence.observed_at,
      evidence.recorded_at,
      evidence.github_association_started_at,
      evidence.image_upload_ids_json,
      run.id,
      projectId,
      ...runFenceBindings(evidence.recorded_at),
      ...uploadGuard.bindings,
    );
  const uploadStatements = input.imageUploads
    ? runEvidenceUploadStatements(db, {
        projectId,
        runId: evidence.run_id,
        evidenceId: evidence.id,
        scope: input.imageUploads.scope,
        uploads: input.imageUploads.uploads,
        consumedAt: input.imageUploads.consumedAt,
      })
    : [];
  const pullRequestBatch = pullRequestStatements(
    evidence.id,
    evidence.url,
    evidence.recorded_at,
    evidence.github_association_started_at ?? evidence.recorded_at,
  );
  let inserted: D1Result;
  try {
    [inserted] = await db.batch([
      insertEvidence,
      ...uploadStatements,
      ...pullRequestBatch,
    ]);
  } catch (error) {
    if (
      verifiedGithubPullRequest && error instanceof Error &&
      error.message.includes("FOREIGN KEY constraint failed")
    ) {
      throw new HuntTransitionError(
        "Run claim or revision changed while recording pull request evidence",
      );
    }
    throw error;
  }
  if ((inserted.meta.changes ?? 0) === 0) {
    throw new HuntTransitionError(
      "Run claim or revision changed while recording evidence",
    );
  }
  return evidence;
}

export async function listRunEvidence(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const result = await db
    .prepare(
      `select * from briar_run_evidence
       where project_id = ? and run_id = ? and attempt = ?
       order by observed_at, recorded_at, id`,
    )
    .bind(projectId, runId, run.current_attempt)
    .all<RunEvidenceRow>();
  return result.results ?? [];
}

export async function listRunEvidenceImages(
  db: D1Database,
  projectId: string,
  runId?: string,
) {
  if (!runId) {
    const result = await db
      .prepare(
        `select image.*
         from briar_run_evidence_images image
         join briar_hunt_runs run
           on run.id = image.run_id and run.project_id = image.project_id
         where image.project_id = ?
         order by image.run_id, image.evidence_id, image.position, image.id`,
      )
      .bind(projectId)
      .all<RunEvidenceImageRow>();
    return result.results ?? [];
  }
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const result = await db
    .prepare(
      `select image.*
       from briar_run_evidence_images image
       join briar_run_evidence evidence on evidence.id = image.evidence_id
       where image.project_id = ? and image.run_id = ?
         and evidence.attempt = ?
       order by evidence.observed_at, evidence.recorded_at, evidence.id,
                image.position, image.id`,
    )
    .bind(projectId, runId, run.current_attempt)
    .all<RunEvidenceImageRow>();
  return result.results ?? [];
}

export async function listAllRunEvidenceImages(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  const run = await getHuntRunForProject(db, projectId, runId);
  if (!run) return null;
  const result = await db
    .prepare(
      `select * from briar_run_evidence_images
       where project_id = ? and run_id = ?
       order by evidence_id, position, id`,
    )
    .bind(projectId, runId)
    .all<RunEvidenceImageRow>();
  return result.results ?? [];
}

export async function listEvidenceImagesForEvidence(
  db: D1Database,
  projectId: string,
  runId: string,
  evidenceId: string,
) {
  const result = await db
    .prepare(
      `select image.*
       from briar_run_evidence_images image
       join briar_hunt_runs run
         on run.id = image.run_id and run.project_id = image.project_id
       where image.project_id = ? and image.run_id = ? and image.evidence_id = ?
       order by image.position, image.id`,
    )
    .bind(projectId, runId, evidenceId)
    .all<RunEvidenceImageRow>();
  return result.results ?? [];
}

const uploadDigestHex = (value: ArrayBuffer) => [...new Uint8Array(value)]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

function runEvidenceUploadStatements(
  db: D1Database,
  input: {
    projectId: string;
    runId: string;
    evidenceId: string;
    scope: UploadScope;
    uploads: readonly ScopedUploadRow[];
    consumedAt: string;
  },
) {
  const imageStatements = input.uploads.map((upload, position) => db.prepare(
    `insert into briar_run_evidence_images (
       id, project_id, run_id, evidence_id, object_key, filename,
       content_type, byte_size, sha256, position, created_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    upload.upload_id,
    input.projectId,
    input.runId,
    input.evidenceId,
    upload.object_key,
    upload.filename,
    upload.content_type,
    upload.byte_size,
    uploadDigestHex(upload.sha256),
    position,
    input.consumedAt,
  ));
  return [
    ...imageStatements,
    ...consumeUploadStatements(db, {
      ...input.scope,
      uploadIds: input.uploads.map((upload) => upload.upload_id),
      consumerKind: "run_evidence",
      consumerId: input.evidenceId,
      consumedAt: input.consumedAt,
    }),
  ];
}

export async function getRunEvidenceImage(
  db: D1Database,
  projectId: string,
  runId: string,
  imageId: string,
) {
  return db
    .prepare(
      `select image.*
       from briar_run_evidence_images image
       join briar_hunt_runs run
         on run.id = image.run_id and run.project_id = image.project_id
       where image.id = ? and image.project_id = ? and image.run_id = ?`,
    )
    .bind(imageId, projectId, runId)
    .first<RunEvidenceImageRow>();
}
