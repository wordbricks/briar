import { sha256 } from "./crypto-digest";
import { HttpError, json } from "./http-response";
import {
  blockMergeBatch,
  claimNextMergeBatch,
  completeMergeBatchPublication,
  recordPreparedMergeBatch,
  recordMergeBatchCandidateEnqueued,
  recordMergeBatchValidationProof,
  releaseMergeBatchLease,
  renewMergeBatchLease,
} from "./merge-batches";
import {
  decodeMergeBatchAuthorityInput,
  decodeMergeBatchBlockInput,
  decodeMergeBatchClaimInput,
  decodeMergeBatchEnqueueInput,
  decodeMergeBatchLeaseInput,
  decodeMergeBatchPublicationInput,
  decodeMergeBatchValidationInput,
} from "./merge-queue-contract";
import { readJson } from "./request-readers";
import { leaseExpiryFrom, workerStateAt } from "./workers";

const mergeBatchWorkJson = (
  claim: NonNullable<Awaited<ReturnType<typeof claimNextMergeBatch>>>,
  claimToken: string,
) => {
  const validationCommands = JSON.parse(
    claim.batch.validation_commands_json,
  ) as string[];
  return {
    workType: "mergeBatch" as const,
    workId: claim.batch.id,
    runId: claim.batch.id,
    sourceKey: `merge:${claim.batch.repository}#${claim.batch.id.slice(0, 8)}`,
    title: `Merge ${claim.members.length} PRs into ${claim.batch.base_branch}`,
    projectId: claim.batch.project_id,
    repositoryId: claim.batch.repository_id,
    repository: claim.batch.repository,
    baseBranch: claim.batch.base_branch,
    validationCommands,
    phase: claim.phase,
    claimToken,
    claimedAt: claim.batch.claimed_at,
    leaseExpiresAt: claim.batch.lease_expires_at,
    claimAttempts: claim.batch.claim_attempts,
    batch: {
      id: claim.batch.id,
      state: claim.batch.state,
      finalDeliveryId: claim.batch.final_delivery_id,
      mergeGroupRef: claim.batch.merge_group_ref,
      mergeGroupSha: claim.batch.merge_group_sha,
      mergeGroupBaseSha: claim.batch.merge_group_base_sha,
      validationResults: claim.batch.validation_results_json
        ? JSON.parse(claim.batch.validation_results_json) as unknown
        : null,
      validatedAt: claim.batch.validated_at,
      publishedAt: claim.batch.published_at,
      failureCode: claim.batch.failure_code,
      failureDetail: claim.batch.failure_detail,
    },
    members: claim.members.map((member) => ({
      id: member.id,
      ordinal: member.ordinal,
      runId: member.run_id,
      attempt: member.attempt,
      revision: member.revision,
      pullRequestId: member.pull_request_id,
      pullRequestNodeId: member.pull_request_node_id,
      pullRequestNumber: member.pull_request_number,
      pullRequestUrl: member.pull_request_url,
      headSha: member.frozen_head_sha,
      baseSha: member.frozen_base_sha,
      queueEntryId: member.queue_entry_id,
      state: member.state,
    })),
    pendingHeads: claim.pendingHeads.map((head) => ({
      deliveryId: head.delivery_id,
      headRef: head.head_ref,
      headSha: head.head_sha,
      baseSha: head.base_sha,
      tailPullRequestNumber: head.tail_pull_request_number,
      receivedAt: head.received_at,
    })),
  };
};

export type MergeBatchRouteInput = {
  request: Request;
  url: URL;
  db: D1Database;
  requireWorkerProjectBinding: (
    projectId: string,
    workerId?: string,
  ) => Promise<{
    principal: { deviceId: string };
    binding: {
      id: string;
      last_heartbeat_at: string;
      state: "online" | "stale" | "disabled";
      accepting_work: number;
      readiness_state: "ready" | "busy" | "needs_attention";
    };
  }>;
};

export async function handleMergeBatchRoute(
  routeInput: MergeBatchRouteInput,
): Promise<Response | undefined> {
  const { request, url, db } = routeInput;
  const { pathname } = url;
  const requireWorkerProjectBinding = (
    _db: D1Database,
    _request: Request,
    projectId: string,
    workerId?: string,
  ) => routeInput.requireWorkerProjectBinding(projectId, workerId);

  if (pathname === "/merge-batch-claims" && request.method === "POST") {
    const input = decodeMergeBatchClaimInput(await readJson(request));
    const authenticatedWorker = await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const observedAt = new Date().toISOString();
    if (
      workerStateAt(
          authenticatedWorker.binding.last_heartbeat_at,
          observedAt,
          authenticatedWorker.binding.state,
        ) !== "online" ||
      authenticatedWorker.binding.accepting_work !== 1 ||
      authenticatedWorker.binding.readiness_state === "needs_attention"
    ) {
      throw new HttpError(409, "Worker is not ready to claim a merge batch");
    }
    const claimToken =
      `briar_merge_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const claim = await claimNextMergeBatch(db, input.projectId, {
      workerId: authenticatedWorker.binding.id,
      deviceId: authenticatedWorker.principal.deviceId,
      claimedBy: input.claimedBy,
      claimTokenHash: await sha256(claimToken),
      claimedAt: observedAt,
      leaseExpiresAt: leaseExpiryFrom(observedAt),
    });
    const response = {
      work: claim ? mergeBatchWorkJson(claim, claimToken) : null,
    };
    if (!claim) Object.assign(response, { retryAfterMs: 15_000 });
    return json(response);
  }

  const mergeBatchClaimMatch = pathname.match(
    /^\/merge-batch-claims\/([0-9a-f-]+)\/(lease|release|enqueued|authority|validation|published|block)$/u,
  );
  if (mergeBatchClaimMatch && request.method === "POST") {
    const batchId = mergeBatchClaimMatch[1];
    const action = mergeBatchClaimMatch[2];
    const rawInput = await readJson(request);
    const observedAt = new Date().toISOString();
    if (action === "lease" || action === "release") {
      const input = decodeMergeBatchLeaseInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const common = {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        authenticatedAt: observedAt,
      };
      if (action === "lease") {
        const leaseExpiresAt = await renewMergeBatchLease(db, {
          ...common,
          leaseExpiresAt: leaseExpiryFrom(observedAt),
        });
        if (!leaseExpiresAt) {
          throw new HttpError(409, "Merge batch claim is no longer active");
        }
        return json({ batchId, leaseExpiresAt });
      }
      if (!(await releaseMergeBatchLease(db, common))) {
        throw new HttpError(409, "Merge batch claim is no longer active");
      }
      return json({ batchId, released: true });
    }
    if (action === "enqueued") {
      const input = decodeMergeBatchEnqueueInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const result = await recordMergeBatchCandidateEnqueued(db, {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        candidateId: input.candidateId,
        expectedHeadSha: input.expectedHeadSha,
        expectedBaseSha: input.expectedBaseSha,
        queueEntryId: input.queueEntryId,
        observedAt,
      });
      if (!result) {
        throw new HttpError(409, "Merge batch candidate identity changed");
      }
      return json({
        batchId,
        candidateId: result.candidate.id,
        state: result.batch.state,
      });
    }
    if (action === "authority") {
      const input = decodeMergeBatchAuthorityInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const result = await recordPreparedMergeBatch(db, {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        integrationRef: input.integrationRef,
        integrationSha: input.integrationSha,
        baseSha: input.baseSha,
        observedAt,
      });
      if (!result) {
        throw new HttpError(409, "Prepared integration ref was rejected");
      }
      return json({
        batchId,
        state: result.state,
        mergeGroupSha: result.merge_group_sha,
      });
    }
    if (action === "validation") {
      const input = decodeMergeBatchValidationInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const batch = await recordMergeBatchValidationProof(db, {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        mergeGroupSha: input.mergeGroupSha,
        validationResults: input.validationResults,
        validatedAt: observedAt,
      });
      if (!batch) {
        throw new HttpError(409, "Merge batch validation proof was rejected");
      }
      return json({ batchId, state: batch.state, validatedAt: batch.validated_at });
    }
    if (action === "published") {
      const input = decodeMergeBatchPublicationInput(rawInput);
      await requireWorkerProjectBinding(
        db,
        request,
        input.projectId,
        input.workerId,
      );
      const batch = await completeMergeBatchPublication(db, {
        batchId,
        projectId: input.projectId,
        workerId: input.workerId,
        claimTokenHash: await sha256(input.claimToken),
        mergeGroupSha: input.mergeGroupSha,
        publishedAt: observedAt,
      });
      if (!batch) {
        throw new HttpError(409, "Merge batch publication claim is no longer active");
      }
      return json({ batchId, state: batch.state, publishedAt: batch.published_at });
    }
    const input = decodeMergeBatchBlockInput(rawInput);
    await requireWorkerProjectBinding(
      db,
      request,
      input.projectId,
      input.workerId,
    );
    const batch = await blockMergeBatch(db, {
      batchId,
      projectId: input.projectId,
      workerId: input.workerId,
      claimTokenHash: await sha256(input.claimToken),
      code: input.code,
      detail: input.detail,
      observedAt,
    });
    if (!batch) {
      throw new HttpError(409, "Merge batch claim is no longer active");
    }
    return json({ batchId, state: batch.state });
  }

  return undefined;
}
