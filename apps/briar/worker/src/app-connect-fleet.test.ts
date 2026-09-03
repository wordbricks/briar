import {
  Code,
  ConnectError,
  createClient,
} from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  FleetService,
  ManagedComputerState,
  UnbindProjectExecutionWorkerRequest_Reason,
} from "@briar/contracts/gen/briar/app/v1/fleet_pb";
import { env as cloudflareEnv } from "cloudflare:workers";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import worker from "./index";
import { workerRuntimeFixture } from "./test-helpers/worker-runtime";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const projectId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ownerId = "fleet-connect-owner";
const memberId = "fleet-connect-member";
const ownerToken = "fleet-connect-owner-token";
const memberToken = "fleet-connect-member-token";
const now = "2026-08-22T00:00:00.000Z";

describe("FleetService", () => {
  const db = cloudflareEnv.DB;
  const createWorkflow = vi.fn(async (input: { id: string }) => ({
    id: input.id,
  }));
  const getWorkflow = vi.fn(async (id: string) => ({ id }));
  afterEach(() => vi.restoreAllMocks());

  beforeAll(async () => {
    await db.batch([
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Owner', 'fleet-owner@example.com', 1, ?, ?)`,
      ).bind(ownerId, now, now),
      db.prepare(
        `insert into "user" (id, name, email, emailVerified, createdAt, updatedAt)
         values (?, 'Member', 'fleet-member@example.com', 1, ?, ?)`,
      ).bind(memberId, now, now),
      db.prepare(
        `insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId)
         values ('fleet-owner-session', '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
      ).bind(ownerToken, now, now, ownerId),
      db.prepare(
        `insert into "session" (id, expiresAt, token, createdAt, updatedAt, userId)
         values ('fleet-member-session', '2099-01-01T00:00:00.000Z', ?, ?, ?, ?)`,
      ).bind(memberToken, now, now, memberId),
      db.prepare(
        `insert into briar_organizations (id, name, handle, created_at, updated_at)
         values (?, 'Fleet Connect', 'fleet-connect', ?, ?)`,
      ).bind(organizationId, now, now),
      db.prepare(
        `insert into briar_projects (
           id, owner_user_id, organization_id, name, agent_token_hash,
           created_at, updated_at
         ) values (?, ?, ?, 'Fleet Project', ?, ?, ?)`,
      ).bind(projectId, ownerId, organizationId, "f".repeat(64), now, now),
    ]);
    await db.batch([
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'owner', ?, ?)`,
      ).bind(organizationId, ownerId, now, now),
      db.prepare(
        `insert into briar_organization_members (
           organization_id, user_id, role, created_at, updated_at
         ) values (?, ?, 'developer', ?, ?)`,
      ).bind(organizationId, memberId, now, now),
    ]);
  }, 60_000);

  const env = () => ({
    DB: db,
    ATTACHMENTS: {},
    ARCHIVES: {},
    BETTER_AUTH_SECRET: "briar-test-secret-that-is-at-least-32-characters",
    GOOGLE_CLIENT_ID: "google-client",
    GOOGLE_CLIENT_SECRET: "google-secret",
    MANAGED_COMPUTER_APPLICATIONS_ENABLED: "true",
    MANAGED_COMPUTER_PROMOTION_CODE: JSON.stringify({
      "getbriar-pilot": "GETBRIAR",
    }),
    MANAGED_COMPUTER_ORGANIZATION_LIMIT: "1",
    MANAGED_COMPUTER_FLEET_LIMIT: "5",
    MANAGED_COMPUTER_LIFETIME_DAYS: "30",
    MANAGED_COMPUTER_AWS_REGION: "us-east-1",
    MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_ID: "lt-0123456789abcdef0",
    MANAGED_COMPUTER_AWS_LAUNCH_TEMPLATE_VERSION: "7",
    MANAGED_COMPUTER_API_ORIGIN: "https://briar.example",
    MANAGED_COMPUTER_ENROLLMENT_SECRET: "managed-enrollment-secret",
    MANAGED_COMPUTER_AWS_IDENTITY_PUBLIC_KEY: "test-public-key",
    MANAGED_COMPUTER_AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
    MANAGED_COMPUTER_AWS_SECRET_ACCESS_KEY: "secret",
    MANAGED_COMPUTER_PROVISIONING: {
      create: createWorkflow,
      get: getWorkflow,
    },
  }) as never;

  const executionContext = () => {
    const pending: Promise<unknown>[] = [];
    return {
      context: {
        waitUntil(promise: Promise<unknown>) {
          pending.push(promise);
        },
      } as ExecutionContext,
      pending,
    };
  };

  const client = (
    context?: ExecutionContext,
    onResponse?: (response: Response) => void,
  ) => createClient(
    FleetService,
    createConnectTransport({
      baseUrl: "https://briar.example",
      fetch: async (input, init) => {
        const response = await worker.fetch(
          new Request(input, { ...init, redirect: "manual" }),
          env(),
          context,
        );
        onResponse?.(response);
        return response;
      },
    }),
  );

  const options = (token: string) => ({
    headers: { authorization: `Bearer ${token}` },
  });

  const errorCode = async (operation: Promise<unknown>) => {
    const error = await operation.catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ConnectError);
    return (error as ConnectError).code;
  };

  const seedManagedComputer = async (input: {
    computerId: string;
    entitlementId: string;
    nonce: string;
    state: "failed" | "requested" | "provisioning" | "bootstrapping" | "needs_setup" | "ready" | "draining" | "stopped";
  }) => {
    await db.batch([
      db.prepare(
        `insert into briar_managed_computer_entitlements (
           id, organization_id, requester_user_id, source, source_reference,
           request_id, status, approved_at, created_at, updated_at
         ) values (?, ?, ?, 'payment', ?, ?, 'approved', ?, ?, ?)`,
      ).bind(
        input.entitlementId,
        organizationId,
        ownerId,
        `retirement-test:${input.computerId}`,
        `retirement-test:${input.computerId}`,
        now,
        now,
        now,
      ),
      db.prepare(
        `insert into briar_managed_computers (
           id, organization_id, requester_user_id, entitlement_id, state,
           aws_region, aws_instance_type, aws_launch_template_id,
           aws_launch_template_version, bootstrap_api_origin,
           provisioning_job_id, enrollment_nonce_hash, enrollment_expires_at,
           created_at, state_updated_at, expires_at, updated_at
         ) values (
           ?, ?, ?, ?, ?, 'us-east-1', 'm7i.large', 'lt-0123456789abcdef0',
           '7', 'https://briar.example', ?, ?, '2026-08-22T00:30:00.000Z',
           ?, ?, '2026-09-21T00:00:00.000Z', ?
         )`,
      ).bind(
        input.computerId,
        organizationId,
        ownerId,
        input.entitlementId,
        input.state,
        `retirement-job:${input.computerId}`,
        input.nonce.repeat(32) + input.computerId.replaceAll("-", ""),
        now,
        now,
        now,
      ),
    ]);
  };

  it("enrolls and idempotently unbinds a project Worker through FleetService", async () => {
    let cacheControl: string | null = null;
    const fleet = client(undefined, (response) => {
      cacheControl = response.headers.get("cache-control");
    });
    const registration = await fleet.registerProjectExecutionWorker({
      projectId,
      label: "Connect Worker",
      deviceIdentity: `briar_device_${"a".repeat(64)}`,
      runtime: workerRuntimeFixture({
        providers: [],
      }),
      maxConcurrentSessions: 2,
    }, options(ownerToken));
    expect(registration.workerToken).toMatch(/^briar_worker_/u);
    expect(registration.worker?.maxConcurrentSessions).toBe(2);
    expect(cacheControl).toBe("no-store");

    const requestId = `worker-unlink:${projectId}:${registration.worker!.id}`;
    await expect(fleet.unbindProjectExecutionWorker({
      projectId,
      workerId: registration.worker!.id,
      requestId: "wrong-request-id",
      reason: UnbindProjectExecutionWorkerRequest_Reason.EXPLICIT_USER_UNLINK,
    }, options(ownerToken))).rejects.toMatchObject({ code: Code.InvalidArgument });
    await expect(fleet.unbindProjectExecutionWorker({
      projectId,
      workerId: registration.worker!.id,
      requestId,
      reason: UnbindProjectExecutionWorkerRequest_Reason.EXPLICIT_USER_UNLINK,
    }, options(ownerToken))).resolves.toMatchObject({ alreadyUnbound: false });
    await expect(fleet.unbindProjectExecutionWorker({
      projectId,
      workerId: registration.worker!.id,
      requestId,
      reason: UnbindProjectExecutionWorkerRequest_Reason.EXPLICIT_USER_UNLINK,
    }, options(ownerToken))).resolves.toMatchObject({ alreadyUnbound: true });
  });

  it("enforces capability and validates promotion input at the Connect boundary", async () => {
    const fleet = client();
    const product = await fleet.getManagedComputerProduct(
      { organizationId },
      options(memberToken),
    );
    expect(product).toMatchObject({
      canApply: true,
      applicationsEnabled: true,
      product: { monthlyPriceCents: 10_000 },
    });
    expect(JSON.stringify(product)).not.toContain("GETBRIAR");

    const validation = await fleet.validateManagedComputerPromotion(
      { organizationId, code: "not-it" },
      options(ownerToken),
    );
    expect(validation).toMatchObject({
      valid: false,
      eligible: false,
      totalCents: 10_000,
    });
    expect(await errorCode(fleet.applyForManagedComputer(
      { organizationId, code: "GETBRIAR", requestId: "not-a-uuid" },
      options(ownerToken),
    ))).toBe(Code.InvalidArgument);
  });

  it("creates one managed computer application across an exact request replay", async () => {
    const fleet = client();
    const requestId = "22222222-2222-4222-8222-222222222222";
    const application = { organizationId, code: "  getbriar ", requestId };
    const first = await fleet.applyForManagedComputer(
      application,
      options(ownerToken),
    );
    expect(first).toMatchObject({
      duplicate: false,
      computer: { state: ManagedComputerState.REQUESTED },
      entitlement: { totalCents: 0 },
    });
    await expect(
      fleet.applyForManagedComputer(application, options(ownerToken)),
    ).resolves.toMatchObject({ duplicate: true });
    const counts = await db.prepare(`
      select
        (select count(*) from briar_managed_computer_entitlements) entitlements,
        (select count(*) from briar_managed_computer_promotion_redemptions) redemptions,
        (select count(*) from briar_managed_computers) computers,
        (select count(*) from briar_managed_computer_provisioning_jobs) jobs
    `).first<Record<string, number>>();
    expect(counts).toEqual({
      entitlements: 1,
      redemptions: 1,
      computers: 1,
      jobs: 1,
    });
  });

  it("owns retirement lifecycle and rejects preparation-state retirement", async () => {
    const stableId = "33333333-3333-4333-8333-333333333334";
    await seedManagedComputer({
      computerId: stableId,
      entitlementId: "44444444-4444-4444-8444-444444444445",
      nonce: "9",
      state: "failed",
    });
    const immediateStop = executionContext();
    const fleet = client(immediateStop.context);
    const retired = await fleet.retireManagedComputer(
      { organizationId, managedComputerId: stableId },
      options(memberToken),
    );
    expect(retired).toMatchObject({
      duplicate: false,
      computer: { id: stableId, state: ManagedComputerState.DRAINING },
    });
    expect(immediateStop.pending).toHaveLength(1);
    await Promise.all(immediateStop.pending);
    await expect(fleet.retireManagedComputer(
      { organizationId, managedComputerId: stableId },
      options(ownerToken),
    )).resolves.toMatchObject({
      duplicate: true,
      computer: { id: stableId, state: ManagedComputerState.STOPPED },
    });

    const preparingId = "33333333-3333-4333-8333-333333333335";
    await seedManagedComputer({
      computerId: preparingId,
      entitlementId: "44444444-4444-4444-8444-444444444446",
      nonce: "8",
      state: "requested",
    });
    expect(await errorCode(fleet.retireManagedComputer(
      { organizationId, managedComputerId: preparingId },
      options(ownerToken),
    ))).toBe(Code.FailedPrecondition);
    await expect(db.prepare(
      `select state from briar_managed_computers where id = ?`,
    ).bind(preparingId).first()).resolves.toMatchObject({ state: "requested" });
  });

  it("terminates a stopped instance immediately, revokes its worker, and removes it from the list", async () => {
    const fleet = client();
    const computerId = crypto.randomUUID();
    await seedManagedComputer({
      computerId,
      entitlementId: crypto.randomUUID(),
      nonce: "a",
      state: "stopped",
    });
    const registration = await fleet.registerProjectExecutionWorker({
      projectId,
      label: "Stopped managed worker",
      deviceIdentity: `briar_device_${"b".repeat(64)}`,
      runtime: workerRuntimeFixture({ providers: [] }),
      maxConcurrentSessions: 1,
    }, options(ownerToken));
    const binding = await db.prepare(
      `select device_id from briar_execution_workers where id = ?`,
    ).bind(registration.worker!.id).first<{ device_id: string }>();
    await db.prepare(
      `update briar_managed_computers
       set briar_device_id = ?, aws_instance_id = ?, stopped_at = ? where id = ?`,
    ).bind(binding!.device_id, "i-0123456789abcdef0", new Date().toISOString(), computerId).run();
    const aws = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(
      "<TerminateInstancesResponse/>",
      { status: 200 },
    ));
    const request = { organizationId, managedComputerId: computerId };
    await expect(fleet.terminateManagedComputer(request, options(memberToken))).resolves.toMatchObject({
      duplicate: false,
      computer: { id: computerId, state: ManagedComputerState.TERMINATED },
    });
    expect(aws).toHaveBeenCalledOnce();
    expect(aws).toHaveBeenCalledWith("https://ec2.us-east-1.amazonaws.com/", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("Action=TerminateInstances"),
    }));
    expect(new URLSearchParams(String(aws.mock.calls[0]?.[1]?.body)).get("InstanceId.1"))
      .toBe("i-0123456789abcdef0");
    await expect(db.prepare(
      `select state from briar_execution_worker_devices where id = ?`,
    ).bind(binding!.device_id).first()).resolves.toMatchObject({ state: "disabled" });
    await expect(db.prepare(
      `select state, accepting_work from briar_execution_workers where id = ?`,
    ).bind(registration.worker!.id).first()).resolves.toMatchObject({ state: "disabled", accepting_work: 0 });
    const credential = await db.prepare(
      `select revoked_at from briar_execution_worker_credentials where device_id = ?`,
    ).bind(binding!.device_id).first<{ revoked_at: string | null }>();
    expect(credential?.revoked_at).toEqual(expect.any(String));
    const listed = await fleet.listManagedComputers({ organizationId }, options(ownerToken));
    expect(listed.computers.some((computer) => computer.id === computerId)).toBe(false);
    await expect(fleet.getManagedComputer(request, options(ownerToken))).resolves.toMatchObject({
      computer: { state: ManagedComputerState.TERMINATED },
    });
    await expect(fleet.terminateManagedComputer(request, options(ownerToken))).resolves.toMatchObject({ duplicate: true });
    expect(aws).toHaveBeenCalledOnce();
    const audits = await db.prepare(
      `select actor_user_id, detail_json from briar_managed_computer_audit_events
       where managed_computer_id = ? and action = 'terminated'`,
    ).bind(computerId).all();
    expect(audits.results).toEqual([{
      actor_user_id: memberId,
      detail_json: JSON.stringify({ reason: "user_terminated" }),
    }]);
  });

  it.each(["requested", "provisioning", "bootstrapping", "needs_setup", "ready", "draining", "failed"] as const)(
    "rejects termination of a %s computer before contacting AWS",
    async (state) => {
      const computerId = crypto.randomUUID();
      await seedManagedComputer({ computerId, entitlementId: crypto.randomUUID(), nonce: "c", state });
      const aws = vi.spyOn(globalThis, "fetch");
      await expect(client().terminateManagedComputer(
        { organizationId, managedComputerId: computerId },
        options(ownerToken),
      )).rejects.toMatchObject({ code: Code.FailedPrecondition });
      expect(aws).not.toHaveBeenCalled();
      await expect(db.prepare(`select state from briar_managed_computers where id = ?`)
        .bind(computerId).first()).resolves.toMatchObject({ state });
    },
  );

  it("keeps a stopped computer listed after AWS rejects termination so it can be retried", async () => {
    const fleet = client();
    const computerId = crypto.randomUUID();
    await seedManagedComputer({ computerId, entitlementId: crypto.randomUUID(), nonce: "d", state: "stopped" });
    await db.prepare(`update briar_managed_computers set aws_instance_id = ? where id = ?`)
      .bind("i-0fedcba9876543210", computerId).run();
    const aws = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(
      "<Response><Errors><Error><Code>ServiceUnavailable</Code><Message>Try again</Message></Error></Errors></Response>",
      { status: 503 },
    ));
    const request = { organizationId, managedComputerId: computerId };
    await expect(fleet.terminateManagedComputer(request, options(ownerToken))).rejects.toBeInstanceOf(ConnectError);
    const listed = await fleet.listManagedComputers({ organizationId }, options(ownerToken));
    expect(listed.computers.find((computer) => computer.id === computerId)?.state).toBe(ManagedComputerState.STOPPED);
    aws.mockResolvedValueOnce(new Response("<TerminateInstancesResponse/>", { status: 200 }));
    await expect(fleet.terminateManagedComputer(request, options(ownerToken))).resolves.toMatchObject({
      computer: { state: ManagedComputerState.TERMINATED },
    });
  });

  it("requires development management and scopes termination to the requested organization", async () => {
    const fleet = client();
    const computerId = crypto.randomUUID();
    await seedManagedComputer({ computerId, entitlementId: crypto.randomUUID(), nonce: "e", state: "stopped" });
    const aws = vi.spyOn(globalThis, "fetch");
    await db.prepare(`update briar_organization_members set role = 'viewer' where user_id = ?`)
      .bind(memberId).run();
    try {
      await expect(fleet.terminateManagedComputer(
        { organizationId, managedComputerId: computerId }, options(memberToken),
      )).rejects.toMatchObject({ code: Code.PermissionDenied });
    } finally {
      await db.prepare(`update briar_organization_members set role = 'developer' where user_id = ?`)
        .bind(memberId).run();
    }
    const otherOrganizationId = crypto.randomUUID();
    await db.batch([
      db.prepare(`insert into briar_organizations (id, name, handle, created_at, updated_at)
        values (?, 'Other organization', 'termination-other', ?, ?)`)
        .bind(otherOrganizationId, now, now),
      db.prepare(`insert into briar_organization_members (organization_id, user_id, role, created_at, updated_at)
        values (?, ?, 'owner', ?, ?)`)
        .bind(otherOrganizationId, ownerId, now, now),
    ]);
    await expect(fleet.terminateManagedComputer(
      { organizationId: otherOrganizationId, managedComputerId: computerId }, options(ownerToken),
    )).rejects.toMatchObject({ code: Code.NotFound });
    expect(aws).not.toHaveBeenCalled();
    await expect(fleet.getManagedComputer(
      { organizationId, managedComputerId: computerId }, options(ownerToken),
    )).resolves.toMatchObject({ computer: { state: ManagedComputerState.STOPPED } });
  });
});
