import type { BriarAuth } from "./auth";
import { corsHeaders, HttpError, json } from "./http-response";
import {
  decodeManagedComputerApplication,
  decodeManagedComputerEnrollment,
  decodeManagedComputerPromotionValidation,
  decodeManagedComputerRemoteSessionRequest,
  decodeManagedComputerRetry,
} from "./managed-computer-request-contract";
import { managedComputerConfig, managedComputerJson } from "./managed-computer-model";
import {
  listOrganizationManagedComputers,
  managedComputerById,
  organizationManagedComputer,
  refreshManagedComputerReadiness,
} from "./managed-computer-repository";
import {
  applyForPromotionalManagedComputer,
  enrollManagedComputer,
  managedComputerProductResponse,
  retryManagedComputerProvisioning,
  validateManagedComputerPromotion,
} from "./managed-computer-service";
import {
  assertManagedComputerRemoteOrigin,
  connectManagedComputerRemoteAgent,
  connectManagedComputerRemoteClient,
  createManagedComputerRemoteSessionTicket,
  endManagedComputerRemoteSessionAndDisconnect,
  managedComputerRemoteAgentToken,
  recordManagedComputerRemoteRejection,
} from "./managed-computer-remote-service";
import { canManageOrganization } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";
import { requireWorkerCredential } from "./worker-auth";

export type ManagedComputerRouteInput = {
  request: Request;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
};

export async function handleManagedComputerRoute(
  routeInput: ManagedComputerRouteInput,
): Promise<Response | undefined> {
  const { request, auth, db, env } = routeInput;
  const { pathname } = new URL(request.url);

  const managedComputerEnrollmentMatch = pathname.match(
    /^\/managed-computers\/([0-9a-f-]+)\/enroll$/u,
  );
  if (managedComputerEnrollmentMatch && request.method === "POST") {
    const input = decodeManagedComputerEnrollment(await readJson(request));
    const result = await enrollManagedComputer(db, env, {
      managedComputerId: managedComputerEnrollmentMatch[1],
      ...input,
      observedAt: new Date().toISOString(),
    });
    return json(result);
  }

  const managedComputerRemoteAgentMatch = pathname.match(
    /^\/managed-computers\/([0-9a-f-]+)\/remote-agent$/u,
  );
  if (managedComputerRemoteAgentMatch && request.method === "GET") {
    const agent = managedComputerRemoteAgentToken(request);
    if (!agent) {
      throw new HttpError(
        401,
        "Invalid remote display agent credential",
        "MANAGED_COMPUTER_REMOTE_AGENT_TOKEN_INVALID",
      );
    }
    const credentialHeaders = new Headers(request.headers);
    credentialHeaders.set("Authorization", `Bearer ${agent.token}`);
    const principal = await requireWorkerCredential(
      db,
      new Request(request, { headers: credentialHeaders }),
    );
    const computer = await managedComputerById(
      db,
      managedComputerRemoteAgentMatch[1],
    );
    if (
      !computer || computer.organization_id !== principal.organizationId ||
      computer.briar_device_id !== principal.deviceId ||
      !["needs_setup", "ready"].includes(computer.state)
    ) {
      throw new HttpError(
        403,
        "Worker is not authorized for this managed computer",
        "MANAGED_COMPUTER_REMOTE_AGENT_REJECTED",
      );
    }
    return connectManagedComputerRemoteAgent(env, {
      managedComputerId: computer.id,
      request,
    });
  }

  const managedComputerRemoteClientMatch = pathname.match(
    /^\/managed-computers\/([0-9a-f-]+)\/remote-sessions\/([0-9a-f-]+)\/connect$/u,
  );
  if (managedComputerRemoteClientMatch && request.method === "GET") {
    return connectManagedComputerRemoteClient(db, env, {
      request,
      managedComputerId: managedComputerRemoteClientMatch[1],
      sessionId: managedComputerRemoteClientMatch[2],
      observedAt: new Date().toISOString(),
    });
  }

  const managedComputerProductMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/product$/u,
  );
  if (managedComputerProductMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = managedComputerProductMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    return json({
      ...managedComputerProductResponse(env),
      canApply: canManageOrganization(role),
    });
  }

  const managedComputerPromotionMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/promotion\/validate$/u,
  );
  if (managedComputerPromotionMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = managedComputerPromotionMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeManagedComputerPromotionValidation(
      await readJson(request),
    );
    return json(await validateManagedComputerPromotion(db, env, {
      organizationId,
      userId: session.user.id,
      code: input.code,
      observedAt: new Date().toISOString(),
    }));
  }

  const organizationManagedComputersMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers$/u,
  );
  if (organizationManagedComputersMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputersMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const observedAt = new Date().toISOString();
    const computers = await listOrganizationManagedComputers(db, organizationId);
    const refreshed = await Promise.all(computers.map((computer) =>
      computer.state === "needs_setup"
        ? refreshManagedComputerReadiness(db, computer.id, observedAt)
        : Promise.resolve(computer)
    ));
    return json({
      computers: refreshed.flatMap((computer) =>
        computer ? [managedComputerJson(computer)] : []
      ),
      generatedAt: observedAt,
    });
  }
  if (organizationManagedComputersMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputersMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeManagedComputerApplication(await readJson(request));
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey !== input.requestId) {
      throw new HttpError(
        400,
        "Idempotency-Key must match requestId",
        "MANAGED_COMPUTER_IDEMPOTENCY_REQUIRED",
      );
    }
    const result = await applyForPromotionalManagedComputer(db, env, {
      organizationId,
      userId: session.user.id,
      code: input.code,
      requestId: input.requestId,
      observedAt: new Date().toISOString(),
    });
    return json({
      computer: managedComputerJson(result.computer),
      duplicate: result.duplicate,
      entitlement: { source: "free_promotion", totalCents: 0, currency: "USD" },
    }, result.duplicate ? 200 : 202);
  }

  const organizationManagedComputerRemoteSessionsMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/([0-9a-f-]+)\/remote-sessions$/u,
  );
  if (
    organizationManagedComputerRemoteSessionsMatch && request.method === "POST"
  ) {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputerRemoteSessionsMatch[1];
    const managedComputerId = organizationManagedComputerRemoteSessionsMatch[2];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    const computer = await organizationManagedComputer(
      db,
      organizationId,
      managedComputerId,
    );
    const observedAt = new Date().toISOString();
    if (
      !computer ||
      (!canManageOrganization(role) &&
        computer.requester_user_id !== session.user.id)
    ) {
      const attemptedComputer = computer ??
        await managedComputerById(db, managedComputerId);
      if (attemptedComputer) {
        await recordManagedComputerRemoteRejection(db, {
          organizationId: attemptedComputer.organization_id,
          managedComputerId: attemptedComputer.id,
          actorUserId: session.user.id,
          reasonCode: computer ? "permission_denied" : "organization_mismatch",
          observedAt,
        });
      }
      throw new HttpError(
        403,
        "Managed computer remote access required",
        "MANAGED_COMPUTER_REMOTE_FORBIDDEN",
      );
    }
    try {
      assertManagedComputerRemoteOrigin(
        request,
        managedComputerConfig(env),
        { required: true },
      );
    } catch (error) {
      await recordManagedComputerRemoteRejection(db, {
        organizationId: computer.organization_id,
        managedComputerId: computer.id,
        actorUserId: session.user.id,
        reasonCode: "origin_rejected",
        observedAt,
      });
      throw error;
    }
    const input = decodeManagedComputerRemoteSessionRequest(
      await readJson(request),
    );
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey !== input.requestId) {
      throw new HttpError(
        400,
        "Idempotency-Key must match requestId",
        "MANAGED_COMPUTER_REMOTE_IDEMPOTENCY_REQUIRED",
      );
    }
    return json(await createManagedComputerRemoteSessionTicket(db, env, {
      requestUrl: request.url,
      organizationId,
      managedComputerId,
      controllerUserId: session.user.id,
      requestId: input.requestId,
      reconnectSessionId: input.reconnectSessionId,
      observedAt,
    }), 201);
  }

  const organizationManagedComputerRemoteSessionMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/([0-9a-f-]+)\/remote-sessions\/([0-9a-f-]+)$/u,
  );
  if (
    organizationManagedComputerRemoteSessionMatch && request.method === "DELETE"
  ) {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputerRemoteSessionMatch[1];
    const managedComputerId = organizationManagedComputerRemoteSessionMatch[2];
    const remoteSessionId = organizationManagedComputerRemoteSessionMatch[3];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    const computer = await organizationManagedComputer(
      db,
      organizationId,
      managedComputerId,
    );
    const observedAt = new Date().toISOString();
    if (
      !computer ||
      (!canManageOrganization(role) &&
        computer.requester_user_id !== session.user.id)
    ) {
      const attemptedComputer = computer ??
        await managedComputerById(db, managedComputerId);
      if (attemptedComputer) {
        await recordManagedComputerRemoteRejection(db, {
          organizationId: attemptedComputer.organization_id,
          managedComputerId: attemptedComputer.id,
          actorUserId: session.user.id,
          reasonCode: computer ? "permission_denied" : "organization_mismatch",
          observedAt,
        });
      }
      throw new HttpError(
        403,
        "Managed computer remote access required",
        "MANAGED_COMPUTER_REMOTE_FORBIDDEN",
      );
    }
    try {
      assertManagedComputerRemoteOrigin(
        request,
        managedComputerConfig(env),
        { required: true },
      );
    } catch (error) {
      await recordManagedComputerRemoteRejection(db, {
        organizationId: computer.organization_id,
        managedComputerId: computer.id,
        actorUserId: session.user.id,
        reasonCode: "origin_rejected",
        observedAt,
      });
      throw error;
    }
    const ended = await endManagedComputerRemoteSessionAndDisconnect(db, env, {
      sessionId: remoteSessionId,
      organizationId,
      managedComputerId,
      actorUserId: session.user.id,
      reason: "user_ended",
      observedAt,
    });
    if (!ended) {
      throw new HttpError(
        404,
        "Remote desktop session not found",
        "MANAGED_COMPUTER_REMOTE_SESSION_NOT_FOUND",
      );
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const organizationManagedComputerRetryMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/([0-9a-f-]+)\/retry$/u,
  );
  if (organizationManagedComputerRetryMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputerRetryMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!canManageOrganization(role)) {
      throw new HttpError(403, "Organization admin access required");
    }
    const input = decodeManagedComputerRetry(await readJson(request));
    const idempotencyKey = request.headers.get("idempotency-key")?.trim();
    if (!idempotencyKey || idempotencyKey !== input.requestId) {
      throw new HttpError(
        400,
        "Idempotency-Key must match requestId",
        "MANAGED_COMPUTER_IDEMPOTENCY_REQUIRED",
      );
    }
    const result = await retryManagedComputerProvisioning(db, env, {
      organizationId,
      managedComputerId: organizationManagedComputerRetryMatch[2],
      userId: session.user.id,
      requestId: input.requestId,
      observedAt: new Date().toISOString(),
    });
    const computer = await organizationManagedComputer(
      db,
      organizationId,
      organizationManagedComputerRetryMatch[2],
    );
    if (!computer) throw new HttpError(404, "Managed computer not found");
    return json({
      computer: managedComputerJson(computer),
      duplicate: !result.created,
    }, 202);
  }

  const organizationManagedComputerMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/managed-computers\/([0-9a-f-]+)$/u,
  );
  if (organizationManagedComputerMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationManagedComputerMatch[1];
    if (!(await getOrganizationRole(db, organizationId, session.user.id))) {
      throw new HttpError(404, "Organization not found");
    }
    let computer = await organizationManagedComputer(
      db,
      organizationId,
      organizationManagedComputerMatch[2],
    );
    if (!computer) throw new HttpError(404, "Managed computer not found");
    if (computer.state === "needs_setup") {
      computer = await refreshManagedComputerReadiness(
        db,
        computer.id,
        new Date().toISOString(),
      );
    }
    if (!computer) throw new HttpError(404, "Managed computer not found");
    return json({ computer: managedComputerJson(computer) });
  }

  return undefined;
}
