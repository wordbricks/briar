import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";
import { authenticateExecutionWorker } from "./workers";

const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
};

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
