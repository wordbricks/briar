import {
  randomManagedComputerRemoteToken,
  sha256Hex,
} from "./managed-computer-crypto";
import {
  managedComputerConfig,
  type ManagedComputerConfig,
  type ManagedComputerRow,
} from "./managed-computer-model";
import { managedComputerRemoteSessionJson } from "./managed-computer-remote-model";
import {
  activeManagedComputerRemoteSession,
  consumeManagedComputerRemoteSessionToken,
  createManagedComputerRemoteSession,
  endManagedComputerRemoteSession,
  endManagedComputerRemoteSessionsForComputer,
  expireStaleManagedComputerRemoteSessions,
  managedComputerRemoteSessionByRequest,
  managedComputerRemoteSessionById,
  managedComputerRemoteSessionCapacity,
  reconnectManagedComputerRemoteSession,
  recordManagedComputerRemoteAuditEvent,
} from "./managed-computer-remote-repository";
import { organizationManagedComputer } from "./managed-computer-repository";
import { ManagedComputerServiceError } from "./managed-computer-service";

const clientProtocolPrefix = "briar-remote-v1.";
const agentProtocolPrefix = "briar-remote-agent-v1.";
const rateWindowMs = 5 * 60_000;

function remoteError(status: number, code: string, message: string) {
  return new ManagedComputerServiceError(status, code, message);
}

export async function recordManagedComputerRemoteRejection(
  db: D1Database,
  input: {
    organizationId: string;
    managedComputerId: string;
    actorUserId?: string | null;
    remoteSessionId?: string | null;
    reasonCode: string;
    observedAt: string;
  },
) {
  await recordManagedComputerRemoteAuditEvent(db, {
    organizationId: input.organizationId,
    managedComputerId: input.managedComputerId,
    remoteSessionId: input.remoteSessionId,
    actorUserId: input.actorUserId,
    action: "connection_rejected",
    reasonCode: input.reasonCode,
    occurredAt: input.observedAt,
  });
}

async function recordRemoteSessionConnectionRejection(
  db: D1Database,
  input: {
    sessionId: string;
    managedComputerId: string;
    reasonCode: string;
    observedAt: string;
  },
) {
  const session = await managedComputerRemoteSessionById(db, input.sessionId);
  if (!session || session.managed_computer_id !== input.managedComputerId) return;
  await recordManagedComputerRemoteRejection(db, {
    organizationId: session.organization_id,
    managedComputerId: session.managed_computer_id,
    remoteSessionId: session.id,
    actorUserId: session.controller_user_id,
    reasonCode: input.reasonCode,
    observedAt: input.observedAt,
  });
}

function requireRemoteDesktop(config: ManagedComputerConfig, env: Env) {
  if (!config.remoteDesktopEnabled) {
    throw remoteError(
      503,
      "MANAGED_COMPUTER_REMOTE_DISABLED",
      "Managed computer remote desktop is not enabled",
    );
  }
  if (!env.MANAGED_COMPUTER_REMOTE) {
    throw remoteError(
      503,
      "MANAGED_COMPUTER_REMOTE_NOT_CONFIGURED",
      "Managed computer remote relay is not configured",
    );
  }
}

export function assertManagedComputerRemoteRequestOrigin(
  request: {
    readonly origin: string | null;
    readonly secFetchSite: string | null;
  },
  config: ManagedComputerConfig,
  options: { required: boolean },
) {
  const origin = request.origin?.trim() ?? "";
  if (!origin) {
    if (
      options.required ||
      request.secFetchSite?.toLowerCase() === "cross-site"
    ) {
      throw remoteError(
        403,
        "MANAGED_COMPUTER_REMOTE_ORIGIN_REJECTED",
        "Remote desktop request origin is not allowed",
      );
    }
    return;
  }
  if (!config.remoteDesktopAllowedOrigins.includes(origin)) {
    throw remoteError(
      403,
      "MANAGED_COMPUTER_REMOTE_ORIGIN_REJECTED",
      "Remote desktop request origin is not allowed",
    );
  }
}

export function assertManagedComputerRemoteOrigin(
  request: Request,
  config: ManagedComputerConfig,
  options: { required: boolean },
) {
  return assertManagedComputerRemoteRequestOrigin({
    origin: request.headers.get("origin"),
    secFetchSite: request.headers.get("sec-fetch-site"),
  }, config, options);
}

export function managedComputerRemoteClientToken(request: Request) {
  const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = protocols.filter((value) =>
    value.startsWith(clientProtocolPrefix)
  );
  if (candidates.length !== 1) return null;
  const token = candidates[0].slice(clientProtocolPrefix.length);
  if (!/^briar_remote_[A-Za-z0-9_-]{43}$/u.test(token)) return null;
  return { protocol: candidates[0], token };
}

export function managedComputerRemoteAgentToken(request: Request) {
  const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const candidates = protocols.filter((value) =>
    value.startsWith(agentProtocolPrefix)
  );
  if (candidates.length !== 1) return null;
  const token = candidates[0].slice(agentProtocolPrefix.length);
  if (!/^briar_worker_[A-Za-z0-9_-]+$/u.test(token)) return null;
  return { protocol: candidates[0], token };
}

function remoteSocketUrl(requestUrl: string, path: string) {
  const url = new URL(path, requestUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function remoteHub(env: Env, managedComputerId: string) {
  return env.MANAGED_COMPUTER_REMOTE.getByName(managedComputerId);
}

export async function managedComputerRemoteAgentStatus(
  env: Env,
  managedComputerId: string,
) {
  const response = await remoteHub(env, managedComputerId).fetch(
    "https://managed-computer-remote.internal/status",
  );
  if (!response.ok) {
    throw remoteError(
      503,
      "MANAGED_COMPUTER_REMOTE_RELAY_UNAVAILABLE",
      "Managed computer remote relay is unavailable",
    );
  }
  return response.json<{ agentConnected: boolean; controllerConnected: boolean }>();
}

function assertRemoteComputerAvailable(computer: ManagedComputerRow | null) {
  if (!computer) {
    throw remoteError(
      404,
      "MANAGED_COMPUTER_NOT_FOUND",
      "Managed computer was not found",
    );
  }
  if (
    !["needs_setup", "ready"].includes(computer.state) ||
    !computer.briar_device_id
  ) {
    throw remoteError(
      409,
      "MANAGED_COMPUTER_REMOTE_OFFLINE",
      "Managed computer is not available for remote control",
    );
  }
  return computer;
}

export async function createManagedComputerRemoteSessionTicket(
  db: D1Database,
  env: Env,
  input: {
    requestUrl: string;
    organizationId: string;
    managedComputerId: string;
    controllerUserId: string;
    requestId: string;
    reconnectSessionId?: string;
    observedAt: string;
  },
) {
  const config = managedComputerConfig(env);
  requireRemoteDesktop(config, env);
  await expireStaleManagedComputerRemoteSessionsAndDisconnect(
    db,
    env,
    input.observedAt,
  );
  const computer = assertRemoteComputerAvailable(
    await organizationManagedComputer(
      db,
      input.organizationId,
      input.managedComputerId,
    ),
  );
  const status = await managedComputerRemoteAgentStatus(env, computer.id);
  if (!status.agentConnected) {
    await recordManagedComputerRemoteAuditEvent(db, {
      organizationId: computer.organization_id,
      managedComputerId: computer.id,
      actorUserId: input.controllerUserId,
      action: "connection_rejected",
      reasonCode: "agent_offline",
      occurredAt: input.observedAt,
    });
    throw remoteError(
      409,
      "MANAGED_COMPUTER_REMOTE_OFFLINE",
      "Managed computer remote display agent is offline",
    );
  }

  const token = randomManagedComputerRemoteToken();
  const clientTokenHash = await sha256Hex(token);
  const observedAtMs = Date.parse(input.observedAt);
  const tokenExpiresAt = new Date(
    observedAtMs + config.remoteDesktopTokenTtlSeconds * 1_000,
  ).toISOString();
  const existingByRequest = await managedComputerRemoteSessionByRequest(db, {
    organizationId: input.organizationId,
    controllerUserId: input.controllerUserId,
    requestId: input.requestId,
  });
  const activeSession = await activeManagedComputerRemoteSession(
    db,
    input.managedComputerId,
  );
  const recoverableSessionId =
    activeSession?.state === "disconnected" &&
      activeSession.controller_user_id === input.controllerUserId
      ? activeSession.id
      : undefined;
  const reconnectSessionId = recoverableSessionId ??
    input.reconnectSessionId ?? existingByRequest?.id;
  if (reconnectSessionId) {
    const reconnectCapacity = await managedComputerRemoteSessionCapacity(db, {
      organizationId: input.organizationId,
      userId: input.controllerUserId,
      rateCutoff: new Date(observedAtMs - rateWindowMs).toISOString(),
    });
    if (reconnectCapacity.recent_user_count >= config.remoteDesktopRateLimit) {
      await recordManagedComputerRemoteAuditEvent(db, {
        organizationId: computer.organization_id,
        managedComputerId: computer.id,
        actorUserId: input.controllerUserId,
        action: "connection_rejected",
        reasonCode: "MANAGED_COMPUTER_REMOTE_RATE_LIMITED",
        occurredAt: input.observedAt,
      });
      throw remoteError(
        429,
        "MANAGED_COMPUTER_REMOTE_RATE_LIMITED",
        "Too many remote desktop session requests",
      );
    }
  }
  let session = reconnectSessionId
    ? await reconnectManagedComputerRemoteSession(db, {
        sessionId: reconnectSessionId,
        organizationId: input.organizationId,
        managedComputerId: input.managedComputerId,
        controllerUserId: input.controllerUserId,
        requestId: input.requestId,
        clientTokenHash,
        tokenExpiresAt,
        observedAt: input.observedAt,
      })
    : null;
  let reconnected = Boolean(session);
  if (!session) {
    const sessionId = crypto.randomUUID();
    session = await createManagedComputerRemoteSession(db, {
      id: sessionId,
      organizationId: input.organizationId,
      managedComputerId: input.managedComputerId,
      controllerUserId: input.controllerUserId,
      requestId: input.requestId,
      clientTokenHash,
      tokenExpiresAt,
      maxExpiresAt: new Date(
        observedAtMs + config.remoteDesktopMaxSessionMinutes * 60_000,
      ).toISOString(),
      organizationSessionLimit: config.remoteDesktopOrganizationSessionLimit,
      fleetSessionLimit: config.remoteDesktopFleetSessionLimit,
      rateLimit: config.remoteDesktopRateLimit,
      rateCutoff: new Date(observedAtMs - rateWindowMs).toISOString(),
      observedAt: input.observedAt,
    });
    reconnected = false;
  }
  if (!session) {
    const [active, capacity] = await Promise.all([
      activeManagedComputerRemoteSession(db, input.managedComputerId),
      managedComputerRemoteSessionCapacity(db, {
        organizationId: input.organizationId,
        userId: input.controllerUserId,
        rateCutoff: new Date(observedAtMs - rateWindowMs).toISOString(),
      }),
    ]);
    const rejection = active
      ? [409, "MANAGED_COMPUTER_REMOTE_IN_USE", "Managed computer is already being controlled"] as const
      : capacity.recent_user_count >= config.remoteDesktopRateLimit
        ? [429, "MANAGED_COMPUTER_REMOTE_RATE_LIMITED", "Too many remote desktop session requests"] as const
        : capacity.organization_count >=
            config.remoteDesktopOrganizationSessionLimit
          ? [409, "MANAGED_COMPUTER_REMOTE_ORGANIZATION_LIMIT", "Organization remote desktop limit reached"] as const
          : [409, "MANAGED_COMPUTER_REMOTE_FLEET_LIMIT", "Remote desktop fleet limit reached"] as const;
    await recordManagedComputerRemoteAuditEvent(db, {
      organizationId: computer.organization_id,
      managedComputerId: computer.id,
      actorUserId: input.controllerUserId,
      action: "connection_rejected",
      reasonCode: rejection[1],
      occurredAt: input.observedAt,
    });
    throw remoteError(rejection[0], rejection[1], rejection[2]);
  }
  await recordManagedComputerRemoteAuditEvent(db, {
    organizationId: session.organization_id,
    managedComputerId: session.managed_computer_id,
    remoteSessionId: session.id,
    actorUserId: session.controller_user_id,
    action: reconnected ? "reconnect_issued" : "session_created",
    occurredAt: input.observedAt,
  });
  return {
    session: managedComputerRemoteSessionJson(session),
    socket: {
      url: remoteSocketUrl(
        input.requestUrl,
        `/managed-computers/${computer.id}/remote-sessions/${session.id}/connect`,
      ),
      protocol: `${clientProtocolPrefix}${token}`,
    },
    reconnected,
  };
}

export async function expireStaleManagedComputerRemoteSessionsAndDisconnect(
  db: D1Database,
  env: Env,
  observedAt: string,
) {
  const expired = await expireStaleManagedComputerRemoteSessions(
    db,
    observedAt,
  );
  for (const session of expired) {
    const reason = session.max_expires_at <= observedAt
      ? "max_lifetime"
      : "connection_timeout";
    await recordManagedComputerRemoteAuditEvent(db, {
      organizationId: session.organization_id,
      managedComputerId: session.managed_computer_id,
      remoteSessionId: session.id,
      actorUserId: session.controller_user_id,
      action: "session_expired",
      reasonCode: reason,
      controllerBytes: session.controller_bytes,
      screenBytes: session.screen_bytes,
      occurredAt: observedAt,
    });
    if (env.MANAGED_COMPUTER_REMOTE) {
      await remoteHub(env, session.managed_computer_id).fetch(
        "https://managed-computer-remote.internal/disconnect-controller",
        {
          method: "POST",
          headers: { "X-Briar-Remote-Session": session.id },
        },
      );
    }
  }
  return expired;
}

export async function connectManagedComputerRemoteClient(
  db: D1Database,
  env: Env,
  input: {
    request: Request;
    managedComputerId: string;
    sessionId: string;
    observedAt: string;
  },
) {
  const config = managedComputerConfig(env);
  requireRemoteDesktop(config, env);
  try {
    assertManagedComputerRemoteOrigin(input.request, config, { required: true });
  } catch (error) {
    await recordRemoteSessionConnectionRejection(db, {
      sessionId: input.sessionId,
      managedComputerId: input.managedComputerId,
      reasonCode: "origin_rejected",
      observedAt: input.observedAt,
    });
    throw error;
  }
  if (input.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    await recordRemoteSessionConnectionRejection(db, {
      sessionId: input.sessionId,
      managedComputerId: input.managedComputerId,
      reasonCode: "upgrade_required",
      observedAt: input.observedAt,
    });
    throw remoteError(
      426,
      "MANAGED_COMPUTER_REMOTE_UPGRADE_REQUIRED",
      "Remote desktop requires a WebSocket connection",
    );
  }
  const client = managedComputerRemoteClientToken(input.request);
  if (!client) {
    await recordRemoteSessionConnectionRejection(db, {
      sessionId: input.sessionId,
      managedComputerId: input.managedComputerId,
      reasonCode: "token_invalid",
      observedAt: input.observedAt,
    });
    throw remoteError(
      401,
      "MANAGED_COMPUTER_REMOTE_TOKEN_INVALID",
      "Remote desktop connection token is invalid",
    );
  }
  const session = await consumeManagedComputerRemoteSessionToken(db, {
    sessionId: input.sessionId,
    managedComputerId: input.managedComputerId,
    clientTokenHash: await sha256Hex(client.token),
    observedAt: input.observedAt,
  });
  if (!session) {
    await recordRemoteSessionConnectionRejection(db, {
      sessionId: input.sessionId,
      managedComputerId: input.managedComputerId,
      reasonCode: "token_expired_or_reused",
      observedAt: input.observedAt,
    });
    throw remoteError(
      401,
      "MANAGED_COMPUTER_REMOTE_TOKEN_EXPIRED",
      "Remote desktop connection token is expired or already used",
    );
  }
  return remoteHub(env, input.managedComputerId).fetch(
    "https://managed-computer-remote.internal/connect",
    {
      headers: {
        Upgrade: "websocket",
        "X-Briar-Remote-Role": "controller",
        "X-Briar-Remote-Session": session.id,
        "X-Briar-Remote-Generation": String(session.connection_generation),
        "X-Briar-Remote-Expires-At": session.max_expires_at,
        "X-Briar-Remote-Protocol": client.protocol,
      },
    },
  );
}

export async function connectManagedComputerRemoteAgent(
  env: Env,
  input: {
    managedComputerId: string;
    request: Request;
  },
) {
  const config = managedComputerConfig(env);
  requireRemoteDesktop(config, env);
  if (input.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw remoteError(
      426,
      "MANAGED_COMPUTER_REMOTE_UPGRADE_REQUIRED",
      "Remote display agent requires a WebSocket connection",
    );
  }
  const agent = managedComputerRemoteAgentToken(input.request);
  if (!agent) {
    throw remoteError(
      401,
      "MANAGED_COMPUTER_REMOTE_AGENT_TOKEN_INVALID",
      "Remote display agent credential is invalid",
    );
  }
  return remoteHub(env, input.managedComputerId).fetch(
    "https://managed-computer-remote.internal/connect",
    {
      headers: {
        Upgrade: "websocket",
        "X-Briar-Remote-Role": "agent",
        "X-Briar-Remote-Protocol": agent.protocol,
      },
    },
  );
}

export async function endManagedComputerRemoteSessionAndDisconnect(
  db: D1Database,
  env: Env,
  input: {
    sessionId: string;
    organizationId: string;
    managedComputerId: string;
    actorUserId: string;
    reason: string;
    observedAt: string;
  },
) {
  const session = await endManagedComputerRemoteSession(db, input);
  if (!session) return null;
  await recordManagedComputerRemoteAuditEvent(db, {
    organizationId: session.organization_id,
    managedComputerId: session.managed_computer_id,
    remoteSessionId: session.id,
    actorUserId: input.actorUserId,
    action: "session_ended",
    reasonCode: input.reason,
    controllerBytes: session.controller_bytes,
    screenBytes: session.screen_bytes,
    occurredAt: input.observedAt,
  });
  await remoteHub(env, input.managedComputerId).fetch(
    "https://managed-computer-remote.internal/disconnect-controller",
    {
      method: "POST",
      headers: { "X-Briar-Remote-Session": session.id },
    },
  );
  return session;
}

export async function endManagedComputerRemoteSessionsAndDisconnect(
  db: D1Database,
  env: Env,
  input: {
    managedComputerId: string;
    reason: string;
    observedAt: string;
  },
) {
  const sessions = await endManagedComputerRemoteSessionsForComputer(db, input);
  for (const session of sessions) {
    await recordManagedComputerRemoteAuditEvent(db, {
      organizationId: session.organization_id,
      managedComputerId: session.managed_computer_id,
      remoteSessionId: session.id,
      actorUserId: null,
      action: "session_ended",
      reasonCode: input.reason,
      controllerBytes: session.controller_bytes,
      screenBytes: session.screen_bytes,
      occurredAt: input.observedAt,
    });
  }
  if (env.MANAGED_COMPUTER_REMOTE) {
    await remoteHub(env, input.managedComputerId).fetch(
      "https://managed-computer-remote.internal/disconnect",
      { method: "POST" },
    );
  }
  return sessions;
}
