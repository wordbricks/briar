import * as Schema from "effect/Schema";
import { channelReplyClaimTokenHeader } from "../../src/lib/channels-contract";
import {
  dmMemoryLookupInputSchema, dmMemoryLookupResponseSchema,
  type DmMemoryLookupResponse, type DmMemoryReference,
} from "../../src/lib/dm-memory-query-contract";
import { getClaimedChannelReply } from "./channels";
import { reserveReplyLookup, replyLookupCompletionStatement } from "./channel-reply-lookup-budget";
import { sha256 } from "./crypto-digest";
import { getDmMemoryBrief } from "./dm-memory-brief";
import { dmMemoryClaimAccess, dmMemoryDescriptor, readDmMemoryClaim } from "./dm-memory-claim";
import { dmMemoryJsonBytes, getDmMemoryReferences, searchDmMemory } from "./dm-memory-retrieval";
import { dmMemoryVectorStore, type DmMemoryVectorStore } from "./dm-memory-vector-store";
import { HttpError, privateNoStoreJson } from "./http-response";
import { readJson } from "./request-readers";
import { decodeRequestSync } from "./request-schema";
import { requireWorkerOrganization } from "./worker-route-auth";

const querySchema = Schema.Struct({
  workerId: Schema.Trim.check(Schema.isLengthBetween(1, 64)),
  revocationEpoch: Schema.String.check(Schema.isPattern(/^(0|[1-9][0-9]{0,12})$/u)),
}).annotate({ parseOptions: { onExcessProperty: "error" } });

function discoveredStatements(db: D1Database, input: {
  jobId: string; claimTokenHash: string; spaceId: string; revision: number; epoch: number;
}, refs: readonly DmMemoryReference[], reservation?: { requestId: string; leaseToken: string }) {
  return refs.map((ref) => db.prepare(`insert into briar_dm_memory_discovered_refs
    (job_id, claim_token_hash, document_id, version)
    select ?, ?, doc.id, doc.current_version from briar_dm_memory_documents doc
    join briar_dm_memory_spaces space on space.id = doc.space_id
    join briar_channel_agent_reply_jobs job on job.id = ? and job.claim_token_hash = ? and job.status = 'running'
    where doc.id = ? and doc.current_version = ? and doc.status = 'active' and doc.space_id = ?
      and space.memory_revision = ? and space.revocation_epoch = ?
      and (? is null or exists (select 1 from briar_channel_reply_lookups lookup
        where lookup.job_id = job.id and lookup.claim_token_hash = job.claim_token_hash
          and lookup.request_id = ? and lookup.lease_token = ? and lookup.response_json is not null))
    on conflict do nothing`).bind(input.jobId, input.claimTokenHash, input.jobId, input.claimTokenHash,
      ref.documentId, ref.version, input.spaceId, input.revision, input.epoch,
      reservation?.requestId ?? null, reservation?.requestId ?? null, reservation?.leaseToken ?? null));
}

export async function handleDmMemoryClaimRoute(input: {
  request: Request; url: URL; db: D1Database; env: Env;
  retrieval?: { store: DmMemoryVectorStore | null; minimumScore: number | null };
}): Promise<Response | undefined> {
  const { request, url, db, env } = input;
  const match = url.pathname.match(/^\/organizations\/([0-9a-f-]+)\/channel-reply-claims\/([0-9a-f-]+)\/memory\/(brief|check|lookup)$/u);
  if (!match) return undefined;
  const lookupStartedAt = Date.now();
  const [, organizationId, jobId, resource] = match;
  if (request.method !== (resource === "lookup" ? "POST" : "GET")) throw new HttpError(405, "Method not allowed");
  const principal = await requireWorkerOrganization(db, request, organizationId);
  const token = request.headers.get(channelReplyClaimTokenHeader)?.trim();
  if (!token?.startsWith("briar_channel_claim_") || token.length > 200) throw new HttpError(401, "Channel reply claim token required");
  const lookup = resource === "lookup" ? decodeRequestSync(dmMemoryLookupInputSchema)(await readJson(request, 8192)) : null;
  const query = lookup ? null : decodeRequestSync(querySchema)(Object.fromEntries(url.searchParams));
  const workerId = lookup?.workerId ?? query!.workerId;
  const epoch = lookup?.revocationEpoch ?? Number(query!.revocationEpoch);
  const claimTokenHash = await sha256(token);
  const requireClaim = async () => {
    const job = await getClaimedChannelReply(db, { jobId, workerId, deviceId: principal.deviceId, claimTokenHash,
      observedAt: new Date().toISOString() });
    if (!job || job.organization_id !== organizationId) throw new HttpError(409, "Reply claim is no longer active", "memory_scope_revoked");
  };
  await requireClaim();
  const space = await readDmMemoryClaim(db, jobId, claimTokenHash);
  if (space.revocation_epoch !== epoch) throw new HttpError(409, "Memory context changed", "memory_scope_revoked");
  const enabled = String(env.DM_MEMORY_RETRIEVAL_ENABLED) === "true";
  const descriptor = dmMemoryDescriptor(space, enabled);
  if (resource === "check") return privateNoStoreJson({ memory: descriptor });
  const access = dmMemoryClaimAccess(space);
  const refsInput = { jobId, claimTokenHash, spaceId: space.id, revision: space.memory_revision, epoch };
  if (resource === "brief") {
    const brief = descriptor.searchEnabled ? await getDmMemoryBrief(db, access) : null;
    const statements = brief ? discoveredStatements(db, refsInput, [...brief.profile, ...brief.progress]) : [];
    if (statements.length) await db.batch(statements);
    await requireClaim();
    const current = await readDmMemoryClaim(db, jobId, claimTokenHash);
    if (current.memory_revision !== space.memory_revision) throw new HttpError(409, "Memory changed", "memory_snapshot_changed");
    return privateNoStoreJson({ memory: descriptor, brief });
  }
  if (!lookup || !descriptor.searchEnabled) throw new HttpError(503, "Memory retrieval is disabled", "memory_unavailable");
  const memoryRequest = lookup.request.operation === "search"
    ? { ...lookup.request, queries: [...new Set(lookup.request.queries.map((text) => text.normalize("NFC")))].sort(),
      max_results: lookup.request.max_results ?? 5 }
    : { ...lookup.request, documents: lookup.request.documents.map((document) => ({
      ...document, offsetBytes: document.offsetBytes ?? 0, maxBytes: document.maxBytes ?? 4096,
    })) };
  const reservation = await reserveReplyLookup(db, { jobId, claimTokenHash, requestId: lookup.requestId,
    kind: "memory", request: memoryRequest, queries: memoryRequest.operation === "search" ? memoryRequest.queries : [],
    memoryRevision: space.memory_revision, revocationEpoch: epoch });
  if (reservation.cachedJson) {
    await requireClaim();
    const current = await readDmMemoryClaim(db, jobId, claimTokenHash);
    if (current.memory_revision !== space.memory_revision) throw new HttpError(409, "Memory changed", "memory_snapshot_changed");
    return privateNoStoreJson(Schema.decodeUnknownSync(dmMemoryLookupResponseSchema)(JSON.parse(reservation.cachedJson)));
  }
  let response: DmMemoryLookupResponse;
  let refs: DmMemoryReference[];
  if (memoryRequest.operation === "search") {
    const scoreText = env.DM_MEMORY_MINIMUM_SCORE;
    const minimumScore = scoreText?.trim() ? Number(scoreText) : null;
    let retrieval = input.retrieval;
    if (!retrieval) {
      let store: DmMemoryVectorStore | null = null;
      try { store = dmMemoryVectorStore(env.DM_MEMORY_AI, env.DM_MEMORY_INDEX); }
      catch { /* Missing/invalid binding is unavailable, never a lexical fallback. */ }
      retrieval = { store, minimumScore };
    }
    const { operation, ...search } = memoryRequest;
    response = { operation, ...await searchDmMemory(db, access, search, {
      ...retrieval, timeoutMs: Math.max(0, 4500 - (Date.now() - lookupStartedAt)),
    }) };
    while (dmMemoryJsonBytes(response) > 16384 && response.results.length) {
      response = { ...response, results: response.results.slice(0, -1), truncated: true };
    }
    refs = response.results;
  } else {
    const known = await db.prepare(`select document_id as documentId, version from briar_dm_memory_discovered_refs
      where job_id = ? and claim_token_hash = ?`).bind(jobId, claimTokenHash).all<DmMemoryReference>();
    const { operation, ...get } = memoryRequest;
    response = { operation, ...await getDmMemoryReferences(db, access, get, known.results) };
    refs = response.documents.filter((document) => document.status === "ok");
  }
  const [completed] = await db.batch([replyLookupCompletionStatement(db, reservation, response),
    ...discoveredStatements(db, refsInput, refs, reservation)]);
  await requireClaim();
  const current = await readDmMemoryClaim(db, jobId, claimTokenHash);
  if (!completed.results.length || current.memory_revision !== space.memory_revision) {
    throw new HttpError(409, "Memory changed during lookup", "memory_snapshot_changed");
  }
  return privateNoStoreJson(response);
}
