import { sha256Hex } from "./managed-computer-crypto";
import { managedComputerConfig } from "./managed-computer-model";
import { managedComputerSetupSessionByTokenHash } from "./managed-computer-repository";
import {
  assertManagedComputerRemoteOrigin,
} from "./managed-computer-remote-service";
import {
  authorizeManagedComputerSetup,
  ManagedComputerServiceError,
} from "./managed-computer-service";

const clientProtocolPrefix = "briar-setup-v1.";
const agentProtocolPrefix = "briar-setup-agent-v1.";

function setupError(status: number, code: string, message: string) {
  return new ManagedComputerServiceError(status, code, message);
}

function requireSetupRelay(env: Env) {
  if (!env.MANAGED_COMPUTER_REMOTE) {
    throw setupError(
      503,
      "MANAGED_COMPUTER_SETUP_RELAY_NOT_CONFIGURED",
      "Managed computer setup relay is not configured",
    );
  }
}

function protocolToken(
  request: Request,
  prefix: string,
  pattern: RegExp,
) {
  const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = protocols.filter((value) => value.startsWith(prefix));
  if (candidates.length !== 1) return null;
  const token = candidates[0]!.slice(prefix.length);
  return pattern.test(token) ? { protocol: candidates[0]!, token } : null;
}

export const managedComputerSetupClientToken = (request: Request) =>
  protocolToken(
    request,
    clientProtocolPrefix,
    /^briar_setup_[A-Za-z0-9_-]{43}$/u,
  );

export const managedComputerSetupAgentToken = (request: Request) =>
  protocolToken(
    request,
    agentProtocolPrefix,
    /^briar_worker_[A-Za-z0-9_-]+$/u,
  );

function setupHub(env: Env, managedComputerId: string) {
  return env.MANAGED_COMPUTER_REMOTE.getByName(managedComputerId);
}

function setupSocketUrl(requestUrl: string, path: string) {
  const url = new URL(path, requestUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function managedComputerSetupClientSocket(
  requestUrl: string,
  input: {
    managedComputerId: string;
    sessionId: string;
    setupToken: string;
  },
) {
  return {
    url: setupSocketUrl(
      requestUrl,
      `/managed-computers/${input.managedComputerId}/setup-sessions/${input.sessionId}/connect`,
    ),
    protocol: `${clientProtocolPrefix}${input.setupToken}`,
  };
}

export async function managedComputerSetupAgentStatus(
  env: Env,
  managedComputerId: string,
) {
  if (!env.MANAGED_COMPUTER_REMOTE) return false;
  const response = await setupHub(env, managedComputerId).fetch(
    "https://managed-computer-remote.internal/status",
  );
  if (!response.ok) {
    throw setupError(
      503,
      "MANAGED_COMPUTER_SETUP_RELAY_UNAVAILABLE",
      "Managed computer setup relay is unavailable",
    );
  }
  const status = await response.json<{ setupAgentConnected?: boolean }>();
  return status.setupAgentConnected === true;
}

export async function connectManagedComputerSetupAgent(
  env: Env,
  input: { managedComputerId: string; request: Request },
) {
  requireSetupRelay(env);
  if (input.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw setupError(
      426,
      "MANAGED_COMPUTER_SETUP_UPGRADE_REQUIRED",
      "Managed setup agent requires a WebSocket connection",
    );
  }
  const agent = managedComputerSetupAgentToken(input.request);
  if (!agent) {
    throw setupError(
      401,
      "MANAGED_COMPUTER_SETUP_AGENT_TOKEN_INVALID",
      "Managed setup agent credential is invalid",
    );
  }
  return setupHub(env, input.managedComputerId).fetch(
    "https://managed-computer-remote.internal/connect",
    {
      headers: {
        Upgrade: "websocket",
        "X-Briar-Remote-Role": "setup-agent",
        "X-Briar-Remote-Protocol": agent.protocol,
      },
    },
  );
}

export async function connectManagedComputerSetupClient(
  db: D1Database,
  env: Env,
  input: {
    managedComputerId: string;
    sessionId: string;
    request: Request;
    observedAt: string;
  },
) {
  requireSetupRelay(env);
  assertManagedComputerRemoteOrigin(
    input.request,
    managedComputerConfig(env),
    { required: true },
  );
  if (input.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw setupError(
      426,
      "MANAGED_COMPUTER_SETUP_UPGRADE_REQUIRED",
      "Managed setup requires a WebSocket connection",
    );
  }
  const client = managedComputerSetupClientToken(input.request);
  if (!client) {
    throw setupError(
      401,
      "MANAGED_COMPUTER_SETUP_TOKEN_INVALID",
      "Managed setup connection token is invalid",
    );
  }
  const tokenHash = await sha256Hex(client.token);
  const candidate = await managedComputerSetupSessionByTokenHash(
    db,
    input.managedComputerId,
    tokenHash,
  );
  if (!candidate || candidate.id !== input.sessionId) {
    throw setupError(
      401,
      "MANAGED_COMPUTER_SETUP_TOKEN_INVALID",
      "Managed setup connection token is invalid",
    );
  }
  const { session } = await authorizeManagedComputerSetup(db, {
    managedComputerId: input.managedComputerId,
    organizationId: candidate.organization_id,
    setupToken: client.token,
    observedAt: input.observedAt,
    requirePending: true,
  });
  return setupHub(env, input.managedComputerId).fetch(
    "https://managed-computer-remote.internal/connect",
    {
      headers: {
        Upgrade: "websocket",
        "X-Briar-Remote-Role": "setup-controller",
        "X-Briar-Setup-Session": session.id,
        "X-Briar-Setup-Expires-At": session.expires_at,
        "X-Briar-Remote-Protocol": client.protocol,
      },
    },
  );
}
