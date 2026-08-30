import {
  corsHeaders,
  HttpError,
  json,
  privateNoStoreJson,
} from "./http-response";
import {
  decodeManagedComputerEnrollment,
  decodeManagedComputerSetupAccess,
  decodeManagedComputerSetupBind,
} from "./managed-computer-request-contract";
import { managedComputerById } from "./managed-computer-repository";
import {
  bindManagedComputerSetup,
  enrollManagedComputer,
  managedComputerSetupContext,
} from "./managed-computer-service";
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
import { readJson } from "./request-readers";
import { requireWorkerCredential } from "./worker-auth";
import { workerJson } from "./worker-json";
import { createGithubInstallationToken } from "./github-app-api";
import { projectGithubIdentity } from "./project-github-routes";

export type ManagedComputerRouteInput = {
  request: Request;
  db: D1Database;
  env: Env;
};

/**
 * Serve machine bootstrap and WebSocket upgrade routes that intentionally stay
 * outside Connect. Authenticated unary fleet control lives in FleetService.
 */
export async function handleManagedComputerRoute(
  { request, db, env }: ManagedComputerRouteInput,
): Promise<Response | undefined> {
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

  const managedComputerSetupBindMatch = pathname.match(
    /^\/managed-computers\/([0-9a-f-]+)\/setup\/bind$/u,
  );
  if (managedComputerSetupBindMatch && request.method === "POST") {
    const principal = await requireWorkerCredential(db, request);
    const input = decodeManagedComputerSetupBind(await readJson(request));
    const observedAt = new Date().toISOString();
    const result = await bindManagedComputerSetup(db, {
      managedComputerId: managedComputerSetupBindMatch[1],
      organizationId: principal.organizationId,
      deviceId: principal.deviceId,
      setupToken: input.setupToken,
      worker: input.worker,
      observedAt,
    });
    return Response.json({
      managedComputerId: managedComputerSetupBindMatch[1],
      organizationId: principal.organizationId,
      projectId: result.session.project_id,
      deviceId: principal.deviceId,
      worker: workerJson(result.worker, observedAt),
      duplicate: result.duplicate,
    }, {
      status: result.duplicate ? 200 : 201,
      headers: { ...corsHeaders, "Cache-Control": "private, no-store" },
    });
  }

  const managedComputerSetupContextMatch = pathname.match(
    /^\/managed-computers\/([0-9a-f-]+)\/setup\/context$/u,
  );
  if (managedComputerSetupContextMatch && request.method === "POST") {
    const principal = await requireWorkerCredential(db, request);
    const input = decodeManagedComputerSetupAccess(await readJson(request));
    const setupContext = await managedComputerSetupContext(db, {
      managedComputerId: managedComputerSetupContextMatch[1],
      organizationId: principal.organizationId,
      deviceId: principal.deviceId,
      setupToken: input.setupToken,
      observedAt: new Date().toISOString(),
    });
    let repositoryCredential: Record<string, unknown> | undefined;
    if (setupContext.settings.githubRepository) {
      const identity = await projectGithubIdentity(db, {
        id: setupContext.project.id,
        organization_id: principal.organizationId,
      });
      const credential = await createGithubInstallationToken(env, identity);
      repositoryCredential = {
        project: {
          id: setupContext.project.id,
          organizationId: principal.organizationId,
        },
        repository: {
          id: identity.repositoryId,
          fullName: identity.repository,
          cloneUrl: `https://github.com/${identity.repository}.git`,
        },
        username: "x-access-token",
        password: credential.token,
        expiresAt: credential.expiresAt,
      };
    }
    return privateNoStoreJson({
      ...setupContext,
      ...(repositoryCredential ? { repositoryCredential } : {}),
    });
  }

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
