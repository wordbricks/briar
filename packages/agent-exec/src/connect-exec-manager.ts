import type {
  ExecClientMessage,
  ExecServerMessage,
} from "@briar/contracts/gen/agent/v1/exec_pb";
import {
  ExecService,
  type ExecStreamElement,
} from "@briar/contracts/gen/agent/v1/exec_service_pb";
import { createClient, type Interceptor, type Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import type { RemoteExecManager } from "./exec-resource";

export const BOX_EXEC_PRIMARY_PORT = 1_337;
export const BOX_EXEC_FORK_ROUTER_PORT = 1_339;
export const BOX_EXEC_DISPLAY_HEADER = "x-sand-display";
export const BOX_EXEC_OWNER_HEADER = "x-sand-window-owner";
export const BOX_EXEC_OWNER_TOKEN_PATTERN = /^[A-Za-z0-9_-]+$/u;

export interface BoxExecConnection {
  readonly baseUrl: string;
  readonly authToken: string;
  readonly displayIndex?: number;
  readonly ownerToken?: string;
}

export interface BoxExecRequestHeaders {
  Authorization: string;
  [BOX_EXEC_DISPLAY_HEADER]?: string;
  [BOX_EXEC_OWNER_HEADER]?: string;
}

export class BoxExecConnectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BoxExecConnectionError";
  }
}

export class RemoteExecError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "RemoteExecError";
  }
}

export const boxExecHeaders = (
  connection: BoxExecConnection,
): BoxExecRequestHeaders => {
  const headers: BoxExecRequestHeaders = {
    Authorization: `Bearer ${connection.authToken}`,
  };
  const hasDisplay = connection.displayIndex !== undefined;
  const hasOwner = connection.ownerToken !== undefined;
  if (hasDisplay !== hasOwner) {
    throw new BoxExecConnectionError(
      "Fork box exec requires both display index and owner token",
    );
  }
  if (!hasDisplay || !hasOwner) return headers;
  if (!Number.isInteger(connection.displayIndex) || connection.displayIndex < 2) {
    throw new BoxExecConnectionError("Fork display index must be an integer of 2 or greater");
  }
  if (!BOX_EXEC_OWNER_TOKEN_PATTERN.test(connection.ownerToken)) {
    throw new BoxExecConnectionError("Fork owner token is malformed");
  }
  headers[BOX_EXEC_DISPLAY_HEADER] = String(connection.displayIndex);
  headers[BOX_EXEC_OWNER_HEADER] = connection.ownerToken;
  return headers;
};

export const loopbackBoxExecConnection = (input: {
  readonly authToken: string;
  readonly host?: string;
  readonly displayIndex?: number;
  readonly ownerToken?: string;
}): BoxExecConnection => {
  const fork = input.displayIndex !== undefined || input.ownerToken !== undefined;
  const host = input.host?.trim() || "127.0.0.1";
  return {
    baseUrl: `http://${host}:${fork ? BOX_EXEC_FORK_ROUTER_PORT : BOX_EXEC_PRIMARY_PORT}`,
    authToken: input.authToken,
    displayIndex: input.displayIndex,
    ownerToken: input.ownerToken,
  };
};

interface ExecStreamingClient {
  exec(
    message: ExecServerMessage,
    options?: { readonly signal?: AbortSignal },
  ): AsyncIterable<ExecStreamElement>;
}

const headersInterceptor = (
  headers: BoxExecRequestHeaders,
): Interceptor => (next) => async (request) => {
  for (const [name, value] of Object.entries(headers)) {
    request.header.set(name, value);
  }
  return next(request);
};

export class ConnectRemoteExecManager implements RemoteExecManager {
  private nextId = 1;

  constructor(private readonly client: ExecStreamingClient) {}

  async *createExecInstance(
    createMessage: (id: number) => ExecServerMessage,
    options: { readonly signal?: AbortSignal } = {},
  ): AsyncIterable<ExecClientMessage> {
    const id = this.nextId;
    this.nextId = this.nextId === 0xffff_ffff ? 1 : this.nextId + 1;
    const stream = this.client.exec(createMessage(id), { signal: options.signal });

    for await (const element of stream) {
      if (element.element.case === "execClientMessage") {
        yield element.element.value;
        continue;
      }
      if (element.element.case !== "execClientControlMessage") continue;
      const control = element.element.value.message;
      if (control.case === "heartbeat") continue;
      if (control.case === "streamClose") return;
      if (control.case === "throw") {
        throw new RemoteExecError(
          control.value.error,
          control.value.errorCode,
        );
      }
    }
  }
}

export const createBoxExecTransport = (
  connection: BoxExecConnection,
): Transport => createConnectTransport({
    baseUrl: connection.baseUrl.replace(/\/+$/u, ""),
    useBinaryFormat: true,
    interceptors: [headersInterceptor(boxExecHeaders(connection))],
  });

export const createConnectRemoteExecManager = (
  connection: BoxExecConnection,
): ConnectRemoteExecManager => new ConnectRemoteExecManager(
  createClient(ExecService, createBoxExecTransport(connection)),
);
