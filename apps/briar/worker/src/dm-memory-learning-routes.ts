import * as Schema from "effect/Schema";
import { DmLearningCallInput, DmLearningFailureInput, DmLearningLeaseInput, DmLearningProposalInput,
  DmLearningVerificationInput, dmMemoryLearningClaimTokenHeader } from "../../src/lib/dm-memory-learning-contract";
import { sha256 } from "./crypto-digest";
import { dmMemoryCanonicalJson } from "../../src/lib/dm-memory-canonical-json";
import { dmLearningClaimCurrentSql, failDmLearningClaim, requireDmLearningClaim } from "./dm-memory-learning-claims";
import { dmLearningInputsCurrentSql } from "./dm-memory-learning-input";
import { reserveDmLearningModelCall, submitDmLearningProposal, submitDmLearningVerification } from "./dm-memory-learning-model-calls";
import { dmLearningPolicy } from "./dm-memory-learning-policy";
import { DmLearningError } from "./dm-memory-learning-validation";
import { HttpError, privateNoStoreJson } from "./http-response";
import { readJson } from "./request-readers";
import { requireWorkerOrganization } from "./worker-route-auth";

async function decodeInput<S extends Schema.ConstraintDecoder<unknown>>(schema: S, request: Request) {
  try { return Schema.decodeUnknownSync(schema)(await readJson(request, 524_288)); }
  catch { throw new HttpError(400, "Invalid memory learning request", "memory_invalid_request"); }
}

export async function handleDmMemoryLearningRoute(input: {
  request: Request; url: URL; db: D1Database; env: Env;
}): Promise<Response | undefined> {
  const { request, url, db, env } = input;
  const match = url.pathname.match(/^\/organizations\/([0-9a-f-]+)\/dm-memory-claims\/([0-9a-f-]+)\/(call|proposal|verification|lease|fail|release)$/u);
  if (!match) return undefined;
  if (request.method !== "POST") throw new HttpError(405, "Method not allowed");
  const [, organizationId, jobId, resource] = match;
  const principal = await requireWorkerOrganization(db, request, organizationId);
  const token = request.headers.get(dmMemoryLearningClaimTokenHeader)?.trim();
  if (!token || !/^briar_memory_claim_[a-f0-9]{64}$/u.test(token)) {
    throw new HttpError(401, "Memory learning claim token required");
  }
  const decoded = resource === "call" ? { kind: "call" as const, body: await decodeInput(DmLearningCallInput, request) }
    : resource === "proposal" ? { kind: "proposal" as const, body: await decodeInput(DmLearningProposalInput, request) }
    : resource === "verification" ? { kind: "verification" as const, body: await decodeInput(DmLearningVerificationInput, request) }
    : resource === "fail" ? { kind: "fail" as const, body: await decodeInput(DmLearningFailureInput, request) }
    : { kind: "lease" as const, body: await decodeInput(DmLearningLeaseInput, request) };
  const { body } = decoded;
  const now = new Date().toISOString();
  const identity = { organizationId, jobId, deviceId: principal.deviceId, workerId: body.workerId,
    claimTokenHash: await sha256(token) };
  try {
    if (resource === "release" || decoded.kind === "fail") {
      // Update draining may already have disabled accepting_work. Possession of
      // this exact device/Worker claim can retire it, but cannot write memory.
      const accounting = decoded.kind === "fail" && decoded.body.callId && decoded.body.usage
        ? { callId: decoded.body.callId, usage: decoded.body.usage } : undefined;
      const released = await failDmLearningClaim(db, identity, decoded.kind === "fail" ? decoded.body.code : "model_unavailable", now, accounting);
      return privateNoStoreJson({ released });
    }
    const policy = dmLearningPolicy(env, organizationId);
    if (!policy) throw new DmLearningError("model_configuration");
    const common = { identity, policy, inputHash: body.inputHash, now };
    if (decoded.kind === "verification") return privateNoStoreJson(await submitDmLearningVerification(db, { ...common, ...decoded.body }));
    if (decoded.kind === "proposal") return privateNoStoreJson(await submitDmLearningProposal(db, { ...common, ...decoded.body }));
    if (decoded.kind === "call") return privateNoStoreJson(await reserveDmLearningModelCall(db, { ...common, ...decoded.body }));
    const { job } = await requireDmLearningClaim(db, identity, policy, now);
    if (job.input_hash !== body.inputHash) throw new DmLearningError("stale");
    const leaseExpiresAt = new Date(Date.parse(now) + 5 * 60_000).toISOString();
    const renewed = await db.prepare(`update briar_dm_memory_jobs as job set lease_expires_at = ?, updated_at = ?
      where job.id = ? and job.lease_token_hash = ? and job.input_hash = ? and job.policy_json = ?
        and exists (select 1 from briar_dm_memory_spaces space where space.id = job.space_id
          and job.expected_memory_revision = space.memory_revision and ${dmLearningClaimCurrentSql}
          and ${dmLearningInputsCurrentSql}) returning id`)
      .bind(leaseExpiresAt, now, jobId, identity.claimTokenHash, body.inputHash, dmMemoryCanonicalJson(policy), now, now).first();
    if (!renewed) throw new DmLearningError("stale");
    return privateNoStoreJson({ leaseExpiresAt });
  } catch (error) {
    const code = error instanceof DmLearningError ? error.code : "model_unavailable";
    const status = code === "stale" || code === "scope_revoked" ? 409
      : code === "invalid_proposal" || code === "verification_rejected" ? 422
      : code === "budget_exhausted" ? 429 : 503;
    // Neither Schema errors nor provider/database messages may echo private input.
    throw new HttpError(status, "Memory learning could not complete", `memory_${code}`);
  }
}
