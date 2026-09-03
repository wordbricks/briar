import { env as cloudflareEnv } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { sha256Hex } from "./managed-computer-crypto";
import {
  consumeManagedComputerRemoteSessionToken,
  createManagedComputerRemoteSession,
  endManagedComputerRemoteSession,
  reconnectManagedComputerRemoteSession,
  recordManagedComputerRemoteAuditEvent,
} from "./managed-computer-remote-repository";
import { createPromotionalManagedComputer } from "./managed-computer-repository";
import { executeD1Sql } from "./test-helpers/d1-sql";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "remote-owner";
const computerId = "33333333-3333-4333-8333-333333333333";
const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const observedAt = "2026-08-22T00:00:00.000Z";

describe("managed computer remote session repository", () => {
  const db = cloudflareEnv.DB;

  beforeAll(async () => {
    await executeD1Sql(db, `
      insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
      values ('${userId}', 'Remote Owner', 'remote@example.com', 1, '${observedAt}', '${observedAt}');
      insert into briar_organizations (id, name, handle, created_at, updated_at)
      values ('${organizationId}', 'Remote Org', 'remote-org', '${observedAt}', '${observedAt}');
      insert into briar_organization_members (
        organization_id, user_id, role, created_at, updated_at
      ) values ('${organizationId}', '${userId}', 'owner', '${observedAt}', '${observedAt}');
    `);
    await createPromotionalManagedComputer(db, {
      entitlementId: "22222222-2222-4222-8222-222222222222",
      managedComputerId: computerId,
      provisioningJobId: "44444444-4444-4444-8444-444444444444",
      workflowInstanceId: `managed-computer-${computerId}`,
      organizationId,
      userId,
      campaignId: "getbriar-pilot",
      requestId: "55555555-5555-4555-8555-555555555555",
      organizationLimit: 1,
      fleetLimit: 10,
      region: "us-east-1",
      instanceType: "m7i.large",
      launchTemplateId: "lt-0123456789abcdef0",
      launchTemplateVersion: "7",
      bootstrapApiOrigin: "https://briar.example",
      enrollmentNonceHash: await sha256Hex("remote-enrollment"),
      enrollmentExpiresAt: "2026-08-22T00:30:00.000Z",
      expiresAt: "2026-09-21T00:00:00.000Z",
      observedAt,
    });
  }, 30_000);

  it("allows one controller, rotates reconnect tokens, and consumes each once", async () => {
    const sessionId = "66666666-6666-4666-8666-666666666666";
    const firstToken = "first-remote-token";
    const created = await createManagedComputerRemoteSession(db, {
      id: sessionId,
      organizationId,
      managedComputerId: computerId,
      agentId,
      controllerUserId: userId,
      requestId: "77777777-7777-4777-8777-777777777777",
      clientTokenHash: await sha256Hex(firstToken),
      tokenExpiresAt: "2026-08-22T00:01:00.000Z",
      maxExpiresAt: "2026-08-22T01:00:00.000Z",
      organizationSessionLimit: 2,
      fleetSessionLimit: 20,
      rateLimit: 10,
      rateCutoff: "2026-08-21T23:55:00.000Z",
      observedAt,
    });
    expect(created).toMatchObject({
      state: "created",
      connection_generation: 1,
      agent_id: agentId,
    });

    const duplicateController = await createManagedComputerRemoteSession(db, {
      id: "88888888-8888-4888-8888-888888888888",
      organizationId,
      managedComputerId: computerId,
      agentId,
      controllerUserId: userId,
      requestId: "99999999-9999-4999-8999-999999999999",
      clientTokenHash: await sha256Hex("other-token"),
      tokenExpiresAt: "2026-08-22T00:01:00.000Z",
      maxExpiresAt: "2026-08-22T01:00:00.000Z",
      organizationSessionLimit: 2,
      fleetSessionLimit: 20,
      rateLimit: 10,
      rateCutoff: "2026-08-21T23:55:00.000Z",
      observedAt,
    });
    expect(duplicateController).toBeNull();

    const consumed = await consumeManagedComputerRemoteSessionToken(db, {
      sessionId,
      managedComputerId: computerId,
      clientTokenHash: await sha256Hex(firstToken),
      observedAt: "2026-08-22T00:00:10.000Z",
    });
    expect(consumed?.state).toBe("connecting");
    expect(await consumeManagedComputerRemoteSessionToken(db, {
      sessionId,
      managedComputerId: computerId,
      clientTokenHash: await sha256Hex(firstToken),
      observedAt: "2026-08-22T00:00:11.000Z",
    })).toBeNull();

    const secondToken = "second-remote-token";
    const reconnected = await reconnectManagedComputerRemoteSession(db, {
      sessionId,
      organizationId,
      managedComputerId: computerId,
      agentId,
      controllerUserId: userId,
      requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      clientTokenHash: await sha256Hex(secondToken),
      tokenExpiresAt: "2026-08-22T00:02:00.000Z",
      observedAt: "2026-08-22T00:01:00.000Z",
    });
    expect(reconnected).toMatchObject({
      state: "created",
      connection_generation: 2,
      token_consumed_at: null,
    });
    expect(await consumeManagedComputerRemoteSessionToken(db, {
      sessionId,
      managedComputerId: computerId,
      clientTokenHash: await sha256Hex(secondToken),
      observedAt: "2026-08-22T00:01:01.000Z",
    })).toMatchObject({ state: "connecting", connection_generation: 2 });
  });

  it("ends the active controller without storing screen or input content", async () => {
    const session = await endManagedComputerRemoteSession(db, {
      sessionId: "66666666-6666-4666-8666-666666666666",
      organizationId,
      managedComputerId: computerId,
      reason: "user_ended",
      observedAt: "2026-08-22T00:02:00.000Z",
    });
    expect(session).toMatchObject({ state: "ended", end_reason: "user_ended" });
    await recordManagedComputerRemoteAuditEvent(db, {
      organizationId,
      managedComputerId: computerId,
      remoteSessionId: session!.id,
      actorUserId: userId,
      action: "session_ended",
      reasonCode: "user_ended",
      controllerBytes: 128,
      screenBytes: 1024,
      occurredAt: "2026-08-22T00:02:00.000Z",
    });
    const columns = await db.prepare(
      `pragma table_info(briar_managed_computer_remote_audit_events)`,
    ).all<{ name: string }>();
    expect(columns.results?.map((column) => column.name)).toEqual([
      "id",
      "organization_id",
      "managed_computer_id",
      "remote_session_id",
      "actor_user_id",
      "action",
      "reason_code",
      "controller_bytes",
      "screen_bytes",
      "occurred_at",
    ]);
  });
});
