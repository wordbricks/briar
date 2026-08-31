import {
  access,
  mkdtemp,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, fromJson } from "@bufbuild/protobuf";
import { timestampFromDate, ValueSchema } from "@bufbuild/protobuf/wkt";
import {
  OrganizationAgentContextServiceGetManifestResponseSchema,
  OrganizationAgentContextServiceLookupResponseSchema,
} from "@briar/contracts/gen/briar/worker/v1/organization_agent_context_pb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupOrphanedOrganizationAgentWorkspaces,
  downloadOrganizationAgentContextManifest,
  hydrateOrganizationAgentContext,
  organizationAgentContextDirectory,
  prepareOrganizationAgentWorkspace,
  type OrganizationAgentContextClient,
} from "./organization-agent-context";

const organizationId = "11111111-1111-4111-8111-111111111111";
const workId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const projectA = "44444444-4444-4444-8444-444444444444";
const snapshotAt = "2026-08-10T01:00:00.000Z";
const claimToken = `briar_channel_claim_${"a".repeat(64)}`;

const timestamp = () => timestampFromDate(new Date(snapshotAt));

const protoManifest = () => ({
  organizationId,
  workId,
  snapshotAt: timestamp(),
  revision: "a".repeat(64),
  projects: [{
    id: projectA,
    name: "A",
    issueKeyPrefix: "AH",
    createdAt: timestamp(),
    updatedAt: timestamp(),
    settingsRevision: timestamp(),
    agents: { count: 1, revision: timestamp() },
    issues: {
      count: 1,
      openCount: 1,
      pullRequestCount: 0,
      revision: timestamp(),
    },
    sessions: { count: 2, archivedCount: 1, revision: timestamp() },
  }],
});

const contextClient = (input: {
  getManifest?: OrganizationAgentContextClient["getManifest"];
  lookup?: OrganizationAgentContextClient["lookup"];
}): OrganizationAgentContextClient => ({
  getManifest: input.getManifest ?? vi.fn(() => {
    throw new Error("Unexpected manifest request");
  }),
  lookup: input.lookup ?? vi.fn(() => {
    throw new Error("Unexpected lookup request");
  }),
});

describe("Organization Agent context downloader", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((path) =>
        rm(path, { recursive: true, force: true })
      ),
    );
  });

  async function workspace() {
    const path = await mkdtemp(join(tmpdir(), "briar-org-context-test-"));
    temporaryDirectories.push(path);
    return path;
  }

  it("removes crashed-process workspaces while preserving live owners", async () => {
    const workspacePath = await workspace();
    const workerSessionsDirectory = join(workspacePath, "worker-sessions");
    const deadWorkspace = join(
      workerSessionsDirectory,
      "channel-11111111-1111-4111-8111-111111111111",
    );
    const liveWorkspace = join(
      workerSessionsDirectory,
      "channel-22222222-2222-4222-8222-222222222222",
    );
    const retainedWorkspace = join(
      workerSessionsDirectory,
      "channel-33333333-3333-4333-8333-333333333333",
    );
    await prepareOrganizationAgentWorkspace(deadWorkspace, 101);
    await prepareOrganizationAgentWorkspace(liveWorkspace, 202);
    await prepareOrganizationAgentWorkspace(retainedWorkspace, 303, {
      reuse: true,
      retainedUntil: new Date(Date.now() + 6 * 60 * 60 * 1_000).toISOString(),
    });

    await cleanupOrphanedOrganizationAgentWorkspaces({
      workerSessionsDirectory,
      isProcessAlive: (pid) => pid === 202,
    });

    await expect(access(deadWorkspace)).rejects.toThrow();
    await expect(access(liveWorkspace)).resolves.toBeUndefined();
    await expect(access(retainedWorkspace)).resolves.toBeUndefined();
    expect((await stat(liveWorkspace)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(join(liveWorkspace, ".briar-workspace-owner.json"))).mode &
        0o777,
    ).toBe(0o600);
  });

  it("downloads only the revision manifest and reuses an unchanged cached index", async () => {
    const firstWorkspace = await workspace();
    const firstGetManifest = vi.fn<
      OrganizationAgentContextClient["getManifest"]
    >(async (request) => {
      expect(request.knownRevision).toBeUndefined();
      return create(OrganizationAgentContextServiceGetManifestResponseSchema, {
        result: { case: "manifest", value: protoManifest() },
      });
    });
    const first = await downloadOrganizationAgentContextManifest({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath: firstWorkspace,
      client: contextClient({ getManifest: firstGetManifest }),
    });
    expect(first.manifest.projects).toHaveLength(1);
    expect(await readFile(first.manifestPath, "utf8")).not.toContain(
      "Inspect project state",
    );

    const secondWorkspace = await workspace();
    const secondGetManifest = vi.fn<
      OrganizationAgentContextClient["getManifest"]
    >(async (request) => {
      expect(request.knownRevision).toBe("a".repeat(64));
      return create(OrganizationAgentContextServiceGetManifestResponseSchema, {
        result: {
          case: "unchanged",
          value: {
            organizationId,
            workId,
            snapshotAt: timestamp(),
            revision: "a".repeat(64),
          },
        },
      });
    });
    const second = await downloadOrganizationAgentContextManifest({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath: secondWorkspace,
      client: contextClient({ getManifest: secondGetManifest }),
    });
    expect(second.manifest.projects).toEqual(first.manifest.projects);
  });

  it("hydrates selected detail files and atomically updates the manifest", async () => {
    const workspacePath = await workspace();
    const getManifest = vi.fn<
      OrganizationAgentContextClient["getManifest"]
    >(async () =>
      create(OrganizationAgentContextServiceGetManifestResponseSchema, {
        result: { case: "manifest", value: protoManifest() },
      }));
    const lookup = vi.fn<OrganizationAgentContextClient["lookup"]>(
      async (input) => {
        expect(input.claim).toMatchObject({ workerId, claimToken });
        const queries = input.queries ?? [];
        expect(queries).toHaveLength(1);
        expect(queries[0].query).toMatchObject({
          case: "issueSummaries",
          value: { projectId: projectA, limit: 25 },
        });
        return create(OrganizationAgentContextServiceLookupResponseSchema, {
          organizationId,
          workId,
          snapshotAt: timestamp(),
          results: [{
            query: queries[0],
            data: fromJson(ValueSchema, {
              schemaVersion: 2,
              resource: "issues",
              projectId: projectA,
              detail: "summary",
              total: 1,
              items: [{
                id: "issue-a",
                title: "Only requested summary",
              }],
              nextCursor: null,
              complete: true,
            }),
          }],
        });
      },
    );
    const client = contextClient({ getManifest, lookup });
    const prepared = await downloadOrganizationAgentContextManifest({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath,
      client,
    });
    const request = {
      resource: "issues" as const,
      projectId: projectA,
      detail: "summary" as const,
      limit: 25,
      cursor: null,
    };
    const hydrated = await hydrateOrganizationAgentContext({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath,
      requests: [request],
      client,
    });
    expect(hydrated.loaded).toBe(1);
    expect(hydrated.manifest.loadedQueries).toEqual([
      expect.objectContaining({ request }),
    ]);
    const detailPath = join(
      organizationAgentContextDirectory(workspacePath),
      hydrated.manifest.loadedQueries[0].file,
    );
    expect(await readFile(detailPath, "utf8")).toContain(
      "Only requested summary",
    );
    expect(JSON.parse(await readFile(prepared.manifestPath, "utf8")))
      .toMatchObject({ loadedQueries: [{ request }] });

    const repeated = await hydrateOrganizationAgentContext({
      apiUrl: "https://briar.example",
      workerToken: "worker-token",
      organizationId,
      workId,
      workerId,
      claimToken,
      snapshotAt,
      workspacePath,
      requests: [request],
      client,
    });
    expect(repeated.loaded).toBe(0);
    expect(getManifest).toHaveBeenCalledOnce();
    expect(lookup).toHaveBeenCalledOnce();
  });
});
