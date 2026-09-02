import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, isAbsolute } from "node:path";
import { create } from "@bufbuild/protobuf";
import {
  ComputerUseWindowSchema,
  ComputerUseWindowService,
  EnsureComputerUseWindowResponseSchema,
  ReleaseComputerUseWindowResponseSchema,
} from "@briar/contracts/gen/briar/box/v1/computer_use_window_pb";
import { ExecService } from "@briar/contracts/gen/agent/v1/exec_service_pb";
import {
  BOX_EXEC_DISPLAY_HEADER,
  BOX_EXEC_FORK_ROUTER_PORT,
  BOX_EXEC_OWNER_HEADER,
  BOX_EXEC_OWNER_TOKEN_PATTERN,
  BOX_EXEC_PRIMARY_PORT,
  GovernedComputerUseExecutor,
  SimpleControlledExecManager,
  computerUseExecutorResource,
} from "@briar/agent-exec";
import {
  Code,
  ConnectError,
  type HandlerContext,
  type Interceptor,
} from "@connectrpc/connect";
import { connectNodeAdapter } from "@connectrpc/connect-node";
import * as Predicate from "effect/Predicate";
import {
  ComputerUseDesktopManager,
  ComputerUseDesktopOwnershipError,
  FileComputerUseAssignmentStore,
} from "./computer-use-desktop-manager";
import { NativeComputerUseExecutor } from "./computer-use-native-executor";
import { SystemdComputerUseWindowSupervisor } from "./computer-use-window-supervisor";

export const defaultBoxExecAuthTokenPath =
  "/var/lib/briar-computer-use/box-auth-token";
export const BOX_EXEC_MAX_MESSAGE_BYTES = 16 * 1024 * 1024;

export class BoxExecAuthTokenError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BoxExecAuthTokenError";
  }
}

const tokenMatches = (provided: string, expected: string): boolean => {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.byteLength === expectedBytes.byteLength
    && timingSafeEqual(providedBytes, expectedBytes);
};

const bearerToken = (header: string | null): string | undefined => {
  const prefix = "Bearer ";
  return header?.startsWith(prefix) === true ? header.slice(prefix.length) : undefined;
};

export const configuredBoxExecAuthTokenPath = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const path = environment.BRIAR_BOX_EXEC_AUTH_TOKEN_FILE?.trim()
    || defaultBoxExecAuthTokenPath;
  if (!isAbsolute(path)) {
    throw new BoxExecAuthTokenError(
      "BRIAR_BOX_EXEC_AUTH_TOKEN_FILE must be an absolute path",
    );
  }
  return path;
};

const readExistingBoxExecAuthToken = async (path: string): Promise<string> => {
  if (!isAbsolute(path)) throw new BoxExecAuthTokenError("Box auth token path must be absolute");
  const metadata = await lstat(path);
  if (!metadata.isFile() || metadata.isSymbolicLink() || (metadata.mode & 0o077) !== 0) {
    throw new BoxExecAuthTokenError(
      "Box auth token must be a private regular file",
    );
  }
  const token = (await readFile(path, "utf8")).trim();
  if (!BOX_EXEC_OWNER_TOKEN_PATTERN.test(token) || token.length < 32) {
    throw new BoxExecAuthTokenError("Box auth token is malformed");
  }
  return token;
};

export const loadOrCreateBoxExecAuthToken = async (
  path = configuredBoxExecAuthTokenPath(),
): Promise<string> => {
  try {
    return await readExistingBoxExecAuthToken(path);
  } catch (error) {
    if (!(Predicate.hasProperty(error, "code") && error.code === "ENOENT")) {
      if (error instanceof BoxExecAuthTokenError) throw error;
      throw new BoxExecAuthTokenError("Box auth token could not be loaded", { cause: error });
    }
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("base64url");
  try {
    await writeFile(path, `${token}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await chmod(path, 0o600);
    return token;
  } catch (error) {
    throw new BoxExecAuthTokenError("Box auth token could not be created", { cause: error });
  }
};

export const readBoxExecAuthToken = async (
  path = configuredBoxExecAuthTokenPath(),
): Promise<string> => {
  if (!isAbsolute(path)) {
    throw new BoxExecAuthTokenError("Box auth token path must be absolute");
  }
  try {
    return await readExistingBoxExecAuthToken(path);
  } catch (error) {
    if (error instanceof BoxExecAuthTokenError) throw error;
    throw new BoxExecAuthTokenError("Box auth token could not be loaded", {
      cause: error,
    });
  }
};

const authInterceptor = (expectedToken: string): Interceptor =>
  (next) => async (request) => {
    const provided = bearerToken(request.header.get("authorization"));
    if (provided === undefined || !tokenMatches(provided, expectedToken)) {
      throw new ConnectError("Authentication failed", Code.Unauthenticated);
    }
    return next(request);
  };

const forkIdentity = (
  context: HandlerContext,
) => {
  const displayText = context.requestHeader.get(BOX_EXEC_DISPLAY_HEADER);
  const ownerToken = context.requestHeader.get(BOX_EXEC_OWNER_HEADER);
  if (displayText === null || ownerToken === null || !/^[0-9]+$/u.test(displayText)) {
    throw new ConnectError("Computer Use window identity is required", Code.PermissionDenied);
  }
  const displayIndex = Number(displayText);
  if (
    !Number.isInteger(displayIndex)
    || displayIndex < 2
    || displayIndex > 100
    || !BOX_EXEC_OWNER_TOKEN_PATTERN.test(ownerToken)
  ) {
    throw new ConnectError("Computer Use window identity is invalid", Code.PermissionDenied);
  }
  return { displayIndex, ownerToken };
};

const listen = (
  server: Server,
  host: string,
  port: number,
): Promise<void> => new Promise((resolve, reject) => {
  const onError = (error: Error) => {
    server.off("listening", onListening);
    reject(error);
  };
  const onListening = () => {
    server.off("error", onError);
    resolve();
  };
  server.once("error", onError);
  server.once("listening", onListening);
  server.listen(port, host);
});

const close = (server: Server): Promise<void> => new Promise((resolve, reject) => {
  server.close((error) => error === undefined ? resolve() : reject(error));
});

export interface ComputerUseBoxServiceOptions {
  readonly authToken?: string;
  readonly host?: string;
  readonly primaryPort?: number;
  readonly forkPort?: number;
  readonly desktopManager?: ComputerUseDesktopManager;
  readonly controlledExecManager?: SimpleControlledExecManager;
}

export class ComputerUseBoxService {
  private readonly host: string;
  private readonly primaryPort: number;
  private readonly forkPort: number;
  private readonly desktopManager: ComputerUseDesktopManager;
  private readonly controlledExecManager: SimpleControlledExecManager;
  private primaryServer: Server | undefined;
  private forkServer: Server | undefined;

  constructor(private readonly options: ComputerUseBoxServiceOptions = {}) {
    this.host = options.host ?? "127.0.0.1";
    this.primaryPort = options.primaryPort ?? BOX_EXEC_PRIMARY_PORT;
    this.forkPort = options.forkPort ?? BOX_EXEC_FORK_ROUTER_PORT;
    this.desktopManager = options.desktopManager ?? new ComputerUseDesktopManager(
      new FileComputerUseAssignmentStore(),
      new SystemdComputerUseWindowSupervisor(),
    );
    if (options.controlledExecManager !== undefined) {
      this.controlledExecManager = options.controlledExecManager;
    } else {
      const manager = new SimpleControlledExecManager();
      computerUseExecutorResource.registerControlledImplementation(
        new GovernedComputerUseExecutor(
          new NativeComputerUseExecutor(),
          undefined,
          {
            record: (event) => console.log(JSON.stringify({
              event: "computer_use_action",
              ...event,
            })),
          },
        ),
        manager,
      );
      this.controlledExecManager = manager;
    }
  }

  async start(): Promise<void> {
    if (this.primaryServer !== undefined || this.forkServer !== undefined) {
      throw new Error("Computer Use box service is already running");
    }
    const authToken = this.options.authToken ?? await loadOrCreateBoxExecAuthToken();
    if (!BOX_EXEC_OWNER_TOKEN_PATTERN.test(authToken) || authToken.length < 32) {
      throw new BoxExecAuthTokenError("Box auth token is malformed");
    }
    await this.desktopManager.restoreAssignments();
    const commonOptions = {
      interceptors: [authInterceptor(authToken)] as Interceptor[],
      readMaxBytes: BOX_EXEC_MAX_MESSAGE_BYTES,
      writeMaxBytes: BOX_EXEC_MAX_MESSAGE_BYTES,
      grpc: false,
      grpcWeb: false,
    };
    const primaryHandler = connectNodeAdapter({
      ...commonOptions,
      routes: (router) => {
        router.service(ComputerUseWindowService, {
          ensureComputerUseWindow: async (request) => {
            const assignment = await this.desktopManager.ensureAssignment(request.agentId);
            return create(EnsureComputerUseWindowResponseSchema, {
              window: create(ComputerUseWindowSchema, assignment),
            });
          },
          releaseComputerUseWindow: async (request) => {
            try {
              await this.desktopManager.releaseOwnedAssignment(
                request.agentId,
                request.ownerToken,
              );
            } catch (error) {
              if (error instanceof ComputerUseDesktopOwnershipError) {
                throw new ConnectError("Computer Use window ownership does not match", Code.PermissionDenied);
              }
              throw error;
            }
            return create(ReleaseComputerUseWindowResponseSchema);
          },
        });
        router.service(ExecService, {
          exec: async function* () {
            throw new ConnectError(
              "The primary desktop is reserved for observation",
              Code.PermissionDenied,
            );
          },
        });
      },
      fallback: (request, response) => {
        if (request.method === "GET" && request.url === "/healthz") {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(
            '{"ok":true,"computerUseSupported":true,"resource":"computerUse"}\n',
          );
          return;
        }
        response.writeHead(404);
        response.end();
      },
    });
    const desktopManager = this.desktopManager;
    const controlledExecManager = this.controlledExecManager;
    const forkHandler = connectNodeAdapter({
      ...commonOptions,
      routes: (router) => {
        router.service(ExecService, {
          exec: async function* (request, context) {
            const identity = forkIdentity(context);
            try {
              await desktopManager.assertOwnership(
                identity.displayIndex,
                identity.ownerToken,
              );
            } catch (error) {
              if (error instanceof ComputerUseDesktopOwnershipError) {
                throw new ConnectError(
                  "Computer Use window ownership does not match",
                  Code.PermissionDenied,
                );
              }
              throw error;
            }
            yield* controlledExecManager.handle(request, {
              signal: context.signal,
              displayIndex: identity.displayIndex,
            });
          },
        });
      },
    });
    const primaryServer = createServer(primaryHandler);
    const forkServer = createServer(forkHandler);
    primaryServer.requestTimeout = 35_000;
    forkServer.requestTimeout = 35_000;
    this.primaryServer = primaryServer;
    this.forkServer = forkServer;
    try {
      await Promise.all([
        listen(primaryServer, this.host, this.primaryPort),
        listen(forkServer, this.host, this.forkPort),
      ]);
    } catch (error) {
      await Promise.allSettled([close(primaryServer), close(forkServer)]);
      this.primaryServer = undefined;
      this.forkServer = undefined;
      throw error;
    }
  }

  async stop(): Promise<void> {
    const servers = [this.primaryServer, this.forkServer].filter(
      (server): server is Server => server !== undefined,
    );
    this.primaryServer = undefined;
    this.forkServer = undefined;
    await Promise.all(servers.map(close));
  }

  addresses() {
    const primary = this.primaryServer?.address();
    const fork = this.forkServer?.address();
    if (primary === undefined || primary === null || typeof primary === "string"
      || fork === undefined || fork === null || typeof fork === "string") {
      throw new Error("Computer Use box service is not listening");
    }
    return {
      primaryPort: (primary as AddressInfo).port,
      forkPort: (fork as AddressInfo).port,
    };
  }
}

const main = async (): Promise<void> => {
  const service = new ComputerUseBoxService();
  await service.start();
  const shutdown = async () => {
    await service.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
};

if (import.meta.main) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Computer Use box service failed");
    process.exit(1);
  });
}
