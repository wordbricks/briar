import { create } from "@bufbuild/protobuf";
import {
  ClaimIssueResponseSchema,
  WorkerExecutionService,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";
import { withConnectErrors } from "./app-connect-errors";
import { HttpError } from "./http-response";
import { claimNextQueueWork } from "./queue-claim-routes";
import { decodeRequestSync } from "./request-schema";
import { runEvidenceResponseMessage } from "./run-evidence-connect";
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

const canonicalUuid = decodeRequestSync(UuidString);

const claimedBy = (value: string) => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > 128) {
    throw new HttpError(400, "claimed_by must contain 1 to 128 characters");
  }
  return normalized;
};

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
      return runEvidenceResponseMessage(result);
    }),
  };
}

export function registerWorkerExecutionService(
  router: ConnectRouter,
  input: WorkerConnectExecutionInput,
) {
  router.service(WorkerExecutionService, createWorkerExecutionService(input));
}
