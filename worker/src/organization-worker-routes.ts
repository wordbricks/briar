import { compareSemanticVersions, isSemanticVersion } from "../../src/lib/semantic-version";
import type { BriarAuth } from "./auth";
import { corsHeaders, HttpError, json } from "./http-response";
import { canManageOrganization } from "./organization-access";
import { getOrganizationRole } from "./organization-repository";
import { managedComputerByDeviceId } from "./managed-computer-repository";
import { endManagedComputerRemoteSessionsAndDisconnect } from "./managed-computer-remote-service";
import { readLatestVersion } from "./releases";
import { readJson } from "./request-readers";
import { requireSession } from "./session-auth";
import { decodeWorkerSettings } from "./worker-request-contract";
import {
  deleteExecutionWorker,
  listOrganizationExecutionWorkers,
  requestExecutionWorkerUpdate,
  updateExecutionWorkerConcurrency,
  updateExecutionWorkerIcon,
} from "./workers";

export type OrganizationWorkerRouteInput = {
  request: Request;
  url: URL;
  auth: BriarAuth;
  db: D1Database;
  env: Env;
};

export async function handleOrganizationWorkerRoute(
  routeInput: OrganizationWorkerRouteInput,
): Promise<Response | undefined> {
  const { request, url, auth, db, env } = routeInput;
  const { pathname } = url;

  const organizationWorkersMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/workers$/u,
  );
  if (organizationWorkersMatch && request.method === "GET") {
    const session = await requireSession(auth, request);
    const organizationId = organizationWorkersMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const observedAt = new Date().toISOString();
    return json({
      workers: await listOrganizationExecutionWorkers(
        db,
        organizationId,
        observedAt,
      ),
      latestVersion: await readLatestVersion(env.RELEASES),
      canManage: canManageOrganization(role),
      generatedAt: observedAt,
    });
  }

  const organizationWorkerUpdateMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/workers\/([0-9a-zA-Z-]+)\/updates$/u,
  );
  if (organizationWorkerUpdateMatch && request.method === "POST") {
    const session = await requireSession(auth, request);
    const organizationId = organizationWorkerUpdateMatch[1];
    const deviceId = organizationWorkerUpdateMatch[2];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const device = (
      await listOrganizationExecutionWorkers(
        db,
        organizationId,
        new Date().toISOString(),
      )
    ).find((candidate) => candidate.deviceId === deviceId);
    if (!device) throw new HttpError(404, "Worker not found");
    if (
      device.ownerUserId !== session.user.id &&
      !canManageOrganization(role)
    ) {
      throw new HttpError(
        403,
        "Worker owner or organization admin access required",
      );
    }
    if (!device.remoteUpdateSupported) {
      throw new HttpError(409, "Worker does not support remote updates");
    }
    const targetVersion = await readLatestVersion(env.RELEASES);
    if (!targetVersion) throw new HttpError(503, "Latest release is unavailable");
    const currentVersion = device.versions.briar;
    if (
      currentVersion &&
      isSemanticVersion(currentVersion) &&
      compareSemanticVersions(currentVersion, targetVersion) >= 0
    ) {
      return json({ outcome: "already_current", targetVersion });
    }
    const requestedAt = new Date().toISOString();
    const updateRequest = await requestExecutionWorkerUpdate(db, {
      id: crypto.randomUUID(),
      organizationId,
      deviceId,
      requestedByUserId: session.user.id,
      targetVersion,
      requestedAt,
    });
    return json({
      outcome: "requested",
      requestId: updateRequest.id,
      targetVersion: updateRequest.targetVersion,
    }, 202);
  }

  const organizationWorkerMatch = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/workers\/([0-9a-zA-Z-]+)$/u,
  );
  if (organizationWorkerMatch && request.method === "PATCH") {
    const session = await requireSession(auth, request);
    const organizationId = organizationWorkerMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const device = await db
      .prepare(
        `select id, owner_user_id
         from briar_execution_worker_devices
         where id = ? and organization_id = ?`,
      )
      .bind(organizationWorkerMatch[2], organizationId)
      .first<{ id: string; owner_user_id: string }>();
    if (!device) throw new HttpError(404, "Worker not found");
    if (
      device.owner_user_id !== session.user.id &&
      !canManageOrganization(role)
    ) {
      throw new HttpError(
        403,
        "Worker owner or organization admin access required",
      );
    }
    const input = decodeWorkerSettings(await readJson(request));
    const observedAt = new Date().toISOString();
    let updated =
      input.maxConcurrentSessions === undefined
        ? null
        : await updateExecutionWorkerConcurrency(
            db,
            device.id,
            input.maxConcurrentSessions,
            observedAt,
          );
    if (input.icon !== undefined) {
      updated = await updateExecutionWorkerIcon(
        db,
        device.id,
        input.icon,
        observedAt,
      );
    }
    if (!updated) throw new HttpError(409, "Worker is disabled");
    return json({
      deviceId: updated.id,
      maxConcurrentSessions: updated.max_concurrent_sessions,
      icon:
        updated.icon_type && updated.icon_value
          ? { type: updated.icon_type, value: updated.icon_value }
          : null,
    });
  }
  if (organizationWorkerMatch && request.method === "DELETE") {
    const session = await requireSession(auth, request);
    const organizationId = organizationWorkerMatch[1];
    const role = await getOrganizationRole(db, organizationId, session.user.id);
    if (!role) throw new HttpError(404, "Organization not found");
    const device = await db
      .prepare(
        `select id, owner_user_id
         from briar_execution_worker_devices
         where id = ? and organization_id = ?`,
      )
      .bind(organizationWorkerMatch[2], organizationId)
      .first<{ id: string; owner_user_id: string }>();
    if (!device) throw new HttpError(404, "Worker not found");
    if (
      device.owner_user_id !== session.user.id &&
      !canManageOrganization(role)
    ) {
      throw new HttpError(
        403,
        "Worker owner or organization admin access required",
      );
    }
    const managedComputer = await managedComputerByDeviceId(db, device.id);
    const observedAt = new Date().toISOString();
    let deleted: boolean;
    try {
      deleted = await deleteExecutionWorker(db, device.id, observedAt);
    } catch (error) {
      if (managedComputer) {
        await endManagedComputerRemoteSessionsAndDisconnect(db, env, {
          managedComputerId: managedComputer.id,
          reason: "worker_credential_revoked",
          observedAt,
        });
      }
      throw error;
    }
    if (managedComputer) {
      await endManagedComputerRemoteSessionsAndDisconnect(db, env, {
        managedComputerId: managedComputer.id,
        reason: "worker_credential_revoked",
        observedAt,
      });
    }
    if (!deleted) {
      throw new HttpError(404, "Worker not found");
    }
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  return undefined;
}
