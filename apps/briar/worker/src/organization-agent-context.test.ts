import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeOrganizationAgentContextManifest,
} from "../../src/lib/organization-agent-context-contract";
import {
  type ArchiveBucket,
  archiveCompletedLogs,
} from "./archive";
import {
  lookupOrganizationAgentContext,
  organizationAgentContextManifest,
  OrganizationAgentContextCursorError,
  organizationAgentContextMaxEncodedPageBytes,
} from "./organization-agent-context";
import {
  decodeProjectAgentSessionInput,
  encodeStoredProjectAgentSessionPayload,
} from "./project-request-contract";

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

const mutateEncodedCursor = (
  encoded: string | null,
  mutate: (cursor: Record<string, unknown>) => void,
) => {
  if (!encoded) throw new Error("Expected a cursor");
  const padded = encoded.replaceAll("-", "+").replaceAll("_", "/")
    .padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const cursor = JSON.parse(atob(padded)) as Record<string, unknown>;
  mutate(cursor);
  return btoa(JSON.stringify(cursor))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
};

const db = cloudflareEnv.DB;
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
    `insert into briar_teams (
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
  const payload = decodeProjectAgentSessionInput({
    dispatchGroupId: input.id,
    agentId,
    skillId: null,
    sessionType: "task",
    trigger: "manual",
    scheduleId: null,
    scheduleRunId: null,
    parentSessionId: null,
    request: `Request for ${input.id}`,
    followUps: [],
    status: input.status,
    issues: [],
    startedAt: input.startedAt,
    completedAt: input.status === "completed" ? input.startedAt : null,
    conversationId: null,
    summary: input.summary,
    error: null,
    requestedWorkerId: null,
    workerId: null,
    events: [],
    updatedAt: input.startedAt,
  });
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
    encodeStoredProjectAgentSessionPayload(payload),
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
  const archiveBucket = cloudflareEnv.ARCHIVES;
  archives = {
    async head(key) {
      const object = await archiveBucket.head(key);
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
      const object = await archiveBucket.get(key);
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
      return archiveBucket.put(key, value, options);
    },
    async delete(keys) {
      await archiveBucket.delete(keys);
    },
  };

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
         id, organization_id, project_id, name, provider, model,
         responsibility, effort, created_at, updated_at
       ) values (?, ?, ?, 'Context Agent', 'codex',
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
         id, agent_id, name, description, body, provider, model, effort, kind,
         position, created_at, updated_at
       ) values (?, ?, 'Inspect', 'Use for project state inspection.',
                 'Inspect project state.', 'codex',
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

describe("Organization Agent context lookup", () => {
  it("builds a revision manifest without embedding settings or retained payloads", async () => {
    const manifest = await organizationAgentContextManifest(db, {
      organizationId,
      workId,
      snapshotAt,
    });
    expect(() => decodeOrganizationAgentContextManifest(manifest))
      .not.toThrow();
    expect(manifest.revision).toMatch(/^[0-9a-f]{64}$/u);
    expect(manifest.projects.map((project) => project.id)).toEqual([
      projectId,
      secondProjectId,
    ]);
    expect(manifest.projects[0]).toMatchObject({
      resources: {
        agents: { count: 1 },
        issues: { count: 2, openCount: 2, pullRequestCount: 101 },
        sessions: { count: 4 },
      },
    });
    expect(manifest.projects[0]).not.toHaveProperty("settings");
    expect(JSON.stringify(manifest)).not.toContain("Inspect project state.");
    expect(JSON.stringify(manifest)).not.toContain("Visible issue description");
    expect(JSON.stringify(manifest)).not.toContain("Archived only");
  });

  it("returns summaries first and batches only explicitly requested details", async () => {
    const summaries = await lookupOrganizationAgentContext(db, archives, {
      organizationId,
      workId,
      snapshotAt,
      requests: [
        {
          resource: "agents",
          projectId,
          detail: "summary",
          limit: 25,
          cursor: null,
        },
        {
          resource: "issues",
          projectId,
          detail: "summary",
          limit: 25,
          cursor: null,
        },
        {
          resource: "agent-sessions",
          projectId,
          detail: "summary",
          limit: 25,
          cursor: null,
        },
      ],
    });
    expect(JSON.stringify(summaries)).not.toContain("Inspect project state.");
    expect(JSON.stringify(summaries)).not.toContain("Visible issue description");
    expect(JSON.stringify(summaries)).not.toContain("Archived only");
    expect(summaries.results[0].data).toMatchObject({
      detail: "summary",
      items: [{ id: agentId, skills: [{ id: skillId, name: "Inspect" }] }],
    });
    expect(summaries.results[2].data).toMatchObject({
      total: 4,
      items: expect.arrayContaining([
        expect.objectContaining({ id: "archived-only", archived: true }),
        expect.objectContaining({ id: "hot-only", summary: "Hot only" }),
      ]),
    });

    const details = await lookupOrganizationAgentContext(db, archives, {
      organizationId,
      workId,
      snapshotAt,
      requests: [
        { resource: "skills", projectId, ids: [skillId] },
        {
          resource: "issues",
          projectId,
          detail: "full",
          ids: ["60000000-0000-4000-8000-000000000010"],
        },
        {
          resource: "agent-sessions",
          projectId,
          detail: "full",
          ids: ["archived-only"],
        },
      ],
    });
    expect(details.results[0].data).toEqual([
      expect.objectContaining({
        id: skillId,
        description: "Use for project state inspection.",
        body: "Inspect project state.",
      }),
    ]);
    expect(details.results[1].data).toEqual([
      expect.objectContaining({
        id: "60000000-0000-4000-8000-000000000010",
        issueDescription: "Visible issue description",
      }),
    ]);
    expect(details.results[2].data).toEqual([
      expect.objectContaining({
        id: "archived-only",
        payload: expect.objectContaining({ summary: "Archived only" }),
      }),
    ]);
  });

  it("rejects malformed cursors and cursors from another lookup scope", async () => {
    const first = await lookupOrganizationAgentContext(db, archives, {
      organizationId,
      workId,
      snapshotAt,
      requests: [{
        resource: "issues",
        projectId,
        detail: "summary",
        limit: 1,
        cursor: null,
      }],
    });
    const page = first.results[0].data as { nextCursor: string | null };
    expect(page.nextCursor).not.toBeNull();

    const lookupWithCursor = (
      input: {
        workId?: string;
        projectId?: string;
        resource?: "agents" | "issues";
        snapshotAt?: string;
        cursor: string;
      },
    ) =>
      lookupOrganizationAgentContext(db, archives, {
        organizationId,
        workId: input.workId ?? workId,
        snapshotAt: input.snapshotAt ?? snapshotAt,
        requests: [{
          resource: input.resource ?? "issues",
          projectId: input.projectId ?? projectId,
          detail: "summary",
          limit: 1,
          cursor: input.cursor,
        }],
      });

    await expect(lookupWithCursor({
      cursor: page.nextCursor!,
      workId: otherWorkId,
    })).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);
    await expect(lookupWithCursor({
      cursor: page.nextCursor!,
      projectId: secondProjectId,
    })).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);
    await expect(lookupWithCursor({
      cursor: page.nextCursor!,
      resource: "agents",
    })).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);
    await expect(lookupWithCursor({
      cursor: "not!base64",
    })).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);

    const excessPropertyCursor = mutateEncodedCursor(
      page.nextCursor,
      (cursor) => {
        cursor.futureField = true;
      },
    );
    await expect(lookupWithCursor({
      cursor: excessPropertyCursor,
    })).rejects.toBeInstanceOf(OrganizationAgentContextCursorError);
  });

  it("fits large summary pages to the byte budget", async () => {
    for (let index = 0; index < 32; index += 1) {
      await insertSession({
        id: `large-session-${index.toString().padStart(2, "0")}`,
        status: "running",
        summary: "x".repeat(50_000),
        startedAt: currentDataAt,
      });
    }
    const response = await lookupOrganizationAgentContext(db, archives, {
      organizationId,
      workId,
      snapshotAt,
      requests: [{
        resource: "agent-sessions",
        projectId,
        detail: "summary",
        limit: 50,
        cursor: null,
      }],
    });
    const page = response.results[0].data as {
      total: number;
      complete: boolean;
      nextCursor: string | null;
    };
    expect(
      new TextEncoder().encode(JSON.stringify(page)).byteLength,
    ).toBeLessThanOrEqual(organizationAgentContextMaxEncodedPageBytes);
    expect(page).toMatchObject({ total: 36, complete: false });
    expect(page.nextCursor).not.toBeNull();
  });
});
