import {
  create,
  fromJson,
  toJson,
} from "@bufbuild/protobuf";
import { timestampDate, ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  OrganizationAgentContextService,
  OrganizationAgentContextServiceGetManifestRequestSchema,
  OrganizationAgentContextServiceGetManifestResponseSchema,
  OrganizationAgentContextServiceLookupRequestSchema,
  OrganizationAgentContextServiceLookupResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/organization_agent_context_pb";
import { createConnectRouter } from "@connectrpc/connect";
import {
  createFetchHandler,
  createMethodUrl,
} from "@connectrpc/connect/protocol";
import { describe, expect, it, vi } from "vitest";
import { connectErrorInterceptor } from "./app-connect-errors";
import { requireConnectHandler } from "./test-helpers/connect";
import {
  registerOrganizationAgentContextService,
  type WorkerConnectOrganizationContextServices,
} from "./worker-connect-organization-context";

const organizationId = "11111111-1111-4111-8111-111111111111";
const workId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const projectId = "44444444-4444-4444-8444-444444444444";
const snapshotAt = "2026-08-31T10:20:30.000Z";
const revision = "a".repeat(64);

const claim = {
  organizationId,
  workId,
  workerId,
  claimToken: "briar_channel_claim_test-capability",
};

const services = (): WorkerConnectOrganizationContextServices => ({
  requireActiveClaim: vi.fn().mockResolvedValue({
    organizationId,
    workId,
    snapshotAt,
  }),
  getOrganizationProject: vi.fn().mockResolvedValue({ id: projectId }),
  getManifest: vi.fn().mockResolvedValue({
    schemaVersion: 2,
    organizationId,
    workId,
    snapshotAt,
    revision,
    loadedQueries: [],
    projects: [{
      id: projectId,
      name: "Briar",
      issueKeyPrefix: "BR",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-30T00:00:00.000Z",
      resources: {
        settings: { revision: null },
        agents: { count: 2, revision: "2026-08-29T00:00:00.000Z" },
        issues: {
          count: 4,
          openCount: 3,
          pullRequestCount: 1,
          revision: "2026-08-30T00:00:00.000Z",
        },
        sessions: {
          count: 5,
          archivedCount: 2,
          revision: null,
        },
      },
    }],
  }),
  lookup: vi.fn<WorkerConnectOrganizationContextServices["lookup"]>()
    .mockImplementation(async (_db, _archives, input) => ({
      schemaVersion: 2,
      organizationId: input.organizationId,
      workId: input.workId,
      snapshotAt: input.snapshotAt,
      results: input.requests.map((request, index) => ({
        request,
        data: { index, resource: request.resource },
      })),
    })),
});

const invoke = async (
  method: typeof OrganizationAgentContextService.method.getManifest |
    typeof OrganizationAgentContextService.method.lookup,
  body: unknown,
  dependencies: WorkerConnectOrganizationContextServices,
) => {
  const request = new Request(
    createMethodUrl("https://api.example.test", method),
    {
      method: "POST",
      headers: {
        authorization: "Bearer briar_worker_test",
        "connect-protocol-version": "1",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const router = createConnectRouter({
    connect: true,
    grpc: false,
    grpcWeb: false,
    interceptors: [connectErrorInterceptor],
  });
  registerOrganizationAgentContextService(router, {
    request,
    db: {} as D1Database,
    env: { ARCHIVES: {} } as Env,
  }, dependencies);
  return createFetchHandler(requireConnectHandler(router.handlers, method))(
    request,
  );
};

describe("Organization Agent context Connect adapter", () => {
  it("returns a typed manifest or an explicit unchanged result", async () => {
    const dependencies = services();
    const manifestRequest = create(
      OrganizationAgentContextServiceGetManifestRequestSchema,
      { claim },
    );
    const manifestResponse = await invoke(
      OrganizationAgentContextService.method.getManifest,
      toJson(
        OrganizationAgentContextServiceGetManifestRequestSchema,
        manifestRequest,
      ),
      dependencies,
    );
    expect(manifestResponse.status).toBe(200);
    const manifest = fromJson(
      OrganizationAgentContextServiceGetManifestResponseSchema,
      await manifestResponse.json(),
    );
    expect(manifest.result.case).toBe("manifest");
    if (manifest.result.case !== "manifest") return;
    expect(manifest.result.value.projects[0]).toMatchObject({
      id: projectId,
      name: "Briar",
      agents: { count: 2 },
      issues: { count: 4, openCount: 3, pullRequestCount: 1 },
      sessions: { count: 5, archivedCount: 2 },
    });
    expect(
      timestampDate(manifest.result.value.snapshotAt!).toISOString(),
    ).toBe(snapshotAt);

    const unchangedRequest = create(
      OrganizationAgentContextServiceGetManifestRequestSchema,
      { claim, knownRevision: revision },
    );
    const unchangedResponse = await invoke(
      OrganizationAgentContextService.method.getManifest,
      toJson(
        OrganizationAgentContextServiceGetManifestRequestSchema,
        unchangedRequest,
      ),
      dependencies,
    );
    const unchanged = fromJson(
      OrganizationAgentContextServiceGetManifestResponseSchema,
      await unchangedResponse.json(),
    );
    expect(unchanged.result).toMatchObject({
      case: "unchanged",
      value: { organizationId, workId, revision },
    });
  });

  it("maps every generated lookup oneof exactly once and preserves ordering", async () => {
    const dependencies = services();
    const request = create(OrganizationAgentContextServiceLookupRequestSchema, {
      claim,
      queries: [
        { query: { case: "projectSettings", value: { projectId } } },
        {
          query: {
            case: "agentSummaries",
            value: { projectId, limit: 10, cursor: "agent-cursor" },
          },
        },
        {
          query: {
            case: "agentDetails",
            value: { projectId, ids: ["agent-1"] },
          },
        },
        {
          query: {
            case: "issueSummaries",
            value: { projectId, limit: 11 },
          },
        },
        {
          query: {
            case: "issueDetails",
            value: { projectId, ids: ["issue-1"] },
          },
        },
        {
          query: {
            case: "sessionSummaries",
            value: { projectId, limit: 12 },
          },
        },
        {
          query: {
            case: "sessionDetails",
            value: { projectId, ids: ["session-1"] },
          },
        },
        {
          query: {
            case: "skills",
            value: { projectId, ids: ["skill-1"] },
          },
        },
        {
          query: {
            case: "issuePullRequests",
            value: { projectId, issueIds: ["issue-1"] },
          },
        },
      ],
    });
    const response = await invoke(
      OrganizationAgentContextService.method.lookup,
      toJson(OrganizationAgentContextServiceLookupRequestSchema, request),
      dependencies,
    );
    expect(response.status).toBe(200);
    expect(dependencies.lookup).toHaveBeenCalledOnce();
    const lookupInput = vi.mocked(dependencies.lookup).mock.calls[0][2];
    expect(lookupInput.requests).toEqual([
      { resource: "project-settings", projectId },
      {
        resource: "agents",
        detail: "summary",
        projectId,
        limit: 10,
        cursor: "agent-cursor",
      },
      {
        resource: "agents",
        detail: "full",
        projectId,
        ids: ["agent-1"],
      },
      {
        resource: "issues",
        detail: "summary",
        projectId,
        limit: 11,
        cursor: null,
      },
      {
        resource: "issues",
        detail: "full",
        projectId,
        ids: ["issue-1"],
      },
      {
        resource: "agent-sessions",
        detail: "summary",
        projectId,
        limit: 12,
        cursor: null,
      },
      {
        resource: "agent-sessions",
        detail: "full",
        projectId,
        ids: ["session-1"],
      },
      { resource: "skills", projectId, ids: ["skill-1"] },
      {
        resource: "issue-pull-requests",
        projectId,
        issueIds: ["issue-1"],
      },
    ]);
    expect(dependencies.getOrganizationProject).toHaveBeenCalledOnce();
    const decoded = fromJson(
      OrganizationAgentContextServiceLookupResponseSchema,
      await response.json(),
    );
    expect(decoded.results.map((result) => result.query?.query.case)).toEqual(
      request.queries.map((query) => query.query.case),
    );
    expect(decoded.results.map((result) =>
      result.data ? toJson(ValueSchema, result.data) : undefined
    )).toEqual(request.queries.map((_, index) => ({
      index,
      resource: lookupInput.requests[index].resource,
    })));
  });
});
