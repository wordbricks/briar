import { create } from "@bufbuild/protobuf";
import {
  GetMemoryVaultContextResponseSchema,
  MemoryVaultJournalResponseSchema,
  MemoryVaultListResponseSchema,
  MemoryVaultReadResponseSchema,
  MemoryVaultSaveResponseSchema,
  MemoryVaultSearchResponseSchema,
  type GetMemoryVaultContextRequest,
  type MemoryVaultClaim as MemoryVaultClaimMessage,
  type MemoryVaultJournalRequest,
  type MemoryVaultListRequest,
  type MemoryVaultReadRequest,
  type MemoryVaultSaveRequest,
  type MemoryVaultSearchRequest,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { MemoryVaultError } from "./memory-vault/errors";
import { memoryVaultStoreFromEnv } from "./memory-vault/artifacts-git-store";
import type { VaultGitStore } from "./memory-vault/git-store";
import {
  getMemoryVaultContext,
  memoryVaultJournal,
  memoryVaultList,
  memoryVaultRead,
  memoryVaultSave,
  memoryVaultSearch,
  type MemoryVaultCaller,
  type MemoryVaultDeps,
  type MemoryVaultRecordSummary,
} from "./memory-vault/operations";
import type { MemoryVaultWorkKind } from "./memory-vault/scope";
import type { AuthenticatedWorkerTeam, requireWorkerProjectBinding } from "./worker-route-auth";

/**
 * Connect handlers for the memory vault tools. Requests are rebuilt into plain
 * objects field by field; protobuf messages never reach domain code.
 */
export type MemoryVaultConnectInput = {
  readonly request: Request;
  readonly db: D1Database;
  readonly env: Env;
};

export type MemoryVaultConnectServices = {
  readonly requireWorkerProjectBinding: typeof requireWorkerProjectBinding;
  readonly memoryVaultStore: (env: Env) => VaultGitStore | null;
};

export const memoryVaultConnectServices: Pick<MemoryVaultConnectServices, "memoryVaultStore"> = {
  memoryVaultStore: memoryVaultStoreFromEnv,
};

/** The claim kinds a vault serves; merge batches and memory learning have none. */
const vaultWorkKind = (value: string | undefined): MemoryVaultWorkKind | null =>
  value === "issue" || value === "issueReply" || value === "channelReply" || value === "projectAgentTask"
    ? value
    : null;

async function caller(
  input: MemoryVaultConnectInput,
  claim: MemoryVaultClaimMessage | undefined,
  services: MemoryVaultConnectServices,
): Promise<MemoryVaultCaller> {
  const work = claim?.work;
  const kind = vaultWorkKind(work?.work.case);
  if (!claim || !work || !kind || !work.workId || !work.runId || !work.claimToken) {
    // The CLI treats this like a claim that ended: no memory for the rest of the run.
    throw new MemoryVaultError("claim_inactive", "Memory tools require an active issue, reply or Agent task claim");
  }
  const worker: AuthenticatedWorkerTeam = await services.requireWorkerProjectBinding(
    input.db,
    input.request,
    claim.projectId,
    claim.workerId,
  );
  return {
    claim: {
      kind,
      workId: work.workId,
      runId: work.runId,
      claimToken: work.claimToken,
      workspaceId: work.work.case === "channelReply" ? work.work.value.workspaceId : null,
    },
    worker: {
      workspaceId: worker.principal.workspaceId,
      deviceId: worker.principal.deviceId,
      workerId: worker.binding.id,
      projectId: claim.projectId,
    },
  };
}

const deps = (input: MemoryVaultConnectInput, services: MemoryVaultConnectServices): MemoryVaultDeps => ({
  db: input.db,
  env: input.env,
  store: services.memoryVaultStore(input.env),
});

const summaryMessage = (record: MemoryVaultRecordSummary) => ({
  id: record.id,
  type: record.type,
  path: record.path,
  status: record.status ?? undefined,
  aliases: [...record.aliases],
  revision: record.revision,
  updatedAt: record.updatedAt ?? undefined,
  protectedByUser: record.protectedByUser,
});

export async function memoryVaultListRpc(input: MemoryVaultConnectInput, request: MemoryVaultListRequest,
  services: MemoryVaultConnectServices) {
  const result = await memoryVaultList(deps(input, services), await caller(input, request.claim, services), {
    type: request.type ?? null,
    prefix: request.prefix ?? null,
    status: request.status ?? null,
    cursor: request.cursor ?? null,
    limit: request.limit ?? null,
  });
  return create(MemoryVaultListResponseSchema, {
    records: result.records.map(summaryMessage),
    nextCursor: result.nextCursor ?? undefined,
  });
}

export async function memoryVaultReadRpc(input: MemoryVaultConnectInput, request: MemoryVaultReadRequest,
  services: MemoryVaultConnectServices) {
  const result = await memoryVaultRead(deps(input, services), await caller(input, request.claim, services), {
    target: request.target,
    revision: request.revision ?? null,
  });
  return create(MemoryVaultReadResponseSchema, {
    record: summaryMessage(result),
    createdAt: result.createdAt ?? undefined,
    body: result.body,
    latest: result.latest,
    commit: result.commit ?? undefined,
  });
}

export async function memoryVaultSearchRpc(input: MemoryVaultConnectInput, request: MemoryVaultSearchRequest,
  services: MemoryVaultConnectServices) {
  const result = await memoryVaultSearch(deps(input, services), await caller(input, request.claim, services), {
    text: request.text,
    type: request.type ?? null,
    prefix: request.prefix ?? null,
    cursor: request.cursor ?? null,
    limit: request.limit ?? null,
  });
  return create(MemoryVaultSearchResponseSchema, {
    hits: result.hits.map((hit) => ({
      id: hit.id,
      type: hit.type,
      path: hit.path,
      revision: hit.revision,
      line: hit.line,
      snippet: hit.snippet,
    })),
    nextCursor: result.nextCursor ?? undefined,
    commit: result.commit ?? undefined,
  });
}

export async function memoryVaultJournalRpc(input: MemoryVaultConnectInput, request: MemoryVaultJournalRequest,
  services: MemoryVaultConnectServices) {
  const result = await memoryVaultJournal(deps(input, services), await caller(input, request.claim, services), {
    requestId: request.requestId,
    text: request.text,
    occurredAt: request.occurredAt ?? null,
    references: [...request.references],
    userRequested: request.userRequested,
  });
  return create(MemoryVaultJournalResponseSchema, {
    id: result.id,
    path: result.path,
    line: result.line,
    revision: result.revision,
    commit: result.commit,
    deduplicated: result.deduplicated,
    replayed: result.replayed,
  });
}

export async function memoryVaultSaveRpc(input: MemoryVaultConnectInput, request: MemoryVaultSaveRequest,
  services: MemoryVaultConnectServices) {
  const result = await memoryVaultSave(deps(input, services), await caller(input, request.claim, services), {
    requestId: request.requestId,
    id: request.id,
    type: request.type,
    status: request.status ?? null,
    aliases: [...request.aliases],
    expectedRevision: request.expectedRevision ?? null,
    userRequested: request.userRequested,
    content: request.content,
  });
  return create(MemoryVaultSaveResponseSchema, {
    id: result.id,
    type: result.type,
    path: result.path,
    revision: result.revision,
    commit: result.commit,
    droppedLines: [...result.droppedLines],
    replayed: result.replayed,
  });
}

export async function getMemoryVaultContextRpc(input: MemoryVaultConnectInput, request: GetMemoryVaultContextRequest,
  services: MemoryVaultConnectServices) {
  const result = await getMemoryVaultContext(deps(input, services), await caller(input, request.claim, services), {
    knownContextKey: request.knownContextKey ?? null,
  });
  switch (result.kind) {
    case "none":
      return create(GetMemoryVaultContextResponseSchema, { state: { case: "none", value: {} } });
    case "unchanged":
      return create(GetMemoryVaultContextResponseSchema, {
        state: { case: "unchanged", value: { contextKey: result.contextKey } },
      });
    case "context":
      return create(GetMemoryVaultContextResponseSchema, {
        state: {
          case: "context",
          value: {
            contextKey: result.contextKey,
            head: result.head ?? undefined,
            scopeKind: result.scopeKind,
            readme: result.readme,
            status: result.status,
            voice: result.voice,
            voiceGuide: result.voiceGuide,
            playbook: result.playbook,
            readable: result.readable,
            writable: result.writable,
            userRequestedWritable: result.userRequestedWritable,
          },
        },
      });
  }
}
