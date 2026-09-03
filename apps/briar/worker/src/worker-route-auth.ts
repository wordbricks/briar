import { sha256 } from "./crypto-digest";
import { findProjectIdByAgentTokenHash } from "./db";
import { HttpError } from "./http-response";
import {
  authenticateExecutionWorker,
  executionWorkerBindingById,
  executionWorkerBindingForProject,
} from "./workers";

const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
};

export async function requireAgentProject(
  db: D1Database,
  request: Request,
) {
  const token = bearerToken(request);
  if (!token.startsWith("briar_agent_")) {
    throw new HttpError(401, "Invalid agent token");
  }
  const projectId = await findProjectIdByAgentTokenHash(
    db,
    await sha256(token),
  );
  if (!projectId) throw new HttpError(401, "Invalid agent token");
  return projectId;
}

export async function requireWorkerCredential(
  db: D1Database,
  request: Request,
) {
  const token = bearerToken(request);
  if (!token.startsWith("briar_worker_")) {
    throw new HttpError(401, "Invalid worker token");
  }
  const principal = await authenticateExecutionWorker(
    db,
    await sha256(token),
    new Date().toISOString(),
  );
  if (!principal) throw new HttpError(401, "Invalid worker token");
  return principal;
}

export async function requireWorkerOrganization(
  db: D1Database,
  request: Request,
  organizationId: string,
) {
  const principal = await requireWorkerCredential(db, request);
  if (principal.organizationId !== organizationId) {
    throw new HttpError(403, "Worker is not enabled for this organization");
  }
  return principal;
}

export type AuthenticatedWorkerPrincipal = Awaited<
  ReturnType<typeof requireWorkerCredential>
>;

export type AuthenticatedWorkerTeam = {
  principal: AuthenticatedWorkerPrincipal;
  binding: NonNullable<
    Awaited<ReturnType<typeof executionWorkerBindingById>>
  >;
};

export async function requireWorkerProjectBinding(
  db: D1Database,
  request: Request,
  projectId: string,
  workerId?: string,
  preauthenticated?: AuthenticatedWorkerTeam,
): Promise<AuthenticatedWorkerTeam> {
  if (preauthenticated) {
    if (
      preauthenticated.binding.project_id !== projectId ||
      (workerId !== undefined && preauthenticated.binding.id !== workerId) ||
      preauthenticated.binding.state === "disabled"
    ) {
      throw new HttpError(403, "Worker is not enabled for this project");
    }
    return preauthenticated;
  }
  const principal = await requireWorkerCredential(db, request);
  const binding = workerId
    ? await executionWorkerBindingById(db, principal.deviceId, workerId)
    : await executionWorkerBindingForProject(db, principal.deviceId, projectId);
  if (
    !binding || binding.project_id !== projectId || binding.state === "disabled"
  ) {
    throw new HttpError(403, "Worker is not enabled for this project");
  }
  return { principal, binding };
}
