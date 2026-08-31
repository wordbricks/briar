import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import {
  decodeStoredProjectAgentSessionPayload,
  decodeStoredProjectAgentSessionSummary,
} from "./project-request-contract";
import {
  listProjectAgentSessionChanges,
  listProjectAgentSessionSummaries,
  upsertProjectAgentSession,
} from "./project-agent-session-repository";
import { listInboxReadStates } from "./inbox-read-state-repository";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";

describe("project Agent session storage cutover", () => {
  it("purges legacy state and accepts only canonical relational projections", async () => {
    const db = env.DB;
    const observedAt = "2026-08-31T00:00:00.000Z";
    const projectId = "11111111-1111-4111-8111-111111111111";
    const sessionId = "22222222-2222-4222-8222-222222222222";
    await applyD1Migrations(db, {
      through: "0163_canonical_agent_execution_metrics_storage.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        'session-owner', 'Session Owner', 'session@example.com', 1,
        '${observedAt}', '${observedAt}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'session-org', 'Session Org', 'session-org',
        '${observedAt}', '${observedAt}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        '${projectId}', 'session-owner', 'session-org', 'Session Project',
        '${"a".repeat(64)}', '${observedAt}', '${observedAt}'
      );
      insert into briar_project_agent_sessions (
        project_id, id, agent_id, status, session_type, payload_json,
        started_at, completed_at, updated_at, requested_by_user_id
      ) values
        ('${projectId}', 'legacy-valid', null, 'running', 'task',
         '{"status":"running"}', '${observedAt}', null, '${observedAt}',
         'session-owner'),
        ('${projectId}', 'legacy-corrupt', null, 'running', 'task',
         '{not-json', '${observedAt}', null, '${observedAt}', 'session-owner');
      insert into briar_project_agent_session_context_membership (
        project_id, session_id, visible_at
      ) values
        ('${projectId}', 'legacy-valid', '${observedAt}'),
        ('${projectId}', 'legacy-corrupt', '${observedAt}'),
        ('${projectId}', 'archive-only', '${observedAt}');
      insert into briar_project_agent_session_summaries (
        project_id, session_id, summary_json, updated_at, archived
      ) values
        ('${projectId}', 'legacy-valid', '{"status":"running"}',
         '${observedAt}', 0),
        ('${projectId}', 'archive-only', '{"status":"completed"}',
         '${observedAt}', 1);
      insert into briar_inbox_read_states (
        user_id, message_id, version, updated_at
      ) values
        ('session-owner', 'session:legacy-valid', 'legacy-session-version',
         '${observedAt}'),
        ('session-owner', 'issue:keep', 'unrelated-version', '${observedAt}');
    `);
    const inboxVersionBefore = await db.prepare(
      `select current_version from briar_organization_inbox_sync_state
       where organization_id = 'session-org'`,
    ).first<number>("current_version");

    await applyD1Migrations(db, {
      files: ["0164_canonical_project_agent_session_json.sql"],
    });

    expect((await db.prepare(
      `select id from briar_project_agent_sessions`,
    ).all()).results).toEqual([]);
    expect((await db.prepare(
      `select session_id from briar_project_agent_session_summaries`,
    ).all()).results).toEqual([]);
    expect((await db.prepare(
      `select session_id from briar_project_agent_session_context_membership`,
    ).all()).results).toEqual([]);
    await expect(listProjectAgentSessionChanges(db, projectId, 0)).resolves
      .toEqual({
        currentVersion: 0,
        changes: [],
        hasMore: false,
        nextCursor: 0,
        expired: false,
      });
    await expect(listInboxReadStates(db, "session-owner")).resolves.toEqual([
      expect.objectContaining({ message_id: "issue:keep" }),
    ]);
    const inboxVersionAfter = await db.prepare(
      `select current_version from briar_organization_inbox_sync_state
       where organization_id = 'session-org'`,
    ).first<number>("current_version");
    expect(inboxVersionAfter).toBeGreaterThan(inboxVersionBefore ?? 0);

    const stored = await upsertProjectAgentSession(db, {
      projectId,
      id: sessionId,
      requestedByUserId: "session-owner",
      payload: {
        dispatchGroupId: sessionId,
        agentId: null,
        agentName: null,
        skillId: null,
        sessionType: "task",
        trigger: "manual",
        scheduleId: null,
        scheduleRunId: null,
        parentSessionId: null,
        request: "R".repeat(800),
        followUps: [],
        status: "completed",
        issues: [{
          runId: "run-1",
          runNumber: 1,
          sourceKey: "BR-1",
          title: "Canonical storage",
          outcome: "completed",
          summary: "Full issue detail",
        }],
        startedAt: observedAt,
        completedAt: observedAt,
        conversationId: null,
        summary: "S".repeat(2_500),
        error: "E".repeat(2_500),
        requestedWorkerId: null,
        workerId: null,
        events: [{
          id: "completed-event",
          type: "completed",
          occurredAt: observedAt,
        }],
        updatedAt: observedAt,
      },
    }, observedAt);
    const payload = decodeStoredProjectAgentSessionPayload(stored!.payload_json);
    expect(payload).toMatchObject({
      requestedByUserId: "session-owner",
      summary: "S".repeat(2_500),
    });

    const [summaryRow] = await listProjectAgentSessionSummaries(
      db,
      projectId,
      [sessionId],
      "session-owner",
    );
    const summary = decodeStoredProjectAgentSessionSummary(
      summaryRow!.summary_json,
    );
    expect(summary).toMatchObject({
      request: "R".repeat(500),
      summary: "S".repeat(2_000),
      error: "E".repeat(2_000),
      issues: [expect.objectContaining({ summary: null })],
    });

    await expect(db.prepare(
      `update briar_project_agent_sessions
       set payload_json = json_set(payload_json, '$.status', 'running')
       where project_id = ? and id = ?`,
    ).bind(projectId, sessionId).run()).rejects.toThrow(
      /invalid stored project Agent session payload/iu,
    );
    await expect(db.prepare(
      `update briar_project_agent_session_summaries
       set summary_json = '{not-json'
       where project_id = ? and session_id = ?`,
    ).bind(projectId, sessionId).run()).rejects.toThrow();
    expect((await db.prepare(`pragma foreign_key_check`).all()).results)
      .toEqual([]);
  });
});
