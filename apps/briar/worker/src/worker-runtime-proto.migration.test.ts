import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { agentProviders } from "../../src/lib/agent-provider";
import {
  applyD1Migrations,
  executeD1Sql,
} from "./test-helpers/d1";
import { workerRuntimeMetadataFromStoredProtoJson } from "./worker-runtime-mappers";

describe("Worker runtime ProtoJSON migration", () => {
  it("backfills complete advertisements and removes invalid bindings", async () => {
    const db = env.DB;
    const now = "2026-08-31T00:00:00.000Z";
    await applyD1Migrations(db, {
      through: "0165_canonical_workflow_checkpoint_storage.sql",
    });
    await executeD1Sql(db, `
      insert into "user" (
        id, name, email, emailVerified, createdAt, updatedAt
      ) values (
        'runtime-owner', 'Runtime Owner', 'runtime@example.com', 1,
        '${now}', '${now}'
      );
      insert into briar_organizations (
        id, name, handle, created_at, updated_at
      ) values (
        'runtime-org', 'Runtime Org', 'runtime-org', '${now}', '${now}'
      );
      insert into briar_projects (
        id, owner_user_id, organization_id, name, agent_token_hash,
        created_at, updated_at
      ) values (
        'runtime-project', 'runtime-owner', 'runtime-org', 'Runtime Project',
        '${"a".repeat(64)}', '${now}', '${now}'
      );
      insert into briar_execution_worker_devices (
        id, organization_id, owner_user_id, label, device_identity_hash,
        state, last_heartbeat_at, created_at, updated_at
      ) values
        ('runtime-device', 'runtime-org', 'runtime-owner', 'Runtime Device',
         '${"b".repeat(64)}', 'online', '${now}', '${now}', '${now}'),
        ('invalid-runtime-device', 'runtime-org', 'runtime-owner',
         'Invalid Runtime Device', '${"c".repeat(64)}', 'online', '${now}',
         '${now}', '${now}');
    `);

    const providerHealth = Object.fromEntries(agentProviders.map((provider) => [
      provider,
      {
        installed: provider === "codex",
        authenticated: provider === "codex",
        healthy: provider === "codex",
        reason: provider === "codex" ? null : "not_installed",
        usageExhausted: false,
        maxUsedPercent: provider === "codex" ? 74.5 : null,
      },
    ]));
    const providerCapabilities = Object.fromEntries(
      agentProviders.map((provider) => [provider, {
        models: provider === "codex"
          ? [{
              id: "gpt-5",
              label: "GPT-5",
              isDefault: true,
              defaultEffortId: "high",
              efforts: [{
                id: "high",
                label: "High",
                description: "Deep reasoning",
                isDefault: true,
              }],
            }]
          : [],
        defaultEfforts: [],
        allowCustomModels: provider === "claude",
        error: null,
      }]),
    );
    const legacyCapabilities = JSON.stringify({
      providers: ["codex"],
      providerHealth,
      providerCapabilities,
      worktrees: true,
      workflowRequirements: [{
        id: "git",
        healthy: true,
        detail: null,
      }],
      remoteUpdates: { supported: true, protocol: 1 },
    });
    await db.prepare(
      `insert into briar_execution_workers (
         id, project_id, device_id, label, host_fingerprint, agent_provider,
         versions_json, capabilities_json, state, last_heartbeat_at,
         created_at, updated_at
       ) values
         ('runtime-worker', 'runtime-project', 'runtime-device',
          'Runtime Worker', ?, 'codex', ?, ?, 'online', ?, ?, ?),
         ('invalid-runtime-worker', 'runtime-project',
          'invalid-runtime-device', 'Invalid Runtime Worker', ?, 'codex',
          '{}', '{}', 'online', ?, ?, ?)`,
    ).bind(
      "d".repeat(64),
      JSON.stringify({ briar: "1.2.3", bun: "1.4.0" }),
      legacyCapabilities,
      now,
      now,
      now,
      "e".repeat(64),
      now,
      now,
      now,
    ).run();
    await db.prepare(
      `insert into briar_project_agents (
         id, organization_id, project_id, name, provider, responsibility,
         designated_worker_id, designated_worker_label, created_at, updated_at
       ) values (
         'runtime-agent', 'runtime-org', 'runtime-project', 'Runtime Agent',
         'codex', 'Exercise migration worker cleanup',
         'invalid-runtime-worker', 'Invalid Runtime Worker', ?, ?
       )`,
    ).bind(now, now).run();
    await executeD1Sql(db, `
      insert into briar_channels (
        id, organization_id, slug, name, default_project_id,
        created_by_user_id, created_at, updated_at
      ) values (
        'runtime-channel', 'runtime-org', 'runtime', 'Runtime',
        'runtime-project', 'runtime-owner', '${now}', '${now}'
      );
      insert into briar_channel_messages (
        id, channel_id, author_user_id, body, created_at, updated_at
      ) values (
        'runtime-message', 'runtime-channel', 'runtime-owner',
        'Runtime thread', '${now}', '${now}'
      );
      insert into briar_channel_reply_sessions (
        id, organization_id, channel_id, thread_root_message_id, project_id,
        agent_id, provider, owner_device_id, owner_worker_id,
        last_activity_at, retained_until, created_at, updated_at
      ) values (
        'runtime-session', 'runtime-org', 'runtime-channel',
        'runtime-message', 'runtime-project', 'runtime-agent', 'codex',
        'invalid-runtime-device', 'invalid-runtime-worker',
        '${now}', '${now}', '${now}', '${now}'
      );
    `);

    await applyD1Migrations(db, {
      files: ["0166_canonical_worker_runtime_proto.sql"],
    });

    expect(await db.prepare(
      `select count(*) as count from briar_execution_workers
       where id = 'invalid-runtime-worker'`,
    ).first<number>("count")).toBe(0);
    expect(await db.prepare(
      `select designated_worker_id, designated_worker_label
       from briar_project_agents where id = 'runtime-agent'`,
    ).first()).toEqual({
      designated_worker_id: null,
      designated_worker_label: "Invalid Runtime Worker",
    });
    expect(await db.prepare(
      `select owner_device_id, owner_worker_id
       from briar_channel_reply_sessions where id = 'runtime-session'`,
    ).first()).toEqual({
      owner_device_id: null,
      owner_worker_id: null,
    });

    const stored = await db.prepare(
      `select runtime_proto_json from briar_execution_workers
       where id = 'runtime-worker'`,
    ).first<string>("runtime_proto_json");
    const runtime = workerRuntimeMetadataFromStoredProtoJson(stored!);
    expect(runtime.agentProvider).toBe("codex");
    expect(runtime.providers).toEqual(["codex"]);
    expect(runtime.versions).toEqual({ briar: "1.2.3", bun: "1.4.0" });
    expect(runtime.providerHealth.codex?.maxUsedPercent).toBe(74.5);
    expect(runtime.providerCapabilities.codex.models[0]).toMatchObject({
      id: "gpt-5",
      defaultEffortId: "high",
    });
    expect(runtime.proto.capabilities).toMatchObject({
      worktrees: true,
      remoteUpdates: { supported: true, protocol: 1 },
      workflowRequirements: [{ id: "git", healthy: true }],
    });
    expect((await db.prepare(
      `select provider, agent_provider
       from briar_execution_worker_healthy_providers
       where worker_id = 'runtime-worker'`,
    ).all()).results).toEqual([{
      provider: "codex",
      agent_provider: "codex",
    }]);

    const withoutVersions = JSON.parse(stored!) as Record<string, unknown>;
    delete withoutVersions.versions;
    await db.prepare(
      `update briar_execution_workers set runtime_proto_json = ?
       where id = 'runtime-worker'`,
    ).bind(JSON.stringify(withoutVersions)).run();
    expect(workerRuntimeMetadataFromStoredProtoJson(
      JSON.stringify(withoutVersions),
    ).versions).toEqual({});

    const oversized = JSON.parse(stored!) as Record<string, unknown>;
    oversized.versions = { oversized: "x".repeat(1_048_576) };
    await expect(db.prepare(
      `update briar_execution_workers set runtime_proto_json = ?
       where id = 'runtime-worker'`,
    ).bind(JSON.stringify(oversized)).run()).rejects.toThrow(
      /Worker runtime ProtoJSON is invalid/iu,
    );
    await expect(db.prepare(
      `update briar_execution_workers set runtime_proto_json = '{}'
       where id = 'runtime-worker'`,
    ).run()).rejects.toThrow(/Worker runtime ProtoJSON is invalid/iu);
    await expect(db.prepare(
      `insert into briar_execution_workers (
         id, project_id, device_id, label, host_fingerprint,
         runtime_proto_json, state, last_heartbeat_at, created_at, updated_at
       ) values (
         'rejected-runtime-worker', 'runtime-project',
         'invalid-runtime-device', 'Rejected Runtime Worker', ?, '{}',
         'online', ?, ?, ?
       )`,
    ).bind("e".repeat(64), now, now, now).run()).rejects.toThrow(
      /Worker runtime ProtoJSON is invalid/iu,
    );
    expect((await db.prepare(`pragma foreign_key_check`).all()).results)
      .toEqual([]);

    expect(runtime.proto.providerHealth.map((health) => health.provider))
      .toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
