import { workerWakeCredentialFromProtocols } from "../../src/lib/worker-wake-protocol";
import { HttpError } from "./http-response";
import { requireWorkerOrganization } from "./worker-route-auth";
import { subscribeToWorkerWake } from "./worker-wake-hub";

export type WorkerWakeRouteInput = {
  request: Request;
  db: D1Database;
  env: Env;
};

/**
 * Worker-facing wake socket.
 *
 * Authenticated as a Worker, not a user: the long-lived `briar_worker_`
 * credential arrives in the WebSocket subprotocol - the pattern the
 * managed-computer remote agent already uses - so it never lands in a query
 * string, an access log, or a referrer. No ticket exchange is needed because
 * the Worker already holds the credential the rest of its queue traffic uses.
 */
export async function handleWorkerWakeRoute(
  input: WorkerWakeRouteInput,
): Promise<Response | undefined> {
  const { pathname } = new URL(input.request.url);
  const match = pathname.match(
    /^\/organizations\/([0-9a-f-]+)\/worker-wake$/u,
  );
  if (!match || input.request.method !== "GET") return undefined;
  if (input.request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "WebSocket transport required");
  }
  const organizationId = match[1];
  const credential = workerWakeCredentialFromProtocols(
    input.request.headers.get("sec-websocket-protocol"),
  );
  if (!credential) throw new HttpError(401, "Invalid worker wake credential");
  const headers = new Headers(input.request.headers);
  headers.set("Authorization", `Bearer ${credential.token}`);
  await requireWorkerOrganization(
    input.db,
    new Request(input.request, { headers }),
    organizationId,
  );
  return subscribeToWorkerWake(input.env, organizationId, credential.protocol);
}
