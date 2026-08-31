import type {
  GitHubPullRequestIdentity,
} from "@briar/contracts/gen/briar/types/v1/github_pb";
import {
  EventKeyConflictError,
  HuntTransitionError,
} from "./db";
import { HttpError } from "./http-response";
import {
  listEvidenceImagesForEvidence,
  recordRunEvidence,
} from "./run-evidence-repository";
import {
  createUploadCapability,
  UPLOAD_CAPABILITY_MAX_TTL_MS,
} from "./upload-capability";
import {
  enqueueExpiredUploadCleanup,
  prepareUploadRows,
  processUploadCleanupQueue,
  resolveAvailableUploads,
  type UploadMetadata,
  type UploadScope,
} from "./upload-repository";
import {
  authorizeActiveIssueClaim,
  type IssueWorkIdentity,
  type WorkerRunExecutionPrincipal,
} from "./worker-run-execution-application";
import { RunEvidenceApplicationInput } from "./run-request-contract";

const projectOrganizationId = async (
  db: D1Database,
  projectId: string,
) => (await db.prepare(
  "select organization_id from briar_projects where id = ?",
).bind(projectId).first<{ organization_id: string }>())?.organization_id ?? null;

export type RunEvidenceApplicationServices = {
  authorizeActiveIssueClaim: typeof authorizeActiveIssueClaim;
  projectOrganizationId: typeof projectOrganizationId;
  prepareUploadRows: typeof prepareUploadRows;
  createUploadCapability: typeof createUploadCapability;
  enqueueExpiredUploadCleanup: typeof enqueueExpiredUploadCleanup;
  processUploadCleanupQueue: typeof processUploadCleanupQueue;
  recordRunEvidence: typeof recordRunEvidence;
  resolveAvailableUploads: typeof resolveAvailableUploads;
  listEvidenceImages: typeof listEvidenceImagesForEvidence;
};

const runEvidenceApplicationServices: RunEvidenceApplicationServices = {
  authorizeActiveIssueClaim,
  projectOrganizationId,
  prepareUploadRows,
  createUploadCapability,
  enqueueExpiredUploadCleanup,
  processUploadCleanupQueue,
  recordRunEvidence,
  resolveAvailableUploads,
  listEvidenceImages: listEvidenceImagesForEvidence,
};

const servicesWith = (overrides: Partial<RunEvidenceApplicationServices>) => ({
  ...runEvidenceApplicationServices,
  ...overrides,
});

const uploadScope = async (
  input: {
    db: D1Database;
    projectId: string;
    principal: WorkerRunExecutionPrincipal;
    work: IssueWorkIdentity;
    authenticatedAt: string;
  },
  services: RunEvidenceApplicationServices,
) => {
  const active = await services.authorizeActiveIssueClaim(input);
  const organizationId = await services.projectOrganizationId(
    input.db,
    input.projectId,
  );
  if (!organizationId) throw new HttpError(404, "Project not found");
  const scope: UploadScope = {
    purpose: "run_evidence",
    organizationId,
    projectId: input.projectId,
    channelId: null,
    userId: null,
    workId: input.work.workId,
    runId: input.work.runId,
    workerId: input.principal.kind === "worker"
      ? input.principal.worker.binding.id
      : null,
    deviceId: input.principal.kind === "worker"
      ? input.principal.worker.principal.deviceId
      : null,
    claimTokenHash: active.claimTokenHash,
  };
  return { ...active, scope };
};

export async function prepareRunEvidenceImageUploadsApplication(
  input: {
    db: D1Database;
    env: Env;
    context?: ExecutionContext;
    projectId: string;
    principal: WorkerRunExecutionPrincipal;
    work: IssueWorkIdentity;
    requestId: string;
    images: readonly UploadMetadata[];
    observedAt?: string;
  },
  overrides: Partial<RunEvidenceApplicationServices> = {},
) {
  const services = servicesWith(overrides);
  const observedAt = input.observedAt ?? new Date().toISOString();
  const active = await uploadScope({ ...input, authenticatedAt: observedAt }, services);
  const leaseExpiresAt = Date.parse(active.run.lease_expires_at ?? "");
  const expiresAtMs = Math.min(
    leaseExpiresAt,
    Date.parse(observedAt) + UPLOAD_CAPABILITY_MAX_TTL_MS,
  );
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.parse(observedAt)) {
    throw new HttpError(409, "Issue processing claim is no longer active");
  }
  let prepared;
  try {
    prepared = await services.prepareUploadRows(input.db, {
      ...active.scope,
      requestId: input.requestId,
      files: input.images,
      createdAt: observedAt,
      expiresAt: new Date(expiresAtMs).toISOString(),
    });
  } catch {
    throw new HttpError(
      409,
      "Evidence image prepare no longer owns the active claim",
    );
  }
  if (!prepared) {
    throw new HttpError(
      409,
      "Evidence image prepare request was reused with different metadata",
    );
  }
  if (prepared.batch.expires_at <= observedAt) {
    throw new HttpError(
      409,
      "Evidence image prepare request expired; use a new request ID",
    );
  }
  const expiresAt = Date.parse(prepared.batch.expires_at);
  const uploads = await Promise.all(prepared.uploads.map(async (upload) => ({
    clientId: upload.client_id,
    uploadId: upload.upload_id,
    uploadCapability: await services.createUploadCapability(
      input.env.BETTER_AUTH_SECRET,
      { uploadId: upload.upload_id, expiresAt },
    ),
    expiresAt: prepared.batch.expires_at,
  })));
  const cleanup = async () => {
    await services.enqueueExpiredUploadCleanup(input.db, observedAt);
    await services.processUploadCleanupQueue(
      input.db,
      input.env.ATTACHMENTS,
      observedAt,
    );
  };
  if (input.context) input.context.waitUntil(cleanup());
  else await cleanup();
  return { replayed: prepared.replayed, uploads };
}

const sameImageIds = (
  rows: readonly { id: string }[],
  uploadIds: readonly string[],
) => rows.length === uploadIds.length &&
  rows.every((row, index) => row.id === uploadIds[index]);

const evidenceConflict = (error: unknown): never => {
  if (
    error instanceof EventKeyConflictError ||
    error instanceof HuntTransitionError
  ) {
    throw new HttpError(409, error.message);
  }
  throw error;
};

export async function recordRunEvidenceApplication(
  input: {
    db: D1Database;
    projectId: string;
    principal: WorkerRunExecutionPrincipal;
    work: IssueWorkIdentity;
    evidence: typeof RunEvidenceApplicationInput.Type & {
      githubPullRequest?: GitHubPullRequestIdentity | null;
    };
    imageUploadIds: readonly string[];
    authenticatedAt?: string;
  },
  overrides: Partial<RunEvidenceApplicationServices> = {},
) {
  const services = servicesWith(overrides);
  const authenticatedAt = input.authenticatedAt ?? new Date().toISOString();
  const active = await uploadScope({ ...input, authenticatedAt }, services);
  try {
    const uploads = input.imageUploadIds.length === 0
      ? []
      : await services.resolveAvailableUploads(input.db, {
          ...active.scope,
          uploadIds: input.imageUploadIds,
          observedAt: authenticatedAt,
        });
    const evidence = await services.recordRunEvidence(
      input.db,
      input.projectId,
      {
        runId: input.work.runId,
        ...input.evidence,
        detail: input.evidence.detail ?? null,
        command: input.evidence.command ?? null,
        url: input.evidence.url ?? null,
        metadata: input.evidence.metadata ?? null,
        githubPullRequest: input.evidence.githubPullRequest ?? null,
        observedAt: new Date(input.evidence.observedAt).toISOString(),
        imageUploadIds: input.imageUploadIds,
        requireExisting: uploads === null,
        imageUploads: !uploads || uploads.length === 0
          ? undefined
          : {
              scope: active.scope,
              uploads,
              consumedAt: authenticatedAt,
            },
      },
      {
        claimTokenHash: active.claimTokenHash,
        authenticatedAt,
      },
    );
    if (!evidence) throw new HttpError(404, "Run not found");
    const images = await services.listEvidenceImages(
      input.db,
      input.projectId,
      evidence.run_id,
      evidence.id,
    );
    if (!sameImageIds(images, input.imageUploadIds)) {
      throw new EventKeyConflictError();
    }
    return { evidence, images };
  } catch (error) {
    return evidenceConflict(error);
  }
}
