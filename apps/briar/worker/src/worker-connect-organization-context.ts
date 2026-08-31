import {
  create,
  fromJson,
  toBinary,
  type JsonValue,
} from "@bufbuild/protobuf";
import {
  timestampFromDate,
  ValueSchema,
} from "@bufbuild/protobuf/wkt";
import {
  OrganizationAgentContextService,
  OrganizationAgentContextServiceLookupResponseSchema,
  type OrganizationAgentContextClaim,
  type OrganizationAgentContextLookup,
} from "@briar/contracts/gen/briar/worker/v1/organization_agent_context_pb";
import type {
  ConnectRouter,
  ServiceImpl,
} from "@connectrpc/connect";
import type { OrganizationAgentContextLookupRequest } from "../../src/lib/organization-agent-context-contract";
import {
  getActiveOrganizationChannelReplyContextClaim,
  getOrganizationProject,
} from "./channels";
import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";
import {
  lookupOrganizationAgentContext,
  organizationAgentContextManifest,
  organizationAgentContextMaxEncodedPageBytes,
} from "./organization-agent-context";
import { requireWorkerOrganization } from "./worker-route-auth";

export type WorkerConnectOrganizationContextInput = {
  readonly request: Request;
  readonly db: D1Database;
  readonly env: Env;
};

type ActiveOrganizationContextClaim = {
  readonly organizationId: string;
  readonly workId: string;
  readonly snapshotAt: string;
};

const requiredText = (value: string, field: string, maximum: number) => {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maximum) {
    throw new HttpError(
      400,
      `${field} must contain 1 to ${maximum} characters`,
    );
  }
  return normalized;
};

const contextId = (value: string, field: string) =>
  requiredText(value, field, 128);

const optionalCursor = (value: string | undefined) => {
  if (value === undefined) return null;
  return requiredText(value, "query.cursor", 4_096);
};

const lookupIds = (values: readonly string[], field: string) => {
  if (values.length === 0 || values.length > 50) {
    throw new HttpError(400, `${field} must contain 1 to 50 IDs`);
  }
  return values.map((value) => contextId(value, field));
};

const summaryLimit = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) {
    throw new HttpError(400, "query.limit must be an integer from 1 to 50");
  }
  return value;
};

const lookupRequest = (
  lookup: OrganizationAgentContextLookup,
): OrganizationAgentContextLookupRequest => {
  const query = lookup.query;
  if (query.case === "projectSettings") {
    return {
      resource: "project-settings",
      projectId: contextId(query.value.projectId, "query.project_id"),
    };
  }
  if (query.case === "agentSummaries") {
    return {
      resource: "agents",
      detail: "summary",
      projectId: contextId(query.value.projectId, "query.project_id"),
      limit: summaryLimit(query.value.limit),
      cursor: optionalCursor(query.value.cursor),
    };
  }
  if (query.case === "agentDetails") {
    return {
      resource: "agents",
      detail: "full",
      projectId: contextId(query.value.projectId, "query.project_id"),
      ids: lookupIds(query.value.ids, "query.ids"),
    };
  }
  if (query.case === "issueSummaries") {
    return {
      resource: "issues",
      detail: "summary",
      projectId: contextId(query.value.projectId, "query.project_id"),
      limit: summaryLimit(query.value.limit),
      cursor: optionalCursor(query.value.cursor),
    };
  }
  if (query.case === "issueDetails") {
    return {
      resource: "issues",
      detail: "full",
      projectId: contextId(query.value.projectId, "query.project_id"),
      ids: lookupIds(query.value.ids, "query.ids"),
    };
  }
  if (query.case === "sessionSummaries") {
    return {
      resource: "agent-sessions",
      detail: "summary",
      projectId: contextId(query.value.projectId, "query.project_id"),
      limit: summaryLimit(query.value.limit),
      cursor: optionalCursor(query.value.cursor),
    };
  }
  if (query.case === "sessionDetails") {
    return {
      resource: "agent-sessions",
      detail: "full",
      projectId: contextId(query.value.projectId, "query.project_id"),
      ids: lookupIds(query.value.ids, "query.ids"),
    };
  }
  if (query.case === "skills") {
    return {
      resource: "skills",
      projectId: contextId(query.value.projectId, "query.project_id"),
      ids: lookupIds(query.value.ids, "query.ids"),
    };
  }
  if (query.case === "issuePullRequests") {
    return {
      resource: "issue-pull-requests",
      projectId: contextId(query.value.projectId, "query.project_id"),
      issueIds: lookupIds(query.value.issueIds, "query.issue_ids"),
    };
  }
  throw new HttpError(400, "query is required");
};

const validDate = (value: string, field: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(500, `Organization context has invalid ${field}`);
  }
  return date;
};

const timestamp = (value: string, field: string) =>
  timestampFromDate(validDate(value, field));

const optionalTimestamp = (value: string | null, field: string) =>
  value === null ? undefined : timestamp(value, field);

const normalizedJson = (value: unknown): JsonValue => {
  const serialized = JSON.stringify(value);
  return serialized === undefined
    ? null
    : JSON.parse(serialized) as JsonValue;
};

export async function requireActiveOrganizationContextClaim(
  input: WorkerConnectOrganizationContextInput,
  claim: OrganizationAgentContextClaim | undefined,
): Promise<ActiveOrganizationContextClaim> {
  if (!claim) throw new HttpError(400, "claim is required");
  const organizationId = contextId(
    claim.organizationId,
    "claim.organization_id",
  );
  const workId = contextId(claim.workId, "claim.work_id");
  const workerId = requiredText(claim.workerId, "claim.worker_id", 64);
  const claimToken = claim.claimToken.trim();
  if (
    !claimToken.startsWith("briar_channel_claim_") ||
    claimToken.length > 200
  ) {
    throw new HttpError(401, "Channel reply claim token required");
  }
  const principal = await requireWorkerOrganization(
    input.db,
    input.request,
    organizationId,
  );
  const job = await getActiveOrganizationChannelReplyContextClaim(input.db, {
    organizationId,
    jobId: workId,
    deviceId: principal.deviceId,
    workerId,
    claimTokenHash: await sha256(claimToken),
    observedAt: new Date().toISOString(),
  });
  if (!job?.claimed_at) {
    throw new HttpError(409, "Organization Agent claim is no longer active");
  }
  return { organizationId, workId, snapshotAt: job.claimed_at };
}

const manifestMessage = (
  manifest: Awaited<ReturnType<typeof organizationAgentContextManifest>>,
) => ({
  organizationId: manifest.organizationId,
  workId: manifest.workId,
  snapshotAt: timestamp(manifest.snapshotAt, "manifest.snapshot_at"),
  revision: manifest.revision,
  projects: manifest.projects.map((project) => ({
    id: project.id,
    name: project.name,
    issueKeyPrefix: project.issueKeyPrefix,
    createdAt: timestamp(project.createdAt, "manifest.projects.created_at"),
    updatedAt: timestamp(project.updatedAt, "manifest.projects.updated_at"),
    settingsRevision: optionalTimestamp(
      project.resources.settings.revision,
      "manifest.projects.settings_revision",
    ),
    agents: {
      count: project.resources.agents.count,
      revision: optionalTimestamp(
        project.resources.agents.revision,
        "manifest.projects.agents.revision",
      ),
    },
    issues: {
      count: project.resources.issues.count,
      openCount: project.resources.issues.openCount,
      pullRequestCount: project.resources.issues.pullRequestCount,
      revision: optionalTimestamp(
        project.resources.issues.revision,
        "manifest.projects.issues.revision",
      ),
    },
    sessions: {
      count: project.resources.sessions.count,
      archivedCount: project.resources.sessions.archivedCount,
      revision: optionalTimestamp(
        project.resources.sessions.revision,
        "manifest.projects.sessions.revision",
      ),
    },
  })),
});

export type WorkerConnectOrganizationContextServices = {
  readonly requireActiveClaim: typeof requireActiveOrganizationContextClaim;
  readonly getOrganizationProject: typeof getOrganizationProject;
  readonly getManifest: typeof organizationAgentContextManifest;
  readonly lookup: typeof lookupOrganizationAgentContext;
};

const organizationContextServices: WorkerConnectOrganizationContextServices = {
  requireActiveClaim: requireActiveOrganizationContextClaim,
  getOrganizationProject,
  getManifest: organizationAgentContextManifest,
  lookup: lookupOrganizationAgentContext,
};

const service = (
  input: WorkerConnectOrganizationContextInput,
  services: WorkerConnectOrganizationContextServices,
): ServiceImpl<typeof OrganizationAgentContextService> => ({
  getManifest: async (request) => {
    const claim = await services.requireActiveClaim(
      input,
      request.claim,
    );
    const manifest = await services.getManifest(input.db, claim);
    if (
      request.knownRevision !== undefined &&
      !/^[0-9a-f]{64}$/u.test(request.knownRevision)
    ) {
      throw new HttpError(400, "known_revision must be a SHA-256 digest");
    }
    if (request.knownRevision === manifest.revision) {
      return {
        result: {
          case: "unchanged",
          value: {
            organizationId: claim.organizationId,
            workId: claim.workId,
            snapshotAt: timestamp(claim.snapshotAt, "claim.snapshot_at"),
            revision: manifest.revision,
          },
        },
      };
    }
    return {
      result: { case: "manifest", value: manifestMessage(manifest) },
    };
  },
  lookup: async (request) => {
    const claim = await services.requireActiveClaim(
      input,
      request.claim,
    );
    if (request.queries.length === 0 || request.queries.length > 12) {
      throw new HttpError(400, "queries must contain 1 to 12 lookups");
    }
    const requests = request.queries.map(lookupRequest);
    const projectIds = [...new Set(
      requests.map((query) => query.projectId),
    )];
    const projects = await Promise.all(projectIds.map((projectId) =>
      services.getOrganizationProject(
        input.db,
        claim.organizationId,
        projectId,
      )
    ));
    if (projects.some((project) => !project)) {
      throw new HttpError(404, "Project not found");
    }
    const result = await services.lookup(
      input.db,
      input.env.ARCHIVES,
      { ...claim, requests },
    );
    const response = create(OrganizationAgentContextServiceLookupResponseSchema, {
      organizationId: result.organizationId,
      workId: result.workId,
      snapshotAt: timestamp(result.snapshotAt, "lookup.snapshot_at"),
      results: result.results.map((lookupResult, index) => ({
        query: request.queries[index],
        data: fromJson(ValueSchema, normalizedJson(lookupResult.data)),
      })),
    });
    if (
      toBinary(OrganizationAgentContextServiceLookupResponseSchema, response)
          .byteLength > organizationAgentContextMaxEncodedPageBytes
    ) {
      throw new HttpError(413, "Organization context lookup is too large");
    }
    return response;
  },
});

export function registerOrganizationAgentContextService(
  router: ConnectRouter,
  input: WorkerConnectOrganizationContextInput,
  services: WorkerConnectOrganizationContextServices = organizationContextServices,
) {
  router.service(OrganizationAgentContextService, service(input, services));
}
