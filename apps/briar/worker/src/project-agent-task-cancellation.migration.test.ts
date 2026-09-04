import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { applyD1Migrations } from "./test-helpers/d1";
import { executeD1Sql } from "./test-helpers/d1-sql";
import { workerRuntimeProtoJsonFixtureBeforeVertex } from "./test-helpers/worker-runtime";

describe("project agent task cancellation migration", () => {
  it("adds cancellation columns and a resume counter to task jobs", async () => {
    const db = env.DB;
    const now = "2026-09-04T00:00:00.000Z";
    // Pinned to 0179, whose runtime validation view only knows the seven
    // providers that predate the Vertex migration.
    const runtimeProtoJson = workerRuntimeProtoJsonFixtureBeforeVertex()
      .replaceAll("'", "''");
    await applyD1Migrations(db, {
      through: "0179_production_operation_leases.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        'cancel-owner', 'Cancel Owner', 'cancel@example.com', 1, '${now}', '${now}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'cancel-org', 'Cancel Org', 'cancel-org', '${now}', '${now}'
      );
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('cancel-org', 'cancel-owner', 'owner', '${now}', '${now}');
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'cancel-project', 'cancel-owner', 'cancel-org', 'Cancel Project',
        '${"a".repeat(64)}', '${now}', '${now}'
      );
      insert into briar_execution_worker_devices (
        id, organization_id, owner_user_id, label, device_identity_hash,
        state, last_heartbeat_at, created_at, updated_at
      ) values (
        'cancel-device', 'cancel-org', 'cancel-owner', 'Cancel Device',
        '${"b".repeat(64)}', 'online', '${now}', '${now}', '${now}'
      );
      insert into briar_execution_workers (
        id, project_id, device_id, label, host_fingerprint, state,
        last_heartbeat_at, created_at, updated_at, runtime_proto_json
      ) values (
        'cancel-worker', 'cancel-project', 'cancel-device', 'Cancel Worker',
        '${"c".repeat(64)}', 'online', '${now}', '${now}', '${now}',
        '${runtimeProtoJson}'
      );
      insert into briar_project_agents (
        id, organization_id, project_id, name, provider, responsibility,
        created_at, updated_at
      ) values (
        'cancel-agent', 'cancel-org', 'cancel-project', 'Cancel Agent',
        'codex', 'Validate cancellation storage.', '${now}', '${now}'
      );
      insert into briar_project_agent_task_jobs (
        id, project_id, agent_id, request, request_id, status,
        preferred_worker_id, claimed_worker_id, attempts,
        created_at, updated_at
      ) values (
        'cancel-task', 'cancel-project', 'cancel-agent', 'Do the thing',
        'cancel-request', 'running', 'cancel-worker', 'cancel-worker', 1,
        '${now}', '${now}'
      );
    `);

    await applyD1Migrations(db, {
      files: ["0180_project_agent_task_cancellation.sql"],
    });

    expect(
      await db
        .prepare(
          `select cancel_requested_at, cancelled_by_user_id, resume_count
           from briar_project_agent_task_jobs where id = 'cancel-task'`,
        )
        .first(),
    ).toEqual({
      cancel_requested_at: null,
      cancelled_by_user_id: null,
      resume_count: 0,
    });

    // The cancel path writes a terminal `failed` row for a non-approval job:
    // every trigger on this table is guarded by skill_execution_proposal_id.
    await db
      .prepare(
        `update briar_project_agent_task_jobs
         set status = 'failed', error = 'stopped',
             cancel_requested_at = ?, cancelled_by_user_id = ?,
             claim_token_hash = null, claimed_worker_id = null,
             claimed_at = null, lease_expires_at = null,
             completed_at = ?, updated_at = ?
         where id = 'cancel-task' and skill_execution_proposal_id is null`,
      )
      .bind(now, "cancel-owner", now, now)
      .run();
    expect(
      await db
        .prepare(
          `select status, cancel_requested_at, cancelled_by_user_id,
                  claimed_worker_id
           from briar_project_agent_task_jobs where id = 'cancel-task'`,
        )
        .first(),
    ).toEqual({
      status: "failed",
      cancel_requested_at: now,
      cancelled_by_user_id: "cancel-owner",
      claimed_worker_id: null,
    });

    await expect(
      db
        .prepare(
          `update briar_project_agent_task_jobs set resume_count = -1
           where id = 'cancel-task'`,
        )
        .run(),
    ).rejects.toThrow();
  });
});
