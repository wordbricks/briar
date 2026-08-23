import { sha256 } from "./crypto-digest";
import { HttpError } from "./http-response";
import { authenticateExecutionWorker } from "./workers";

export async function requireWorkerCredential(
  db: D1Database,
  request: Request,
) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
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
