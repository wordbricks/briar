import { sha256 } from "./crypto-digest";
import type { PublishDmPublicMessageBatchInput } from "./dm-public-message-mappers";
import {
  commitDmPublicMessageBatch,
  findDmFinalPublicMessageForReply,
  findDmPublicMessageByClaimRequest,
  findDmPublicMessageByRequestId,
  getDmPublicMessageClaim,
} from "./dm-public-message-repository";
import { requireDmMemoryReplyFence } from "./dm-memory-reply-fence";
import { scheduleChannelRealtimePublish } from "./realtime-scheduling";
import type { AuthenticatedWorkerTeam } from "./worker-route-auth";

export class DmPublicMessageError extends Error {
  constructor(
    readonly reason:
      | "claim_stale"
      | "revision_conflict"
      | "request_conflict"
      | "final_conflict"
      | "invalid_request",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DmPublicMessageError";
  }
}

const canonicalPayload = (request: PublishDmPublicMessageBatchInput) => ({
  expectedInputRevision: request.expectedInputRevision,
  publicationKind: request.publicationKind,
  parts: request.parts,
});

const matchingReplay = (
  batch: NonNullable<
    Awaited<ReturnType<typeof findDmPublicMessageByClaimRequest>>
  >,
  payloadHash: string,
) => {
  if (batch.payloadHash !== payloadHash) {
    throw new DmPublicMessageError(
      "request_conflict",
      "DM publication request ID was reused with another payload",
    );
  }
  return { ...batch, replayed: true as const };
};

export async function publishDmPublicMessageBatchApplication(input: {
  db: D1Database;
  env: Env;
  context?: ExecutionContext;
  worker: AuthenticatedWorkerTeam;
  request: PublishDmPublicMessageBatchInput;
}) {
  const { request, worker } = input;
  if (
    !worker.binding || request.workerId !== worker.binding.id ||
    request.projectId !== worker.binding.project_id ||
    request.claim.organizationId !== worker.principal.organizationId
  ) {
    throw new DmPublicMessageError(
      "claim_stale",
      "DM publication claim belongs to another Worker scope",
    );
  }
  const claimTokenHash = await sha256(request.claim.claimToken);
  const payloadHash = await sha256(JSON.stringify(canonicalPayload(request)));
  const replay = await findDmPublicMessageByClaimRequest(input.db, {
    jobId: request.claim.workId,
    organizationId: request.claim.organizationId,
    channelId: request.claim.runId,
    workerId: worker.binding.id,
    deviceId: worker.principal.deviceId,
    claimTokenHash,
    requestId: request.requestId,
  });
  if (replay) return matchingReplay(replay, payloadHash);
  if (await findDmPublicMessageByRequestId(input.db, request.requestId)) {
    throw new DmPublicMessageError(
      "request_conflict",
      "DM publication request ID belongs to another request scope",
    );
  }
  const observedAt = new Date().toISOString();
  await requireDmMemoryReplyFence(input.db, request.claim.workId);
  const scope = await getDmPublicMessageClaim(input.db, {
    jobId: request.claim.workId,
    organizationId: request.claim.organizationId,
    workerId: worker.binding.id,
    deviceId: worker.principal.deviceId,
    claimTokenHash,
    observedAt,
  });
  if (!scope || scope.channel_id !== request.claim.runId) {
    throw new DmPublicMessageError(
      "claim_stale",
      "DM publication requires the active one-person DM claim and protocol",
    );
  }
  if (scope.input_revision !== request.expectedInputRevision) {
    throw new DmPublicMessageError(
      "revision_conflict",
      "DM publication input revision changed",
    );
  }
  if (
    request.publicationKind === "final" &&
    await findDmFinalPublicMessageForReply(input.db, scope.job_id)
  ) {
    throw new DmPublicMessageError(
      "final_conflict",
      "DM reply already has a final public message batch",
    );
  }
  let published;
  try {
    published = await commitDmPublicMessageBatch(input.db, {
      scope,
      requestId: request.requestId,
      payloadHash,
      publicationKind: request.publicationKind,
      parts: request.parts,
      workerId: worker.binding.id,
      deviceId: worker.principal.deviceId,
      claimTokenHash,
      createdAt: observedAt,
    });
  } catch (cause) {
    const racedReplay = await findDmPublicMessageByClaimRequest(input.db, {
      jobId: request.claim.workId,
      organizationId: request.claim.organizationId,
      channelId: request.claim.runId,
      workerId: worker.binding.id,
      deviceId: worker.principal.deviceId,
      claimTokenHash,
      requestId: request.requestId,
    });
    if (racedReplay) return matchingReplay(racedReplay, payloadHash);
    if (
      request.publicationKind === "final" &&
      await findDmFinalPublicMessageForReply(input.db, scope.job_id)
    ) {
      throw new DmPublicMessageError(
        "final_conflict",
        "DM reply already has a final public message batch",
        { cause },
      );
    }
    throw cause;
  }
  if (!published) {
    throw new DmPublicMessageError(
      "claim_stale",
      "DM publication authority changed before commit",
    );
  }
  scheduleChannelRealtimePublish(
    input.env,
    input.db,
    scope.organization_id,
    input.context,
  );
  return { ...published, replayed: false as const };
}
