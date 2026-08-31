import { HttpError } from "./http-response";
import { managedComputerById } from "./managed-computer-repository";
import {
  connectManagedComputerRemoteAgent,
  connectManagedComputerRemoteClient,
  managedComputerRemoteAgentToken,
} from "./managed-computer-remote-service";
import {
  connectManagedComputerSetupAgent,
  connectManagedComputerSetupClient,
  managedComputerSetupAgentToken,
} from "./managed-computer-setup-relay-service";
import { requireWorkerCredential } from "./worker-route-auth";

export type ManagedComputerRouteInput = {
  request: Request;
  db: D1Database;
  env: Env;
};

/**
 * Serve WebSocket upgrades that intentionally stay outside Connect. Enrollment,
 * authenticated setup, and fleet control live in generated Connect services.
 */
export async function handleManagedComputerRoute(
  { request, db, env }: ManagedComputerRouteInput,
): Promise<Response | undefined> {
  const { pathname } = new URL(request.url);

  const managedComputerSetupAgentMatch = pathname.match(
    /^\/managed-computers\/([0-9a-f-]+)\/setup-agent$/u,
  );
  if (managedComputerSetupAgentMatch && request.method === "GET") {
    const agent = managedComputerSetupAgentToken(request);
    if (!agent) {
      throw new HttpError(
        401,
        "Invalid managed setup agent credential",
        "MANAGED_COMPUTER_SETUP_AGENT_TOKEN_INVALID",
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
      managedComputerSetupAgentMatch[1],
    );
    if (
      !computer || computer.organization_id !== principal.organizationId ||
      computer.briar_device_id !== principal.deviceId ||
      !["needs_setup", "ready"].includes(computer.state)
    ) {
      throw new HttpError(
        403,
        "Worker is not authorized for this managed computer",
        "MANAGED_COMPUTER_SETUP_AGENT_REJECTED",
      );
    }
    return connectManagedComputerSetupAgent(env, {
      managedComputerId: computer.id,
      request,
    });
  }

  const managedComputerSetupClientMatch = pathname.match(
    /^\/managed-computers\/([0-9a-f-]+)\/setup-sessions\/([0-9a-f-]+)\/connect$/u,
  );
  if (managedComputerSetupClientMatch && request.method === "GET") {
    return connectManagedComputerSetupClient(db, env, {
      managedComputerId: managedComputerSetupClientMatch[1],
      sessionId: managedComputerSetupClientMatch[2],
      request,
      observedAt: new Date().toISOString(),
    });
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

  return undefined;
}
