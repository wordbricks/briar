import type { BriarAuth } from "./auth";
import { HttpError, json } from "./http-response";
import {
  decodeManagedComputerApplication,
  decodeManagedComputerEnrollment,
  decodeManagedComputerPromotionValidation,
  decodeManagedComputerRetry,
} from "./managed-computer-request-contract";
import { managedComputerJson } from "./managed-computer-model";
import {
  listOrganizationManagedComputers,
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
import { canManageOrganization } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";

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
