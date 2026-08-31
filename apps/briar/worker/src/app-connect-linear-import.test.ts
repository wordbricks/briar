import { RunStatus } from "@briar/contracts/gen/briar/app/v1/common_pb";
import { LinearImportService } from "@briar/contracts/gen/briar/app/v1/linear_import_pb";
import {
  Code,
  ConnectError,
  createClient,
  createConnectRouter,
} from "@connectrpc/connect";
import { createFetchHandler } from "@connectrpc/connect/protocol";
import { createConnectTransport } from "@connectrpc/connect-web";
import { env } from "cloudflare:workers";
import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { BriarAuth } from "./auth";
import { connectErrorInterceptor } from "./app-connect-errors";
import {
  type AppConnectLinearImportServices,
  registerAppLinearImportService,
} from "./app-connect-linear-import";
import { LinearApiError } from "./linear";
import { linearImportApplicationServices } from "./linear-import-application";
import { requireConnectHandlerForRequest } from "./test-helpers/connect";

const organizationId = "11111111-1111-4111-8111-111111111111";
const projectId = "22222222-2222-4222-8222-222222222222";
const ownerId = "linear-import-owner";
const viewerId = "linear-import-viewer";
const ownerToken = "linear-import-owner-token";
const viewerToken = "linear-import-viewer-token";
const apiKey = "linear-secret-api-key";
const observedAt = "2026-08-30T06:00:00.000Z";
const workflow = JSON.stringify({
  version: 2,
  requirements: [],
  stages: [{
    id: "implementing",
    label: "Implement",
    required: true,
    evidence: [],
  }],
  execution: { checkpoints: [] },
  completion: { requiredStages: ["implementing"] },
});

describe("LinearImportService", () => {
  const db = env.DB;
  let responseBodies: string[];

  const fetchLinearViewerAndTeams = vi.fn<
    AppConnectLinearImportServices["fetchLinearViewerAndTeams"]
  >();
  const fetchLinearWorkflowStates = vi.fn<
    AppConnectLinearImportServices["fetchLinearWorkflowStates"]
  >();
  const fetchLinearIssuesForTeams = vi.fn<
    AppConnectLinearImportServices["fetchLinearIssuesForTeams"]
  >();
  const requireSession = vi.fn<AppConnectLinearImportServices["requireSession"]>(
    async (_auth, request) => ({
      user: {
        id: request.headers.get("authorization") === `Bearer ${viewerToken}`
          ? viewerId
          : ownerId,
      },
    } as never),
  );

  const services = (): AppConnectLinearImportServices => ({
    ...linearImportApplicationServices,
    fetchLinearIssuesForTeams,
    fetchLinearViewerAndTeams,
    fetchLinearWorkflowStates,
    requireSession,
  });

  beforeAll(async () => {
    await db.batch([
      ...[
        [ownerId, "Owner", "linear-owner@example.com"],
        [viewerId, "Viewer", "linear-viewer@example.com"],
      ].map(([id, name, email]) =>
        db.prepare(
          `insert into "user" (
             id, name, email, emailVerified, createdAt, updatedAt
           ) values (?, ?, ?, 1, ?, ?)`,
        ).bind(id, name, email, observedAt, observedAt)
      ),
      db.prepare(
        `insert into briar_organizations (
           id, name, handle, created_at, updated_at
         ) values (?, 'Linear Import', 'linear-import', ?, ?)`,
      ).bind(organizationId, observedAt, observedAt),
      ...[
        [ownerId, "owner"],
        [viewerId, "viewer"],
      ].map(([userId, role]) =>
        db.prepare(
          `insert into briar_organization_members (
             organization_id, user_id, role, created_at, updated_at
           ) values (?, ?, ?, ?, ?)`,
        ).bind(organizationId, userId, role, observedAt, observedAt)
      ),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Linear Project', ?, ?, ?)`,
      ).bind(
        projectId,
        ownerId,
        organizationId,
        "a".repeat(64),
        observedAt,
        observedAt,
      ),
      db.prepare(
        `insert into briar_project_members (
           project_id, organization_id, user_id, created_at, updated_at
         ) values (?, ?, ?, ?, ?)`,
      ).bind(projectId, organizationId, viewerId, observedAt, observedAt),
      db.prepare(
        `insert into briar_project_settings (
           project_id, github_repository, workflow_json,
           mandatory_checkpoints_json, created_at, updated_at
         ) values (?, 'wordbricks/briar', ?, '[]', ?, ?)`,
      ).bind(projectId, workflow, observedAt, observedAt),
    ]);
  }, 60_000);

  const client = () => createClient(
    LinearImportService,
    createConnectTransport({
      baseUrl: "https://briar.example",
      fetch: async (input, init) => {
        const request = new Request(input, { ...init, redirect: "manual" });
        const router = createConnectRouter({
          connect: true,
          grpc: false,
          grpcWeb: false,
          interceptors: [connectErrorInterceptor],
        });
        registerAppLinearImportService(router, {
          request,
          auth: {} as BriarAuth,
          db,
        }, services());
        const handler = requireConnectHandlerForRequest(
          router.handlers,
          request,
        );
        const response = await createFetchHandler(handler)(request);
        responseBodies.push(await response.clone().text());
        return response;
      },
    }),
  );

  const options = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const expectCode = async (operation: Promise<unknown>, code: Code) => {
    const error = await operation.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    expect((error as ConnectError).code).toBe(code);
    return error as ConnectError;
  };

  beforeEach(() => {
    responseBodies = [];
    vi.clearAllMocks();
    fetchLinearViewerAndTeams.mockResolvedValue({
      viewer: {
        name: "Linear Owner",
        email: "owner@linear.example",
        organizationName: "Briar",
      },
      teams: [{ id: "team-1", name: "Core", key: "CORE" }],
    });
    fetchLinearWorkflowStates.mockResolvedValue([]);
    fetchLinearIssuesForTeams.mockResolvedValue({
      issues: [{
        id: "linear-issue-1",
        identifier: "CORE-1",
        title: "Import through Connect",
        description: "Generated oneof placement",
        url: "https://linear.app/briar/issue/CORE-1",
        priority: 2,
        createdAt: observedAt,
        state: { id: "started-state", name: "Started", type: "started" },
        team: { id: "team-1", key: "CORE", name: "Core" },
        parentId: null,
        relations: [],
      }],
      truncated: false,
    });
  });

  it("maps a typed workflow placement and preserves idempotent import counts", async () => {
    const linear = client();
    const connection = await linear.connectLinearImport(
      { projectId, apiKey: `  ${apiKey}  ` },
      options(ownerToken),
    );
    expect(connection).toMatchObject({
      viewer: { name: "Linear Owner", organizationName: "Briar" },
      teams: [{ id: "team-1", key: "CORE" }],
    });

    const input = {
      projectId,
      apiKey: `  ${apiKey}  `,
      teamIds: [" team-1 "],
      statusMappings: [{
        stateId: " started-state ",
        placement: { case: "workflowStageId" as const, value: " implementing " },
      }],
    };
    await expect(linear.importLinearIssues(input, options(ownerToken)))
      .resolves.toMatchObject({
        imported: 1,
        skipped: 0,
        failed: 0,
        total: 1,
        truncated: false,
      });
    await expect(linear.importLinearIssues(input, options(ownerToken)))
      .resolves.toMatchObject({
        imported: 0,
        skipped: 1,
        failed: 0,
        total: 1,
      });

    expect(fetchLinearViewerAndTeams).toHaveBeenCalledWith(apiKey);
    expect(fetchLinearIssuesForTeams).toHaveBeenCalledWith(
      apiKey,
      ["team-1"],
      2_000,
    );
    await expect(db.prepare(
      `select status, workflow_stage, tracker_issue_id
       from briar_hunt_runs where project_id = ?`,
    ).bind(projectId).first()).resolves.toEqual({
      status: "running",
      workflow_stage: "implementing",
      tracker_issue_id: "linear-issue-1",
    });
    expect(responseBodies.join("\n")).not.toContain(apiKey);
  });

  it("fails closed on capability, invalid mappings, and provider errors without secrets", async () => {
    const linear = client();
    const validImport = {
      projectId,
      apiKey,
      teamIds: ["team-1"],
      statusMappings: [{
        stateId: "started-state",
        placement: { case: "workflowStageId" as const, value: "implementing" },
      }],
    };
    await expectCode(
      linear.importLinearIssues(validImport, options(viewerToken)),
      Code.PermissionDenied,
    );
    expect(fetchLinearIssuesForTeams).not.toHaveBeenCalled();

    for (const status of [RunStatus.UNSPECIFIED, RunStatus.PAUSED]) {
      await expectCode(linear.importLinearIssues({
        ...validImport,
        statusMappings: [{
          stateId: `state-${status}`,
          placement: { case: "status", value: status },
        }],
      }, options(ownerToken)), Code.InvalidArgument);
    }
    await expectCode(linear.importLinearIssues({
      ...validImport,
      statusMappings: [
        ...validImport.statusMappings,
        ...validImport.statusMappings,
      ],
    }, options(ownerToken)), Code.InvalidArgument);

    fetchLinearViewerAndTeams.mockRejectedValueOnce(
      new LinearApiError(`provider reflected ${apiKey}`, 401),
    );
    const authError = await expectCode(
      linear.connectLinearImport({ projectId, apiKey }, options(ownerToken)),
      Code.Unauthenticated,
    );
    expect(authError.message).not.toContain(apiKey);

    fetchLinearWorkflowStates.mockRejectedValueOnce(
      new LinearApiError(`provider reflected ${apiKey}`, 500),
    );
    const availabilityError = await expectCode(
      linear.listLinearImportStates(
        { projectId, apiKey, teamIds: ["team-1"] },
        options(ownerToken),
      ),
      Code.Unavailable,
    );
    expect(availabilityError.message).not.toContain(apiKey);
    expect(responseBodies.join("\n")).not.toContain(apiKey);
  });
});
