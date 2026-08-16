import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

export type AcpJsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
};

/**
 * Minimal newline-delimited JSON-RPC transport shared by ACP-backed provider
 * runners. Provider-specific lifecycle and event normalization stay in the
 * runner while process framing, request correlation, and server callbacks do
 * not get duplicated.
 */
export class AcpJsonRpcConnection {
  private nextId = 0;
  private buffer = "";
  private readonly pending = new Map<
    number | string,
    {
      resolve: (message: AcpJsonRpcMessage) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly child: ChildProcessWithoutNullStreams;
  private closed = false;
  private onNotification:
    | ((message: AcpJsonRpcMessage) => void | Promise<void>)
    | undefined;
  private onServerRequest:
    | ((message: AcpJsonRpcMessage) => void | Promise<void>)
    | undefined;

  constructor(input: {
    providerName: string;
    command: string;
    arguments: string[];
    cwd: string;
    environment: NodeJS.ProcessEnv;
  }) {
    this.child = spawn(input.command, input.arguments, {
      cwd: input.cwd,
      env: input.environment,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child.stdout.setEncoding("utf8");
    this.child.stderr.setEncoding("utf8");
    this.child.stdout.on("data", (chunk: string) => this.onStdout(chunk));
    this.child.stderr.on("data", () => {
      // Providers may log diagnostics to stderr; surface only on hard failure.
    });
    this.child.on("error", (error) => {
      this.failAll(error);
    });
    this.child.on("close", (code) => {
      this.closed = true;
      this.failAll(
        new Error(
          code === 0 || code === null
            ? `${input.providerName} ACP process closed unexpectedly.`
            : `${input.providerName} ACP process exited with code ${code}.`,
        ),
      );
    });
  }

  setHandlers(input: {
    onNotification?: (message: AcpJsonRpcMessage) => void | Promise<void>;
    onServerRequest?: (message: AcpJsonRpcMessage) => void | Promise<void>;
  }) {
    this.onNotification = input.onNotification;
    this.onServerRequest = input.onServerRequest;
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) throw new Error("ACP process is not running.");
    const id = ++this.nextId;
    const payload: AcpJsonRpcMessage = {
      jsonrpc: "2.0",
      id,
      method,
      ...(params === undefined ? {} : { params }),
    };
    const response = await new Promise<AcpJsonRpcMessage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (error) {
          this.pending.delete(id);
          reject(error);
        }
      });
    });
    if (response.error) {
      throw new Error(response.error.message || `ACP ${method} failed.`);
    }
    return response.result;
  }

  respond(id: number | string, result: unknown) {
    if (this.closed) return;
    this.child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", id, result })}\n`,
    );
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.child.kill();
  }

  private onStdout(chunk: string) {
    this.buffer += chunk;
    let index = this.buffer.indexOf("\n");
    while (index >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (line) this.handleLine(line);
      index = this.buffer.indexOf("\n");
    }
  }

  private handleLine(line: string) {
    let message: AcpJsonRpcMessage;
    try {
      message = JSON.parse(line) as AcpJsonRpcMessage;
    } catch {
      return;
    }

    if (message.id !== undefined && message.id !== null && !message.method) {
      const pending = this.pending.get(message.id);
      if (pending) {
        this.pending.delete(message.id);
        pending.resolve(message);
      }
      return;
    }

    if (message.method && message.id !== undefined && message.id !== null) {
      void this.onServerRequest?.(message);
      return;
    }

    if (message.method) void this.onNotification?.(message);
  }

  private failAll(error: Error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
