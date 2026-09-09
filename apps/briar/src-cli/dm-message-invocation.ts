import { agentProviders } from "../src/lib/agent-provider";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, mkdtemp, open, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { sizeDelimitedDecodeStream, sizeDelimitedEncode } from "@bufbuild/protobuf/wire";
import { Code, ConnectError } from "@connectrpc/connect";
import { DmMessagePurpose } from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  DmMessagePublicationErrorCode,
  DmMessagePublicationErrorSchema,
  DmMessagePublicationBindingSchema,
  DmMessagePublicationReceiptSchema,
  DmMessagePublicationRequestSchema,
  DmMessagePublicationResponseSchema,
  type DmMessagePublicationBinding,
  type DmMessagePublicationRequest,
  type DmMessagePublicationResponse,
} from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import {
  DmMessagePublicationKind,
  DmPublicMessagePartSchema,
  PublishDmMessageBatchRequestSchema,
  type PublishDmMessageBatchRequest,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { AgentProvider } from "../src/lib/agent-provider";
import { workClaimIdentityToProto, type WorkerQueueClient } from "./worker-queue-client";
import type { ClaimedChannelReply } from "./worker-queue-contract";

const operationKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const clientIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u;
const maximumFrameBytes = 128 * 1024;
const bindingLifetimeMs = 30 * 60_000;
const journalLifetimeMs = 24 * 60 * 60_000;
const finalOperationKey = "\u0000final";

type PublicationPart = {
  readonly clientId: string;
  readonly body: string;
  readonly purpose: DmMessagePurpose;
};

export type DmMessagePublicationReceipt = {
  readonly batchId: string;
  readonly messageIds: readonly string[];
  readonly firstSequence: bigint;
  readonly lastSequence: bigint;
  readonly replayed: boolean;
};

type StoredReceipt = {
  readonly batchId: string;
  readonly messageIds: readonly string[];
  readonly firstSequence: string;
  readonly lastSequence: string;
};

type JournalEntry = {
  readonly requestId: string;
  readonly payloadHash: string;
  readonly inputRevision: number;
  readonly preparedRequest?: string;
  readonly receipt?: StoredReceipt;
};

type Journal = {
  readonly version: 1;
  readonly workId: string;
  readonly expiresAt: number;
  readonly entries: Readonly<Record<string, JournalEntry>>;
};

type Owner = {
  readonly invocationId: string;
  readonly pid: number;
  readonly expiresAt: number;
};

export type DmMessageInvocationInput = {
  readonly queue: Pick<WorkerQueueClient, "publishDmMessageBatch"> & Partial<Pick<WorkerQueueClient, "executeDmScheduleTool">>;
  readonly projectId: string;
  readonly workerId: string;
  readonly work: ClaimedChannelReply;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
};

export const supportsDmMessagePublicationProvider = (
  provider: AgentProvider,
): boolean => agentProviders.includes(provider);

const journalRoot = () => join("/tmp", "briar-dm-publication-journals");
const journalDirectory = (workId: string) => join(
  journalRoot(),
  createHash("sha256").update(workId).digest("hex").slice(0, 32),
);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const decodeOwner = (value: unknown): Owner => {
  if (!isRecord(value) || typeof value.invocationId !== "string" ||
      !Number.isInteger(value.pid) || Number(value.pid) < 1 ||
      typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt)) {
    throw new Error("publication_journal_owner_invalid");
  }
  return {
    invocationId: value.invocationId,
    pid: Number(value.pid),
    expiresAt: value.expiresAt,
  };
};

const decodeJournal = (value: unknown): Journal => {
  if (!isRecord(value) || value.version !== 1 || typeof value.workId !== "string" ||
      typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt) ||
      !isRecord(value.entries)) throw new Error("publication_journal_invalid");
  const entries: Record<string, JournalEntry> = {};
  for (const [key, raw] of Object.entries(value.entries)) {
    if (!isRecord(raw) || typeof raw.requestId !== "string" ||
        typeof raw.payloadHash !== "string" || !Number.isSafeInteger(raw.inputRevision)) {
      throw new Error("publication_journal_invalid");
    }
    let receipt: StoredReceipt | undefined;
    if (raw.receipt !== undefined) {
      if (!isRecord(raw.receipt) || typeof raw.receipt.batchId !== "string" ||
          !Array.isArray(raw.receipt.messageIds) ||
          !raw.receipt.messageIds.every((id) => typeof id === "string") ||
          typeof raw.receipt.firstSequence !== "string" ||
          typeof raw.receipt.lastSequence !== "string") {
        throw new Error("publication_journal_invalid");
      }
      receipt = {
        batchId: raw.receipt.batchId,
        messageIds: raw.receipt.messageIds as string[],
        firstSequence: raw.receipt.firstSequence,
        lastSequence: raw.receipt.lastSequence,
      };
    }
    entries[key] = {
      requestId: raw.requestId,
      payloadHash: raw.payloadHash,
      inputRevision: Number(raw.inputRevision),
      ...(typeof raw.preparedRequest === "string"
        ? { preparedRequest: raw.preparedRequest }
        : {}),
      ...(receipt ? { receipt } : {}),
    };
  }
  return { version: 1, workId: value.workId, expiresAt: value.expiresAt, entries };
};

const validPurpose = (purpose: DmMessagePurpose) =>
  purpose === DmMessagePurpose.ACKNOWLEDGEMENT ||
  purpose === DmMessagePurpose.PROGRESS ||
  purpose === DmMessagePurpose.DISCOVERY ||
  purpose === DmMessagePurpose.QUESTION ||
  purpose === DmMessagePurpose.RESULT ||
  purpose === DmMessagePurpose.CONVERSATION;

const validateParts = (
  parts: readonly PublicationPart[],
): PublicationPart[] => {
  if (parts.length < 1 || parts.length > 8) {
    throw new Error("publication_request_invalid");
  }
  return parts.map((part) => {
    const body = part.body.trim();
    if (!clientIdPattern.test(part.clientId) || body.length < 1 ||
        body.length > 10_000 || !validPurpose(part.purpose)) {
      throw new Error("publication_request_invalid");
    }
    return { ...part, body };
  });
};

const payloadHash = (
  operationKey: string,
  kind: DmMessagePublicationKind,
  parts: readonly PublicationPart[],
) => createHash("sha256").update(JSON.stringify({
  operationKey,
  kind,
  parts: parts.map(({ clientId, body, purpose }) => ({ clientId, body, purpose })),
})).digest("hex");

const retryableCodes = new Set([
  Code.DeadlineExceeded,
  Code.ResourceExhausted,
  Code.Internal,
  Code.Unavailable,
]);
const isRetryable = (error: unknown) =>
  !(error instanceof ConnectError) || retryableCodes.has(error.code);

const publicationErrorCode = (reason: string) => {
  switch (reason) {
    case "request_conflict":
    case "revision_conflict":
      return DmMessagePublicationErrorCode.REQUEST_CONFLICT;
    case "publication_capability_invalid":
      return DmMessagePublicationErrorCode.CAPABILITY_INVALID;
    case "publication_invocation_closed":
      return DmMessagePublicationErrorCode.INVOCATION_CLOSED;
    case "publication_request_invalid":
      return DmMessagePublicationErrorCode.INVALID_REQUEST;
    case "publication_unknown":
      return DmMessagePublicationErrorCode.PUBLICATION_UNKNOWN;
    default:
      return DmMessagePublicationErrorCode.PUBLICATION_FAILED;
  }
};

export class DmMessageInvocation {
  private readonly entries = new Map<string, JournalEntry>();
  private readonly published = new Map<string, DmMessagePublicationReceipt>();
  private readonly capability = randomBytes(32);
  private readonly invocationId: string;
  private readonly expiresAt: Date;
  private readonly inputRevision: number;
  private readonly durableDirectory: string;
  private readonly server: Server;
  private readonly sockets = new Set<Socket>();
  private readonly socketTasks = new Set<Promise<void>>();
  private readonly operationAbort = new AbortController();
  private invocationDirectory = "";
  private socketPath = "";
  private closed = false;
  private ownsJournal = false;
  private mutation: Promise<void> = Promise.resolve();
  private serverStopped: Promise<void> | undefined;
  private shutdown: Promise<void> | undefined;

  private constructor(private readonly input: DmMessageInvocationInput) {
    const revision = Number(input.work.inputRevision);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error("publication_claim_unsupported");
    }
    this.inputRevision = revision;
    this.invocationId = (input.randomUUID ?? randomUUID)();
    this.expiresAt = new Date((input.now ?? Date.now)() + bindingLifetimeMs);
    this.durableDirectory = journalDirectory(input.work.workId);
    this.server = createServer({ allowHalfOpen: true }, (socket) => {
      this.sockets.add(socket);
      const task = this.handleSocket(socket);
      this.socketTasks.add(task);
      void task.finally(() => this.socketTasks.delete(task));
    });
    for (const batch of input.work.publishedMessageBatches) {
      this.published.set(batch.batchId, {
        batchId: batch.batchId,
        messageIds: [...batch.messageIds],
        firstSequence: batch.firstSequence,
        lastSequence: batch.lastSequence,
        replayed: true,
      });
    }
  }

  static async create(input: DmMessageInvocationInput) {
    const invocation = new DmMessageInvocation(input);
    try {
      await invocation.start();
      return invocation;
    } catch (error) {
      await invocation.cleanup().catch(() => undefined);
      throw error;
    }
  }

  private now() { return (this.input.now ?? Date.now)(); }

  private async claimJournalOwnership() {
    await mkdir(journalRoot(), { recursive: true, mode: 0o700 });
    await chmod(journalRoot(), 0o700);
    await mkdir(this.durableDirectory, { recursive: true, mode: 0o700 });
    await chmod(this.durableDirectory, 0o700);
    const ownerPath = join(this.durableDirectory, "owner.json");
    const owner = {
      invocationId: this.invocationId,
      pid: process.pid,
      expiresAt: this.expiresAt.getTime(),
    };
    for (;;) {
      try {
        const file = await open(ownerPath, "wx", 0o600);
        try { await file.writeFile(`${JSON.stringify(owner)}\n`, "utf8"); }
        finally { await file.close(); }
        this.ownsJournal = true;
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      const previous = decodeOwner(JSON.parse(await readFile(ownerPath, "utf8")));
      let alive = previous.expiresAt > this.now();
      if (alive) {
        try { process.kill(previous.pid, 0); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ESRCH") alive = false;
        }
      }
      if (alive) throw new Error("publication_invocation_active");
      await unlink(ownerPath).catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      });
    }
  }

  private async start() {
    await this.claimJournalOwnership();
    const journalPath = join(this.durableDirectory, "journal.json");
    try {
      const restored = decodeJournal(JSON.parse(await readFile(journalPath, "utf8")));
      if (restored.workId !== this.input.work.workId) {
        throw new Error("publication_journal_scope_mismatch");
      }
      if (restored.expiresAt > this.now()) {
        for (const [key, entry] of Object.entries(restored.entries)) {
          this.entries.set(key, entry);
          if (entry.receipt) this.published.set(entry.receipt.batchId, this.storedReceipt(entry.receipt));
        }
      } else {
        await rm(journalPath, { force: true });
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await this.writeJournal();
    this.invocationDirectory = await mkdtemp(join("/tmp", "briar-dm-pub-"));
    await chmod(this.invocationDirectory, 0o700);
    this.socketPath = join(this.invocationDirectory, "relay.sock");
    await new Promise<void>((resolve, reject) => {
      this.server.once("error", reject);
      this.server.listen(this.socketPath, resolve);
    });
    await chmod(this.socketPath, 0o600);
    this.input.signal?.addEventListener("abort", () => void this.cleanup(), { once: true });
  }

  private async releaseJournalOwnership() {
    if (!this.ownsJournal) return;
    const ownerPath = join(this.durableDirectory, "owner.json");
    try {
      const owner = decodeOwner(JSON.parse(await readFile(ownerPath, "utf8")));
      if (owner.invocationId === this.invocationId) await rm(ownerPath, { force: true });
    } catch {
      // Preserve an invalid owner so later attempts fail closed.
    } finally {
      this.ownsJournal = false;
    }
  }

  private async writeJournal() {
    const journal: Journal = {
      version: 1,
      workId: this.input.work.workId,
      expiresAt: this.now() + journalLifetimeMs,
      entries: Object.fromEntries(this.entries),
    };
    const temporary = join(
      this.durableDirectory,
      `journal-${this.invocationId}-${randomUUID()}.tmp`,
    );
    await writeFile(temporary, `${JSON.stringify(journal)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, join(this.durableDirectory, "journal.json"));
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private authorize(request: DmMessagePublicationRequest) {
    if (this.closed || this.input.signal?.aborted) {
      throw new Error("publication_invocation_closed");
    }
    if (this.now() >= this.expiresAt.getTime()) {
      throw new Error("publication_capability_invalid");
    }
    if (request.invocationId !== this.invocationId ||
        request.capability.byteLength !== this.capability.byteLength ||
        !timingSafeEqual(request.capability, this.capability)) {
      throw new Error("publication_capability_invalid");
    }
  }

  private storedReceipt(receipt: StoredReceipt): DmMessagePublicationReceipt {
    return {
      batchId: receipt.batchId,
      messageIds: [...receipt.messageIds],
      firstSequence: BigInt(receipt.firstSequence),
      lastSequence: BigInt(receipt.lastSequence),
      replayed: true,
    };
  }

  private async callPublish(
    request: PublishDmMessageBatchRequest,
    expectedParts: number,
    signal: AbortSignal,
  ): Promise<DmMessagePublicationReceipt> {
    let attempted = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        attempted = true;
        const response = await this.input.queue.publishDmMessageBatch(request, { signal });
        if (!response.batchId || response.messageIds.length !== expectedParts ||
            response.firstSequence < 1n || response.lastSequence < response.firstSequence) {
          throw new Error("publication_failed");
        }
        return {
          batchId: response.batchId,
          messageIds: [...response.messageIds],
          firstSequence: response.firstSequence,
          lastSequence: response.lastSequence,
          replayed: response.replayed,
        };
      } catch (error) {
        if (signal.aborted || !isRetryable(error)) throw error;
        if (attempt === 2) break;
      }
    }
    throw new Error(attempted ? "publication_unknown" : "publication_failed");
  }

  private async publish(
    operationKey: string,
    kind: DmMessagePublicationKind,
    rawParts: readonly PublicationPart[],
    signal: AbortSignal,
  ) {
    if ((kind === DmMessagePublicationKind.INTERMEDIATE && !operationKeyPattern.test(operationKey)) ||
        (kind === DmMessagePublicationKind.FINAL && operationKey !== finalOperationKey)) {
      throw new Error("publication_request_invalid");
    }
    const parts = validateParts(rawParts);
    const hash = payloadHash(operationKey, kind, parts);
    let entry = this.entries.get(operationKey);
    if (entry && entry.payloadHash !== hash) throw new Error("request_conflict");
    if (entry && entry.inputRevision !== this.inputRevision) throw new Error("revision_conflict");
    if (entry?.receipt) return this.storedReceipt(entry.receipt);
    if (!entry) {
      entry = {
        requestId: (this.input.randomUUID ?? randomUUID)(),
        payloadHash: hash,
        inputRevision: this.inputRevision,
      };
      this.entries.set(operationKey, entry);
      await this.writeJournal();
    }
    let request: PublishDmMessageBatchRequest;
    if (entry.preparedRequest) {
      request = fromBinary(
        PublishDmMessageBatchRequestSchema,
        Buffer.from(entry.preparedRequest, "base64"),
      );
    } else {
      request = create(PublishDmMessageBatchRequestSchema, {
        requestId: entry.requestId,
        projectId: this.input.projectId,
        workerId: this.input.workerId,
        work: workClaimIdentityToProto(this.input.work),
        expectedInputRevision: BigInt(this.inputRevision),
        publicationKind: kind,
        parts: parts.map((part) => create(DmPublicMessagePartSchema, {
          body: part.body,
          purpose: part.purpose,
        })),
      });
      entry = {
        ...entry,
        preparedRequest: Buffer.from(
          toBinary(PublishDmMessageBatchRequestSchema, request),
        ).toString("base64"),
      };
      this.entries.set(operationKey, entry);
      await this.writeJournal();
    }
    const receipt = await this.callPublish(request, parts.length, signal);
    const stored: StoredReceipt = {
      batchId: receipt.batchId,
      messageIds: [...receipt.messageIds],
      firstSequence: receipt.firstSequence.toString(),
      lastSequence: receipt.lastSequence.toString(),
    };
    this.entries.set(operationKey, { ...entry, receipt: stored });
    this.published.set(receipt.batchId, receipt);
    await this.writeJournal();
    return receipt;
  }

  async publishFinal(body: string, signal: AbortSignal) {
    const existing = [...this.input.work.publishedMessageBatches]
      .reverse()
      .find((batch) => batch.publicationKind === DmMessagePublicationKind.FINAL);
    if (existing) return this.published.get(existing.batchId)!;
    return this.serialize(() => this.publish(finalOperationKey, DmMessagePublicationKind.FINAL, [{
      clientId: "final",
      body,
      purpose: DmMessagePurpose.RESULT,
    }], signal));
  }

  private response(receipt: DmMessagePublicationReceipt): DmMessagePublicationResponse {
    return create(DmMessagePublicationResponseSchema, {
      result: { case: "receipt", value: create(DmMessagePublicationReceiptSchema, {
        batchId: receipt.batchId,
        messageIds: [...receipt.messageIds],
        firstSequence: receipt.firstSequence,
        lastSequence: receipt.lastSequence,
        replayed: receipt.replayed,
      }) },
    });
  }

  private errorResponse(reason: string): DmMessagePublicationResponse {
    return create(DmMessagePublicationResponseSchema, {
      result: { case: "error", value: create(DmMessagePublicationErrorSchema, {
        code: publicationErrorCode(reason),
        reason,
      }) },
    });
  }

  private async handleSocket(socket: Socket) {
    const requestAbort = new AbortController();
    let decoded = false;
    let scheduleRequest = false;
    const deadline = setTimeout(() => {
      if (decoded) requestAbort.abort(new Error("publication_deadline"));
      else socket.destroy();
    }, 70_000);
    deadline.unref();
    let response: DmMessagePublicationResponse;
    try {
      const chunks: Buffer[] = [];
      let bytes = 0;
      const frame = await new Promise<Buffer>((resolve, reject) => {
        socket.on("data", (chunk: Buffer) => {
          bytes += chunk.byteLength;
          if (bytes > maximumFrameBytes) {
            socket.destroy();
            reject(new Error("publication_request_invalid"));
          } else chunks.push(chunk);
        });
        socket.once("end", () => resolve(Buffer.concat(chunks, bytes)));
        socket.once("error", reject);
      });
      const source = (async function*() { yield frame; })();
      const iterator = sizeDelimitedDecodeStream(
        DmMessagePublicationRequestSchema,
        source,
        { readMaxBytes: maximumFrameBytes },
      )[Symbol.asyncIterator]();
      const first = await iterator.next();
      if (first.done || !(await iterator.next()).done) {
        throw new Error("publication_request_invalid");
      }
      decoded = true;
      this.authorize(first.value);
      const operationSignal = AbortSignal.any([
        this.operationAbort.signal,
        requestAbort.signal,
        ...(this.input.signal ? [this.input.signal] : []),
      ]);
      if (first.value.schedule) {
        scheduleRequest = true;
        if (!this.scheduleTools() || first.value.parts.length) throw new Error("publication_request_invalid");
        const result = await this.serialize(() => {
          this.authorize(first.value);
          return this.input.queue.executeDmScheduleTool!({
            projectId: this.input.projectId, workerId: this.input.workerId,
            work: workClaimIdentityToProto(this.input.work), operation: first.value.schedule!,
          }, { signal: operationSignal });
        });
        response = create(DmMessagePublicationResponseSchema, { result: { case: "schedule", value: result } });
      } else {
        const parts = first.value.parts.map((part) => ({
          clientId: part.clientId,
          body: part.body,
          purpose: part.purpose,
        }));
        const receipt = await this.serialize(() => {
          this.authorize(first.value);
          return this.publish(
            first.value.operationKey,
            DmMessagePublicationKind.INTERMEDIATE,
            parts,
            operationSignal,
          );
        });
        response = this.response(receipt);
      }
    } catch (error) {
      const rawReason = requestAbort.signal.aborted && decoded
        ? "publication_unknown"
        : error instanceof Error ? error.message : "publication_failed";
      const reason = [
        "request_conflict",
        "revision_conflict",
        "publication_unknown",
        "publication_capability_invalid",
        "publication_invocation_closed",
        "publication_request_invalid",
      ].includes(rawReason) ? rawReason : "publication_failed";
      const scheduleReason = scheduleRequest && error instanceof ConnectError &&
        [Code.InvalidArgument, Code.NotFound, Code.PermissionDenied, Code.FailedPrecondition, Code.Aborted].includes(error.code)
        ? `schedule_request_failed: ${error.rawMessage.slice(0, 300)}` : null;
      response = this.errorResponse(scheduleReason ?? reason);
    } finally {
      clearTimeout(deadline);
      this.sockets.delete(socket);
    }
    if (!socket.destroyed) {
      socket.end(sizeDelimitedEncode(DmMessagePublicationResponseSchema, response));
    }
  }

  private stopServer() {
    if (!this.serverStopped) {
      this.serverStopped = new Promise<void>((resolve) => this.server.close(() => resolve()));
    }
    return this.serverStopped;
  }

  async settle() {
    await this.stopServer();
    await Promise.all([...this.socketTasks]);
    await this.mutation;
    const signal = AbortSignal.any([
      this.operationAbort.signal,
      ...(this.input.signal ? [this.input.signal] : []),
      AbortSignal.timeout(35_000),
    ]);
    await this.serialize(async () => {
      for (const [operationKey, entry] of this.entries) {
        if (!entry.preparedRequest || entry.receipt) continue;
        const request = fromBinary(
          PublishDmMessageBatchRequestSchema,
          Buffer.from(entry.preparedRequest, "base64"),
        );
        const receipt = await this.callPublish(request, request.parts.length, signal);
        const stored: StoredReceipt = {
          batchId: receipt.batchId,
          messageIds: [...receipt.messageIds],
          firstSequence: receipt.firstSequence.toString(),
          lastSequence: receipt.lastSequence.toString(),
        };
        this.entries.set(operationKey, { ...entry, receipt: stored });
        this.published.set(receipt.batchId, receipt);
        await this.writeJournal();
      }
    });
  }

  private scheduleTools() { return Boolean(this.input.queue.executeDmScheduleTool && this.input.work.routing?.action === "new"); }

  binding(): DmMessagePublicationBinding {
    return create(DmMessagePublicationBindingSchema, {
      invocationId: this.invocationId,
      socketPath: this.socketPath,
      capability: this.capability,
      expiresAt: {
        $typeName: "google.protobuf.Timestamp",
        seconds: BigInt(Math.floor(this.expiresAt.getTime() / 1_000)),
        nanos: (this.expiresAt.getTime() % 1_000) * 1_000_000,
      },
      protocol: 1,
      scheduleTools: this.scheduleTools(),
    });
  }

  publishedBatchIds() { return [...this.published.keys()]; }

  prompt() {
    const batches = this.publishedBatchIds();
    return [
      ...(this.scheduleTools() ? ["For an explicit later or repeating request use create_dm_schedule; inspect with list_dm_schedules and cancel by its returned ID with cancel_dm_schedule. Do not merely promise to remember a timer. Relative delays start at the original user message's server receipt time. Use a confirmed IANA time zone for absolute times; ask only if the time zone or target is unclear. For relative delays an unknown display zone can remain UTC. Repeats are fixed whole minutes (minimum five minutes); daily means every 24 hours, not a calendar appointment. Only confirm after a successful server result, include its nextRunDisplay/timeZone, and say execution may be delayed. Every occurrence reports normally. Preserve the requestKey when retrying the same request. A cancel result with stopState=requested means stop requested, not stopped; never claim past external effects were undone. A previousJobId carries result/artifact references into a new execution, not permission to repeat completed side effects."] : []),
      "This direct-message reply supports durable public progress updates through the publish_dm_message command documented below.",
      "Skip a starting update for an immediate answer. For longer work, publish a short concrete update before the first long-running tool call, then publish only when there is a real discovery, changed expectation, or required input.",
      "A successful tool result is the only proof that an update was published. Keep the same operationKey and clientId values when retrying the same ordered batch. Use new values only for a new fact or correction.",
      "Do not repeat published progress in the final reply. Briar publishes the final reply as one durable final batch and completion references that receipt without creating another message.",
      batches.length > 0
        ? `These batches were already published for this reply: ${JSON.stringify(batches)}.`
        : "No durable public batch has been recovered for this reply.",
    ].join("\n\n");
  }

  async cleanup(input: { terminal?: boolean } = {}) {
    if (!this.shutdown) {
      this.closed = true;
      this.operationAbort.abort(new Error("publication_invocation_closed"));
      for (const socket of this.sockets) socket.destroy();
      this.sockets.clear();
      this.shutdown = (async () => {
        await this.stopServer().catch(() => undefined);
        await Promise.all([...this.socketTasks]);
        await this.mutation;
        if (this.invocationDirectory) {
          await rm(this.invocationDirectory, { recursive: true, force: true });
        }
      })();
    }
    await this.shutdown;
    if (input.terminal && this.ownsJournal) {
      await rm(this.durableDirectory, { recursive: true, force: true });
      this.ownsJournal = false;
    } else {
      await this.releaseJournalOwnership();
    }
  }
}
