import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  organizationAgentContextAgentsPageSchema,
  organizationAgentContextIssuePullRequestsPageSchema,
  organizationAgentContextIssuesPageSchema,
  organizationAgentContextProjectsPageSchema,
  organizationAgentContextSessionsPageSchema,
} from "../../src/lib/organization-agent-context-contract";
import {
  type ArchiveBucket,
  archiveCompletedLogs,
} from "./archive";
import {
  listOrganizationAgentContextAgentsPage,
  listOrganizationAgentContextIssuePullRequestsPage,
  listOrganizationAgentContextIssuesPage,
  listOrganizationAgentContextProjectsPage,
  listOrganizationAgentContextSessionsPage,
  OrganizationAgentContextCursorError,
  organizationAgentContextMaxEncodedPageBytes,
  OrganizationAgentContextPageTooLargeError,
} from "./organization-agent-context";
import { applyD1Migrations } from "./test-helpers/d1";

const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "10000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000001";
const secondProjectId = "20000000-0000-4000-8000-000000000002";
const futureProjectId = "20000000-0000-4000-8000-000000000003";
const otherProjectId = "20000000-0000-4000-8000-000000000004";
const workId = "30000000-0000-4000-8000-000000000001";
const otherWorkId = "30000000-0000-4000-8000-000000000002";
const agentId = "40000000-0000-4000-8000-000000000001";
const skillId = "50000000-0000-4000-8000-000000000001";

const projectCreatedAt = "2025-01-01T00:00:00.000Z";
const archivedSessionAt = "2025-01-02T00:00:00.000Z";
const archiveSweepAt = "2025-03-15T00:00:00.000Z";
const currentDataAt = "2025-04-01T00:00:00.000Z";
const snapshotAt = "2025-05-01T00:00:00.000Z";
const futureDataAt = "2025-06-01T00:00:00.000Z";

const miniflare = new Miniflare({
  modules: true,
  script: "export default { fetch() { return new Response('ok') } }",
  d1Databases: { DB: "briar-organization-agent-context-test" },
  r2Buckets: ["ARCHIVES"],
});

let db: D1Database;
let archives: ArchiveBucket;

const insertProject = async (input: {
  id: string;
  organizationId: string;
  ownerId: string;
  name: string;
  tokenCharacter: string;
  createdAt: string;
}) => {
  await db.prepare(
    `insert into briar_projects (
       id, owner_user_id, organization_id, name, agent_token_hash,
       issue_key_prefix, created_at, updated_at
     ) values (?, ?, ?, ?, ?, 'CTX', ?, ?)`,
  ).bind(
    input.id,
    input.ownerId,
    input.organizationId,
    input.name,
    input.tokenCharacter.repeat(64),
    input.createdAt,
    input.createdAt,
  ).run();
};

const insertSession = async (input: {
  id: string;
  projectId?: string;
  status: "running" | "completed";
  summary: string;
  startedAt: string;
  visibleAt?: string;
}) => {
  await db.prepare(
    `insert into briar_project_agent_sessions (
       project_id, id, agent_id, status, session_type, payload_json,
       started_at, completed_at, updated_at
     ) values (?, ?, ?, ?, 'task', ?, ?, ?, ?)`,
  ).bind(
    input.projectId ?? projectId,
    input.id,
    agentId,
    input.status,
    JSON.stringify({
      summary: input.summary,
      request: `Request for ${input.id}`,
      secretToken: `secret-${input.id}`,
    }),
    input.startedAt,
    input.status === "completed" ? input.startedAt : null,
    input.startedAt,
  ).run();
  await db.prepare(
    `insert or ignore into briar_project_agent_session_context_membership (
       project_id, session_id, visible_at
     ) values (?, ?, ?)`,
  ).bind(
    input.projectId ?? projectId,
    input.id,
    input.visibleAt ?? input.startedAt,
  ).run();
};

const insertIssue = async (input: {
  runNumber: number;
  id: string;
  projectId: string;
  createdAt: string;
  withDetails?: boolean;
}) => {
  const structuredResult = input.withDetails
    ? JSON.stringify({
        summary: "Implemented safely.",
        outcome: "completed",
        importance: "routine",
        urgency: "normal",
        impact: "issue",
        humanActionRequired: false,
        nextAction: null,
        dueAt: null,
      })
    : null;
  await db.prepare(
    `insert into briar_hunt_runs (
       run_number, id, project_id, source, source_key, title, stage, status,
       workflow_snapshot_json,
       detail, priority, assignee_user_id, repository, branch, commit_sha,
       tracker_provider, tracker_issue_id, tracker_issue_identifier,
       tracker_issue_url, tracker_issue_state, issue_description,
       result_summary, structured_result_json, pull_request_urls, target_sha,
       source_created_at, staging_qa_status, production_qa_status,
       staging_qa_detail, production_qa_detail, context_json,
       claim_token_hash, agent_id, preferred_agent_provider,
       preferred_agent_model, preferred_agent_effort,
       requested_agent_provider, requested_agent_model,
       requested_agent_effort, started_at, last_event_at, created_at,
       updated_at, event_count
     ) values (
       ?, ?, ?, 'issue', ?, ?, 'queued', 'backlog',
       '{"version":2,"requirements":[],"stages":[{"id":"context","label":"Context","required":true}],"execution":{"checkpoints":[]},"completion":{"requiredStages":["context"]}}',
       ?, 2, 'owner-a',
       'wordbricks/briar', ?, ?, ?, null, ?, ?, 'open', ?, ?, ?, ?, ?, ?,
       'passed', 'pending', 'Staging passed', 'Production pending', ?, ?, ?,
       'codex', 'gpt-5.6-sol', 'high', 'claude', 'sonnet', 'medium',
       ?, ?, ?, ?, 7
     )`,
  ).bind(
    input.runNumber,
    input.id,
    input.projectId,
    `context-${input.runNumber}`,
    `Context issue ${input.runNumber}`,
    input.withDetails ? "Visible detail" : null,
    input.withDetails ? "codex/context" : null,
    input.withDetails ? "a".repeat(40) : null,
    input.withDetails ? "github" : null,
    input.withDetails ? `CTX-${input.runNumber}` : null,
    input.withDetails ? "https://github.com/wordbricks/briar/issues/1" : null,
    input.withDetails ? "Visible issue description" : null,
    input.withDetails ? "Visible result summary" : null,
    structuredResult,
    JSON.stringify(
      input.withDetails
        ? Array.from(
            { length: 101 },
            (_, index) =>
              `https://github.com/wordbricks/briar/pull/${index + 1}`,
          )
        : [],
    ),
    input.withDetails ? "b".repeat(40) : null,
    input.createdAt,
    JSON.stringify({ privatePrompt: "must-not-leak" }),
    "c".repeat(64),
    input.projectId === projectId ? agentId : null,
    input.createdAt,
    input.createdAt,
    input.createdAt,
    input.createdAt,
  ).run();
};

beforeAll(async () => {
  db = (await miniflare.getD1Database("DB")) as unknown as D1Database;
  const miniflareBucket = await miniflare.getR2Bucket("ARCHIVES");
  archives = {
    async head(key) {
      const object = await miniflareBucket.head(key);
      if (!object) return null;
      return {
        size: object.size,
        checksums: {
          sha256: object.checksums.sha256
            ? new Uint8Array(object.checksums.sha256).slice().buffer
            : undefined,
        },
        customMetadata: object.customMetadata,
      };
    },
    async get(key) {
      const object = await miniflareBucket.get(key);
      if (!object) return null;
      const bytes = await object.arrayBuffer();
      return {
        size: object.size,
        checksums: {
          sha256: object.checksums.sha256
            ? new Uint8Array(object.checksums.sha256).slice().buffer
            : undefined,
        },
        customMetadata: object.customMetadata,
        body: new Blob([bytes]).stream(),
      };
    },
    async put(key, value, options) {
      return miniflareBucket.put(key, value, options);
    },
    async delete(keys) {
      await miniflareBucket.delete(keys);
    },
  };
  await applyD1Migrations(db);

  for (const [id, name, email] of [
    ["owner-a", "Owner A", "owner-a@example.com"],
    ["owner-b", "Owner B", "owner-b@example.com"],
  ]) {
    await db.prepare(
      `insert into "user" (
         id, name, email, emailVerified, createdAt, updatedAt
       ) values (?, ?, ?, 1, ?, ?)`,
    ).bind(id, name, email, projectCreatedAt, projectCreatedAt).run();
  }
  for (const [id, name, handle, ownerId] of [
    [organizationId, "Context Org", "context-org", "owner-a"],
    [otherOrganizationId, "Other Org", "other-org", "owner-b"],
  ]) {
    await db.prepare(
      `insert into briar_organizations (
         id, name, handle, created_at, updated_at
       ) values (?, ?, ?, ?, ?)`,
    ).bind(id, name, handle, projectCreatedAt, projectCreatedAt).run();
    await db.prepare(
      `insert into briar_organization_members (
         organization_id, user_id, role, created_at, updated_at
       ) values (?, ?, 'owner', ?, ?)`,
    ).bind(id, ownerId, projectCreatedAt, projectCreatedAt).run();
  }

  await insertProject({
    id: projectId,
    organizationId,
    ownerId: "owner-a",
    name: "Context Project A",
    tokenCharacter: "1",
    createdAt: projectCreatedAt,
  });
  await insertProject({
    id: secondProjectId,
    organizationId,
    ownerId: "owner-a",
    name: "Context Project B",
    tokenCharacter: "2",
    createdAt: projectCreatedAt,
  });
  await insertProject({
    id: futureProjectId,
    organizationId,
    ownerId: "owner-a",
    name: "Future Context Project",
    tokenCharacter: "3",
    createdAt: futureDataAt,
  });
  await insertProject({
    id: otherProjectId,
    organizationId: otherOrganizationId,
    ownerId: "owner-b",
    name: "Other Organization Project",
    tokenCharacter: "4",
    createdAt: projectCreatedAt,
  });

  await db.batch([
    db.prepare(
      `insert into briar_project_agents (
         id, organization_id, project_id, handle, name, provider, model,
         responsibility, effort, created_at, updated_at
       ) values (?, ?, ?, 'context-agent', 'Context Agent', 'codex',
                 'gpt-5.6-sol', 'Read the connected project.', 'high', ?, ?)`,
    ).bind(
      agentId,
      organizationId,
      projectId,
      projectCreatedAt,
      projectCreatedAt,
    ),
    db.prepare(
      `insert into briar_agent_skills (
         id, agent_id, name, instructions, provider, model, effort, kind,
         position, created_at, updated_at
       ) values (?, ?, 'Inspect', 'Inspect project state.', 'codex',
                 'gpt-5.6-sol', 'high', 'custom', 0, ?, ?)`,
    ).bind(skillId, agentId, projectCreatedAt, projectCreatedAt),
  ]);

  await insertSession({
    id: "archived-only",
    status: "completed",
    summary: "Archived only",
    startedAt: archivedSessionAt,
  });
  await insertSession({
    id: "duplicate-session",
    status: "completed",
    summary: "Archived duplicate",
    startedAt: archivedSessionAt,
  });
  const archiveResult = await archiveCompletedLogs(
    db,
    archives,
    archiveSweepAt,
    { maxObjects: 2 },
  );
  expect(archiveResult).toMatchObject({
    completedObjects: 2,
    archivedRows: 2,
    failures: [],
  });

  await insertSession({
    id: "duplicate-session",
    status: "running",
    summary: "Hot version wins",
    startedAt: currentDataAt,
  });
  await insertSession({
    id: "hot-only",
    status: "running",
    summary: "Hot only",
    startedAt: currentDataAt,
  });
  await insertSession({
    id: "future-session",
    status: "running",
    summary: "Future session",
    startedAt: futureDataAt,
  });
  await insertSession({
    id: "offset-session",
    status: "running",
    summary: "Offset timestamp is normalized by server visibility",
    startedAt: "2025-05-01T08:30:00.000+09:00",
    visibleAt: currentDataAt,
  });
  await insertSession({
    id: "late-backfill",
    status: "running",
    summary: "Arrived after the claim snapshot",
    startedAt: archivedSessionAt,
    visibleAt: futureDataAt,
  });

  await insertIssue({
    runNumber: 10,
    id: "60000000-0000-4000-8000-000000000010",
    projectId,
    createdAt: currentDataAt,
    withDetails: true,
  });
  await insertIssue({
    runNumber: 20,
    id: "60000000-0000-4000-8000-000000000020",
    projectId,
    createdAt: currentDataAt,
  });
  await insertIssue({
    runNumber: 30,
    id: "60000000-0000-4000-8000-000000000030",
    projectId,
    createdAt: futureDataAt,
  });
  await insertIssue({
    runNumber: 40,
    id: "60000000-0000-4000-8000-000000000040",
    projectId: otherProjectId,
    createdAt: currentDataAt,
  });
  await insertIssue({
    runNumber: 50,
    id: "60000000-0000-4000-8000-000000000050",
    projectId: secondProjectId,
    createdAt: currentDataAt,
  });
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("Organization Agent context pages", () => {
  it("applies the keyset indexes added by migration 0088", async () => {
    const result = await db.prepare(
      `select name from sqlite_master
       where type = 'index' and name in (
         'briar_projects_organization_context_idx',
         'briar_hunt_runs_project_run_number_idx',
         'briar_log_archives_project_sessions_idx',
         'briar_project_agent_session_context_visible_idx'
       ) order by name`,
    ).all<{ name: string }>();

    expect(result.results.map((row) => row.name)).toEqual([
      "briar_hunt_runs_project_run_number_idx",
      "briar_log_archives_project_sessions_idx",
      "briar_project_agent_session_context_visible_idx",
      "briar_projects_organization_context_idx",
    ]);
  });

  it("paginates projects with a stable tie-breaker and isolates the organization snapshot", async () => {
    const first = await listOrganizationAgentContextProjectsPage(db, {
      organizationId,
      workId,
      snapshotAt,
      limit: 1,
    });
    expect(() => organizationAgentContextProjectsPageSchema.parse(first))
      .not.toThrow();
    expect(first).toMatchObject({ total: 2, complete: false });
    expect(first.items.map((item) => item.id)).toEqual([projectId]);

    const second = await listOrganizationAgentContextProjectsPage(db, {
      organizationId,
      workId,
      snapshotAt,
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(() => organizationAgentContextProjectsPageSchema.parse(second))
      .not.toThrow();
    expect(second).toMatchObject({ total: 2, complete: true });
    expect(second.items.map((item) => item.id)).toEqual([secondProjectId]);
    expect([
      ...first.items.map((item) => item.id),
      ...second.items.map((item) => item.id),
    ]).not.toContain(futureProjectId);
    expect(JSON.stringify([first, second])).not.toContain(otherProjectId);

    const otherOrganization = await listOrganizationAgentContextProjectsPage(
      db,
      {
        organizationId: otherOrganizationId,
        workId,
        snapshotAt,
      },
    );
    expect(otherOrganization.items.map((item) => item.id)).toEqual([
      otherProjectId,
    ]);
  });

  it("paginates Project Agents separately without crossing project scope", async () => {
    const page = await listOrganizationAgentContextAgentsPage(db, {
      organizationId,
      projectId,
      workId,
      snapshotAt,
      limit: 1,
    });
    expect(() => organizationAgentContextAgentsPageSchema.parse(page))
      .not.toThrow();
    expect(page).toMatchObject({
      resource: "agents",
      projectId,
      total: 1,
      complete: true,
    });
    expect(page.items[0]).toMatchObject({
      id: agentId,
      handle: "context-agent",
      skills: [{ id: skillId, name: "Inspect" }],
    });

    const otherProject = await listOrganizationAgentContextAgentsPage(db, {
      organizationId,
      projectId: secondProjectId,
      workId,
      snapshotAt,
    });
    expect(otherProject).toMatchObject({ total: 0, items: [] });
  });

  it("paginates issues by run number and returns only safe, snapshot-scoped fields", async () => {
    const first = await listOrganizationAgentContextIssuesPage(db, {
      organizationId,
      projectId,
      workId,
      snapshotAt,
      limit: 1,
    });
    const second = await listOrganizationAgentContextIssuesPage(db, {
      organizationId,
      projectId,
      workId,
      snapshotAt,
      limit: 1,
      cursor: first.nextCursor,
    });

    expect(() => organizationAgentContextIssuesPageSchema.parse(first))
      .not.toThrow();
    expect(() => organizationAgentContextIssuesPageSchema.parse(second))
      .not.toThrow();
    expect(first).toMatchObject({ total: 2, complete: false });
    expect(second).toMatchObject({ total: 2, complete: true });
    expect([...first.items, ...second.items].map((item) => item.runNumber))
      .toEqual([10, 20]);
    expect(first.items[0]).toMatchObject({
      sourceCreatedAt: currentDataAt,
      tracker: { provider: "github", issueId: null },
      structuredResult: { summary: "Implemented safely." },
      eventCountStable: true,
    });
    expect(first.items[0]).not.toHaveProperty("claimTokenHash");
    expect(first.items[0]).not.toHaveProperty("context");

    const wrongOrganization = await listOrganizationAgentContextIssuesPage(
      db,
      {
        organizationId: otherOrganizationId,
        projectId,
        workId,
        snapshotAt,
      },
    );
    expect(wrongOrganization).toMatchObject({ total: 0, items: [] });
    const secondProject = await listOrganizationAgentContextIssuesPage(db, {
      organizationId,
      projectId: secondProjectId,
      workId,
      snapshotAt,
    });
    expect(secondProject.items.map((item) => item.runNumber)).toEqual([50]);
  });

  it("paginates an issue's unbounded pull request links separately", async () => {
    const items: Array<{ issueId: string; position: number; url: string }> = [];
    let cursor: string | null = null;
    do {
      const page = await listOrganizationAgentContextIssuePullRequestsPage(
        db,
        {
          organizationId,
          projectId,
          workId,
          snapshotAt,
          limit: 50,
          cursor,
        },
      );
      expect(() =>
        organizationAgentContextIssuePullRequestsPageSchema.parse(page)
      ).not.toThrow();
      expect(page.total).toBe(101);
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    expect(items).toHaveLength(101);
    expect(items[0]).toMatchObject({
      issueId: "60000000-0000-4000-8000-000000000010",
      position: 0,
      url: "https://github.com/wordbricks/briar/pull/1",
    });
    expect(items.at(-1)).toMatchObject({
      position: 100,
      url: "https://github.com/wordbricks/briar/pull/101",
    });
  });

  it("merges hot and archived sessions, deduplicates by ID, and filters payload keys", async () => {
    const items: Array<Record<string, unknown>> = [];
    let cursor: string | null = null;
    let expectedTotal = 0;
    do {
      const page = await listOrganizationAgentContextSessionsPage(
        db,
        archives,
        {
          organizationId,
          projectId,
          workId,
          snapshotAt,
          limit: 1,
          cursor,
        },
      );
      expect(() => organizationAgentContextSessionsPageSchema.parse(page))
        .not.toThrow();
      expectedTotal = page.total;
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor);

    expect(expectedTotal).toBe(4);
    expect(items.map((item) => item.id)).toEqual([
      "archived-only",
      "duplicate-session",
      "hot-only",
      "offset-session",
    ]);
    expect(items.map((item) => item.id)).not.toContain("late-backfill");
    expect(items.filter((item) => item.id === "duplicate-session"))
      .toHaveLength(1);
    expect(items.find((item) => item.id === "duplicate-session"))
      .toMatchObject({ payload: { summary: "Hot version wins" } });
    for (const item of items) {
      expect(item.payload).not.toHaveProperty("secretToken");
    }

    const wrongOrganization = await listOrganizationAgentContextSessionsPage(
      db,
      archives,
      {
        organizationId: otherOrganizationId,
        projectId,
        workId,
        snapshotAt,
      },
    );
    expect(wrongOrganization).toMatchObject({ total: 0, items: [] });
    const wrongProject = await listOrganizationAgentContextSessionsPage(
      db,
      archives,
      {
        organizationId,
        projectId: secondProjectId,
        workId,
        snapshotAt,
      },
    );
    expect(wrongProject).toMatchObject({ total: 0, items: [] });
  });

  it("rejects malformed, cross-claim, cross-resource, and cross-project cursors", async () => {
    const projectPage = await listOrganizationAgentContextProjectsPage(db, {
      organizationId,
      workId,
      snapshotAt,
      limit: 1,
    });
    const issuePage = await listOrganizationAgentContextIssuesPage(db, {
      organizationId,
      projectId,
      workId,
      snapshotAt,
      limit: 1,
    });
    expect(projectPage.nextCursor).not.toBeNull();
    expect(issuePage.nextCursor).not.toBeNull();

    await expect(
      listOrganizationAgentContextIssuesPage(db, {
        organizationId,
        projectId,
        workId,
        snapshotAt,
        cursor: projectPage.nextCursor,
      }),
    ).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);
    await expect(
      listOrganizationAgentContextIssuesPage(db, {
        organizationId,
        projectId,
        workId: otherWorkId,
        snapshotAt,
        cursor: issuePage.nextCursor,
      }),
    ).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);
    await expect(
      listOrganizationAgentContextIssuesPage(db, {
        organizationId,
        projectId: secondProjectId,
        workId,
        snapshotAt,
        cursor: issuePage.nextCursor,
      }),
    ).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);
    await expect(
      listOrganizationAgentContextIssuesPage(db, {
        organizationId,
        projectId,
        workId,
        snapshotAt: futureDataAt,
        cursor: issuePage.nextCursor,
      }),
    ).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);
    await expect(
      listOrganizationAgentContextProjectsPage(db, {
        organizationId,
        workId,
        snapshotAt,
        cursor: "not!base64",
      }),
    ).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);
  });

  it("shrinks encoded pages at item boundaries and rejects one oversized item", async () => {
    await insertSession({
      id: "large-session-a",
      status: "running",
      summary: "a".repeat(800_000),
      startedAt: currentDataAt,
    });
    await insertSession({
      id: "large-session-b",
      status: "running",
      summary: "b".repeat(800_000),
      startedAt: currentDataAt,
    });
    const first = await listOrganizationAgentContextSessionsPage(
      db,
      archives,
      {
        organizationId,
        projectId,
        workId,
        snapshotAt,
        limit: 50,
      },
    );
    expect(
      new TextEncoder().encode(JSON.stringify(first)).byteLength,
    ).toBeLessThanOrEqual(organizationAgentContextMaxEncodedPageBytes);
    expect(first).toMatchObject({ total: 6, complete: false });
    expect(first.nextCursor).not.toBeNull();

    await insertSession({
      id: "oversized-session",
      projectId: secondProjectId,
      status: "running",
      summary: "x".repeat(organizationAgentContextMaxEncodedPageBytes),
      startedAt: currentDataAt,
    });
    await expect(
      listOrganizationAgentContextSessionsPage(db, archives, {
        organizationId,
        projectId: secondProjectId,
        workId,
        snapshotAt,
      }),
    ).rejects.toBeInstanceOf(OrganizationAgentContextPageTooLargeError);
  });
});
