import {
  create,
  type JsonObject,
  type JsonValue,
} from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  RunEvidenceImageSchema,
  RunEvidenceSchema,
  RunEvidence_Status,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import {
  ClaimIssueResponseSchema,
  ListRunEvidenceResponseSchema,
  WorkerExecutionService,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { withConnectErrors } from "./app-connect-errors";
import { HttpError } from "./http-response";
import { claimNextQueueWork } from "./queue-claim-routes";
import { decodeRequestSync } from "./request-schema";
import { listRunEvidenceForProject } from "./run-evidence-routes";
import { UuidString } from "./schema-codecs";
import { workerIssueClaimMessage } from "./worker-connect-mappers";
import {
  type AuthenticatedWorkerProject,
  requireAgentProject,
  requireWorkerProjectBinding,
} from "./worker-route-auth";

export type IssueClaimAuthorization = {
  readonly projectId: string;
  readonly authenticatedWorker?: AuthenticatedWorkerProject;
};

export type WorkerConnectExecutionInput = {
  readonly request: Request;
  readonly db: D1Database;
  readonly env: Env;
  readonly archivesBucket: R2Bucket;
  readonly requireRunExecutionProject: (runId: string) => Promise<string>;
};

export type IssueClaimAuthServices = {
  readonly requireAgentProject: typeof requireAgentProject;
  readonly requireWorkerProjectBinding: typeof requireWorkerProjectBinding;
};

const issueClaimAuthServices: IssueClaimAuthServices = {
  requireAgentProject,
  requireWorkerProjectBinding,
};

export async function authorizeIssueClaim(
  input: { db: D1Database; request: Request; projectId: string },
  services: IssueClaimAuthServices = issueClaimAuthServices,
): Promise<IssueClaimAuthorization> {
  const authorization = input.request.headers.get("authorization") ?? "";
  if (authorization.startsWith("Bearer briar_worker_")) {
    return {
      projectId: input.projectId,
      authenticatedWorker: await services.requireWorkerProjectBinding(
        input.db,
        input.request,
        input.projectId,
      ),
    };
  }
  return {
    projectId: await services.requireAgentProject(input.db, input.request),
  };
}

export type WorkerExecutionServices = {
  readonly authorizeIssueClaim: typeof authorizeIssueClaim;
  readonly claimIssue: typeof claimNextQueueWork;
  readonly listRunEvidence: typeof listRunEvidenceForProject;
};

const workerExecutionServices: WorkerExecutionServices = {
  authorizeIssueClaim,
  claimIssue: claimNextQueueWork,
  listRunEvidence: listRunEvidenceForProject,
};

type EvidenceResult = Awaited<ReturnType<typeof listRunEvidenceForProject>>;
type Evidence = EvidenceResult["evidence"][number];

const timestamp = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Worker evidence has invalid ${field}`);
  }
  return timestampFromDate(date);
};

const jsonValue = (value: unknown, field: string): JsonValue => {
  if (
    value === null || typeof value === "string" ||
    typeof value === "boolean"
  ) return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map((item, index) => jsonValue(item, `${field}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    const output: JsonObject = {};
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) output[key] = jsonValue(item, `${field}.${key}`);
    }
    return output;
  }
  throw new Error(`Worker evidence has non-JSON ${field}`);
};

const jsonObject = (value: unknown, field: string): JsonObject => {
  const mapped = jsonValue(value, field);
  if (mapped === null || Array.isArray(mapped) || typeof mapped !== "object") {
    throw new Error(`Worker evidence expected an object for ${field}`);
  }
  return mapped;
};

const evidenceStatus = {
  pending: RunEvidence_Status.PENDING,
  passed: RunEvidence_Status.PASSED,
  failed: RunEvidence_Status.FAILED,
  skipped: RunEvidence_Status.SKIPPED,
} as const satisfies Record<Evidence["status"], RunEvidence_Status>;

const canonicalUuid = decodeRequestSync(UuidString);

const claimedBy = (value: string) => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new HttpError(400, "claimed_by must contain 1 to 128 characters");
  }
  return normalized;
};

const evidenceMessage = (value: Evidence) => create(RunEvidenceSchema, {
  key: value.key,
  attempt: value.attempt,
  revision: value.revision,
  stage: value.stage,
  type: value.type,
  status: evidenceStatus[value.status],
  detail: value.detail ?? undefined,
  command: value.command ?? undefined,
  url: value.url ?? undefined,
  metadata: value.metadata === null
    ? undefined
    : jsonObject(value.metadata, "metadata"),
  actor: value.actor,
  observedAt: timestamp(value.observedAt, "observedAt"),
  recordedAt: timestamp(value.recordedAt, "recordedAt"),
  images: value.images.map((image) => create(RunEvidenceImageSchema, {
    id: image.id,
    filename: image.filename,
    contentType: image.contentType,
    byteSize: BigInt(image.byteSize),
    sha256: image.sha256,
    position: image.position,
    url: image.url,
  })),
  requiredRevision: value.requiredRevision,
  canonical: value.canonical,
});

export function createWorkerExecutionService(
  input: WorkerConnectExecutionInput,
  overrides: Partial<WorkerExecutionServices> = {},
): ServiceImpl<typeof WorkerExecutionService> {
  const services = { ...workerExecutionServices, ...overrides };
  return {
    claimIssue: (request) => withConnectErrors(async () => {
      const projectId = canonicalUuid(request.projectId).toLowerCase();
      const authorization = await services.authorizeIssueClaim({
        db: input.db,
        request: input.request,
        projectId,
      });
      if (authorization.projectId !== projectId) {
        throw new HttpError(404, "Project not found");
      }
      const issue = await services.claimIssue({
        db: input.db,
        env: input.env,
        projectId,
        runId: request.runId
          ? canonicalUuid(request.runId).toLowerCase()
          : undefined,
        claimedBy: claimedBy(request.claimedBy),
        authenticatedWorker: authorization.authenticatedWorker,
      });
      return create(ClaimIssueResponseSchema, {
        issue: issue ? workerIssueClaimMessage(issue) : undefined,
      });
    }),
    listRunEvidence: (request) => withConnectErrors(async () => {
      const authenticatedProjectId = await input.requireRunExecutionProject(
        request.runId,
      );
      if (authenticatedProjectId !== request.projectId) {
        throw new HttpError(404, "Run not found");
      }
      const result = await services.listRunEvidence({
        db: input.db,
        archivesBucket: input.archivesBucket,
        projectId: authenticatedProjectId,
        runId: request.runId,
      });
      return create(ListRunEvidenceResponseSchema, {
        runId: result.runId,
        attempt: result.attempt,
        revision: result.revision,
        evidence: result.evidence.map(evidenceMessage),
      });
    }),
  };
}

export function registerWorkerExecutionService(
  router: ConnectRouter,
  input: WorkerConnectExecutionInput,
) {
  router.service(WorkerExecutionService, createWorkerExecutionService(input));
}
