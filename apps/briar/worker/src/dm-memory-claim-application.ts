import * as Schema from "effect/Schema";
import {
  dmMemoryLookupResponseSchema,
  dmMemoryRequestSchema,
  type DmMemoryLookupResponse,
  type DmMemoryReference,
  type DmMemoryRequest,
} from "../../src/lib/dm-memory-query-contract";
import { getClaimedChannelReply } from "./channels";
import {
  reserveReplyLookup,
  replyLookupCompletionStatement,
} from "./channel-reply-lookup-budget";
import { sha256 } from "./crypto-digest";
import { getDmMemoryBrief } from "./dm-memory-brief";
import {
  dmMemoryClaimAccess,
  dmMemoryDescriptor,
  readDmMemoryClaim,
} from "./dm-memory-claim";
import {
  dmMemoryJsonBytes,
  getDmMemoryReferences,
  searchDmMemory,
} from "./dm-memory-retrieval";
import {
  dmMemoryVectorStore,
  type DmMemoryVectorStore,
} from "./dm-memory-vector-store";
import { HttpError } from "./http-response";

export type DmMemoryClaimScope = {
  readonly jobId: string;
  readonly workerId: string;
  readonly deviceId: string;
  readonly claimToken: string;
  readonly revocationEpoch: number;
};

const discoveredStatements = (
  db: D1Database,
  input: {
    jobId: string;
    claimTokenHash: string;
    spaceId: string;
    revision: number;
    epoch: number;
  },
  references: readonly DmMemoryReference[],
  reservation?: { requestId: string; leaseToken: string },
) => references.map((reference) => db.prepare(`insert into briar_dm_memory_discovered_refs
  (job_id, claim_token_hash, document_id, version)
  select ?, ?, doc.id, doc.current_version from briar_dm_memory_documents doc
  join briar_dm_memory_spaces space on space.id = doc.space_id
  join briar_channel_agent_reply_jobs job on job.id = ? and job.claim_token_hash = ? and job.status = 'running'
  where doc.id = ? and doc.current_version = ? and doc.status = 'active' and doc.space_id = ?
    and space.memory_revision = ? and space.revocation_epoch = ?
    and (? is null or exists (select 1 from briar_channel_reply_lookups lookup
      where lookup.job_id = job.id and lookup.claim_token_hash = job.claim_token_hash
        and lookup.request_id = ? and lookup.lease_token = ? and lookup.response_json is not null))
  on conflict do nothing`).bind(
  input.jobId,
  input.claimTokenHash,
  input.jobId,
  input.claimTokenHash,
  reference.documentId,
  reference.version,
  input.spaceId,
  input.revision,
  input.epoch,
  reservation?.requestId ?? null,
  reservation?.requestId ?? null,
  reservation?.leaseToken ?? null,
));

const activeClaim = async (db: D1Database, scope: DmMemoryClaimScope) => {
  if (!scope.claimToken.startsWith("briar_channel_claim_") || scope.claimToken.length > 200) {
    throw new HttpError(401, "Channel reply claim token required");
  }
  const claimTokenHash = await sha256(scope.claimToken);
  const requireClaim = async () => {
    const job = await getClaimedChannelReply(db, {
      jobId: scope.jobId,
      workerId: scope.workerId,
      deviceId: scope.deviceId,
      claimTokenHash,
      observedAt: new Date().toISOString(),
    });
    if (!job) {
      throw new HttpError(409, "Reply claim is no longer active", "memory_scope_revoked");
    }
    return job;
  };
  const job = await requireClaim();
  const space = await readDmMemoryClaim(db, scope.jobId, claimTokenHash);
  if (space.revocation_epoch !== scope.revocationEpoch) {
    throw new HttpError(409, "Memory context changed", "memory_scope_revoked");
  }
  return { claimTokenHash, job, requireClaim, space };
};

const currentClaim = async (
  db: D1Database,
  input: Awaited<ReturnType<typeof activeClaim>>,
  scope: DmMemoryClaimScope,
) => {
  await input.requireClaim();
  const current = await readDmMemoryClaim(db, scope.jobId, input.claimTokenHash);
  if (current.memory_revision !== input.space.memory_revision) {
    throw new HttpError(409, "Memory changed", "memory_snapshot_changed");
  }
  return current;
};

export async function checkDmMemoryClaim(
  db: D1Database,
  env: Env,
  scope: DmMemoryClaimScope,
) {
  const claim = await activeClaim(db, scope);
  return dmMemoryDescriptor(claim.space, String(env.DM_MEMORY_RETRIEVAL_ENABLED) === "true");
}

export async function getDmMemoryClaimBrief(
  db: D1Database,
  env: Env,
  scope: DmMemoryClaimScope,
) {
  const claim = await activeClaim(db, scope);
  const memory = dmMemoryDescriptor(
    claim.space,
    String(env.DM_MEMORY_RETRIEVAL_ENABLED) === "true",
  );
  const brief = memory.searchEnabled
    ? await getDmMemoryBrief(db, dmMemoryClaimAccess(claim.space))
    : null;
  const statements = brief
    ? discoveredStatements(
        db,
        {
          jobId: scope.jobId,
          claimTokenHash: claim.claimTokenHash,
          spaceId: claim.space.id,
          revision: claim.space.memory_revision,
          epoch: scope.revocationEpoch,
        },
        [...brief.profile, ...brief.progress],
      )
    : [];
  if (statements.length > 0) await db.batch(statements);
  await currentClaim(db, claim, scope);
  return { memory, brief };
}

export async function lookupDmMemoryClaim(
  db: D1Database,
  env: Env,
  scope: DmMemoryClaimScope,
  requestId: string,
  request: unknown,
  retrievalInput?: { store: DmMemoryVectorStore | null; minimumScore: number | null },
): Promise<DmMemoryLookupResponse> {
  const lookupStartedAt = Date.now();
  const memoryRequest = Schema.decodeUnknownSync(dmMemoryRequestSchema)(request) as DmMemoryRequest;
  const claim = await activeClaim(db, scope);
  const descriptor = dmMemoryDescriptor(
    claim.space,
    String(env.DM_MEMORY_RETRIEVAL_ENABLED) === "true",
  );
  if (!descriptor.searchEnabled) {
    throw new HttpError(503, "Memory retrieval is disabled", "memory_unavailable");
  }
  const normalizedRequest = memoryRequest.operation === "search"
    ? {
        ...memoryRequest,
        queries: [...new Set(memoryRequest.queries.map((text) => text.normalize("NFC")))].sort(),
        max_results: memoryRequest.max_results ?? 5,
      }
    : {
        ...memoryRequest,
        documents: memoryRequest.documents.map((document) => ({
          ...document,
          offsetBytes: document.offsetBytes ?? 0,
          maxBytes: document.maxBytes ?? 4096,
        })),
      };
  const reservation = await reserveReplyLookup(db, {
    jobId: scope.jobId,
    claimTokenHash: claim.claimTokenHash,
    requestId,
    kind: "memory",
    request: normalizedRequest,
    queries: normalizedRequest.operation === "search" ? normalizedRequest.queries : [],
    memoryRevision: claim.space.memory_revision,
    revocationEpoch: scope.revocationEpoch,
  });
  if (reservation.cachedJson) {
    await currentClaim(db, claim, scope);
    return Schema.decodeUnknownSync(dmMemoryLookupResponseSchema)(JSON.parse(reservation.cachedJson));
  }

  let response: DmMemoryLookupResponse;
  let references: DmMemoryReference[];
  if (normalizedRequest.operation === "search") {
    const scoreText = env.DM_MEMORY_MINIMUM_SCORE;
    const minimumScore = scoreText?.trim() ? Number(scoreText) : null;
    let retrieval = retrievalInput;
    if (!retrieval) {
      let store: DmMemoryVectorStore | null = null;
      try {
        store = dmMemoryVectorStore(env.DM_MEMORY_AI, env.DM_MEMORY_INDEX);
      } catch {
        // Missing or invalid bindings mean unavailable; there is no lexical fallback.
      }
      retrieval = { store, minimumScore };
    }
    const { operation, ...search } = normalizedRequest;
    response = {
      operation,
      ...await searchDmMemory(db, dmMemoryClaimAccess(claim.space), search, {
        ...retrieval,
        timeoutMs: Math.max(0, 4_500 - (Date.now() - lookupStartedAt)),
      }),
    };
    while (dmMemoryJsonBytes(response) > 16_384 && response.results.length > 0) {
      response = { ...response, results: response.results.slice(0, -1), truncated: true };
    }
    references = response.results;
  } else {
    const known = await db.prepare(`select document_id as documentId, version
      from briar_dm_memory_discovered_refs where job_id = ? and claim_token_hash = ?`)
      .bind(scope.jobId, claim.claimTokenHash).all<DmMemoryReference>();
    const { operation, ...get } = normalizedRequest;
    response = {
      operation,
      ...await getDmMemoryReferences(db, dmMemoryClaimAccess(claim.space), get, known.results),
    };
    references = response.documents.filter((document) => document.status === "ok");
  }
  const referenceInput = {
    jobId: scope.jobId,
    claimTokenHash: claim.claimTokenHash,
    spaceId: claim.space.id,
    revision: claim.space.memory_revision,
    epoch: scope.revocationEpoch,
  };
  const [completed] = await db.batch([
    replyLookupCompletionStatement(db, reservation, response),
    ...discoveredStatements(db, referenceInput, references, reservation),
  ]);
  await currentClaim(db, claim, scope);
  if (completed.results.length === 0) {
    throw new HttpError(409, "Memory changed during lookup", "memory_snapshot_changed");
  }
  return response;
}
