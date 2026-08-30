import { contentDisposition } from "./attachment-storage";
import { sha256, sha256Bytes } from "./crypto-digest";
import {
  assertQueuedHuntClaim,
  attemptGithubMergeAutoResume,
  completeWorkflowStageLifecycle,
  createRunEvidenceImages,
  EventKeyConflictError,
  getHuntRunForProject,
  HuntClaimError,
  HuntTransitionError,
  listEvidenceImagesForEvidence,
  recoverHuntRun,
  recordHuntEvent,
  recordRunEvidence,
  reworkHuntRun,
  startWorkflowStageLifecycle,
  type RunEvidenceImageInput,
} from "./db";
import { HttpError, json } from "./http-response";
import { registerReadyMergeCandidates } from "./merge-batches";
import { getMergeQueueProfile } from "./merge-queue-profile";
import { isReservedProposalIssueSourceKey } from "./proposal-issue-source";
import { readJson, readRunEvidenceRequest, dashboardStageForProgress } from "./request-readers";
import { evidenceImageJson } from "./run-evidence-json";
import {
  decodeRecoveryAgentInput,
  decodeResumeAgentInput,
  decodeRunEvent,
  decodeRunReworkInput,
  decodeWorkflowStageLifecycleInput,
} from "./run-request-contract";
import { assertRunEventIdentityNotOverridden } from "./run-event-identity";
import { auditExecutionEvent } from "./workers";
import { resumeRunWithCheckpointIdentity } from "./workflow-resume";

export type RunAgentRouteInput = {
  request: Request;
  url: URL;
  db: D1Database;
  attachmentsBucket: R2Bucket;
  env: Env;
  requireRunExecutionProject: (runId: string) => Promise<string>;
  requireActiveWorkerRunClaim: (runId: string) => Promise<{
    projectId: string;
    claimTokenHash: string;
    authenticatedAt: string;
  }>;
  requireAgentProject: () => Promise<string>;
};

export async function handleRunAgentRoute(
  routeInput: RunAgentRouteInput,
): Promise<Response | undefined> {
  const { request, url, db, attachmentsBucket, env } = routeInput;
  const { pathname } = url;
  const requireRunExecutionProject = (
    _db: D1Database,
    _request: Request,
    runId: string,
  ) => routeInput.requireRunExecutionProject(runId);
  const requireActiveWorkerRunClaim = (
    _db: D1Database,
    _request: Request,
    runId: string,
  ) => routeInput.requireActiveWorkerRunClaim(runId);
  const requireAgentProject = (
    _db: D1Database,
    _request: Request,
  ) => routeInput.requireAgentProject();

  const agentRecoveryMatch = pathname.match(
    /^\/runs\/([0-9a-f-]+)\/(retry|cancel)$/u,
  );
  if (agentRecoveryMatch && request.method === "POST") {
    const projectId = await requireRunExecutionProject(
      db,
      request,
      agentRecoveryMatch[1],
    );
    const input = decodeRecoveryAgentInput(await readJson(request));
    const result = await recoverHuntRun(db, projectId, {
      runId: agentRecoveryMatch[1],
      action: agentRecoveryMatch[2] as "retry" | "cancel",
      requestId: input.requestId,
      actor: input.actor,
      reason: input.reason ?? null,
      occurredAt: new Date().toISOString(),
    });
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (result.outcome === "ineligible") {
      throw new HttpError(409, "Only blocked or failed runs can be recovered");
    }
    return json({ runId: agentRecoveryMatch[1], ...result });
  }

  const agentResumeMatch = pathname.match(
    /^\/runs\/([0-9a-f-]+)\/resume$/u,
  );
  const agentStageLifecycleMatch = pathname.match(
    /^\/runs\/([0-9a-f-]+)\/stages\/([a-z][a-z0-9_-]{0,63})\/(start|complete)$/u,
  );
  if (agentStageLifecycleMatch && request.method === "POST") {
    const { projectId } = await requireActiveWorkerRunClaim(
      db,
      request,
      agentStageLifecycleMatch[1],
    );
    const input = decodeWorkflowStageLifecycleInput(await readJson(request));
    try {
      const lifecycleObservedAt = new Date().toISOString();
      const common = {
        runId: agentStageLifecycleMatch[1],
        stageId: agentStageLifecycleMatch[2],
        attempt: input.attempt,
        revision: input.revision,
        actor: input.actor,
      };
      const result = agentStageLifecycleMatch[3] === "start"
        ? await startWorkflowStageLifecycle(db, projectId, {
            ...common,
            startedAt: new Date().toISOString(),
          })
        : await completeWorkflowStageLifecycle(db, projectId, {
            ...common,
            finishedAt: lifecycleObservedAt,
          });
      if (result.outcome === "not_found") {
        throw new HttpError(404, "Run not found", "RUN_NOT_FOUND");
      }
      const githubAutoResume =
        result.outcome === "paused" &&
          result.checkpoint?.stage === "pr_open" &&
          result.checkpoint.position === "after"
          ? await attemptGithubMergeAutoResume(
              db,
              projectId,
              agentStageLifecycleMatch[1],
            )
          : null;
      const mergeQueueProfile = agentStageLifecycleMatch[3] === "complete"
        ? await getMergeQueueProfile(db, projectId)
        : null;
      const mergeQueueRun =
        mergeQueueProfile?.enabled === 1 &&
          mergeQueueProfile.readiness_stage_id === agentStageLifecycleMatch[2]
          ? await getHuntRunForProject(
              db,
              projectId,
              agentStageLifecycleMatch[1],
            )
          : null;
      const mergeQueueRegistration = mergeQueueRun
        ? await registerReadyMergeCandidates(db, {
            projectId,
            runId: mergeQueueRun.id,
            attempt: mergeQueueRun.current_attempt,
            revision: mergeQueueRun.current_revision,
            readyAt: lifecycleObservedAt,
          })
        : null;
      const response = {
        runId: agentStageLifecycleMatch[1],
        requestId: input.requestId,
        ...result,
      };
      if (githubAutoResume) Object.assign(response, { githubAutoResume });
      if (mergeQueueRegistration) {
        Object.assign(response, {
          mergeQueueRegistered: mergeQueueRegistration.length,
        });
      }
      return json(response);
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(
          409,
          error.message,
          "WORKFLOW_STAGE_CONFLICT",
        );
      }
      throw error;
    }
  }
  if (agentResumeMatch && request.method === "POST") {
    const projectId = await requireRunExecutionProject(
      db,
      request,
      agentResumeMatch[1],
    );
    const input = decodeResumeAgentInput(await readJson(request));
    const result = await resumeRunWithCheckpointIdentity(
      db,
      projectId,
      agentResumeMatch[1],
      input,
      input.actor,
    );
    if (result.outcome === "not_found") {
      throw new HttpError(404, "Run not found");
    }
    if (result.outcome === "conflict") {
      throw new HttpError(
        409,
        "The paused checkpoint changed before it could be resumed",
        "CHECKPOINT_CONFLICT",
      );
    }
    return json({
      runId: agentResumeMatch[1],
      ...result,
      workflowStage: result.nextStage,
      startStage: result.nextStage,
    });
  }

  const reworkMatch = pathname.match(/^\/runs\/([0-9a-f-]+)\/rework$/u);
  if (reworkMatch && request.method === "POST") {
    const projectId = await requireRunExecutionProject(
      db,
      request,
      reworkMatch[1],
    );
    const input = decodeRunReworkInput(await readJson(request));
    try {
      const result = await reworkHuntRun(db, projectId, {
        runId: reworkMatch[1],
        workflowStage: input.workflowStage,
        requestId: input.requestId,
        actor: input.actor,
        reason: input.reason,
        occurredAt: new Date().toISOString(),
      });
      if (result.outcome === "not_found") {
        throw new HttpError(404, "Run not found");
      }
      return json({ runId: reworkMatch[1], ...result });
    } catch (error) {
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  const evidenceMatch = pathname.match(/^\/runs\/([0-9a-f-]+)\/evidence$/u);
  if (evidenceMatch && request.method === "POST") {
    const { projectId, claimTokenHash, authenticatedAt } =
      await requireActiveWorkerRunClaim(
      db,
      request,
      evidenceMatch[1],
      );
    const { input: parsed, images } = await readRunEvidenceRequest(request);
    try {
      const evidence = await recordRunEvidence(db, projectId, {
        runId: evidenceMatch[1],
        ...parsed,
        detail: parsed.detail ?? null,
        command: parsed.command ?? null,
        url: parsed.url ?? null,
        metadata: parsed.metadata ?? null,
        observedAt: new Date(parsed.observedAt).toISOString(),
      }, { claimTokenHash, authenticatedAt });
      if (!evidence) throw new HttpError(404, "Run not found");
      let storedImages = await listEvidenceImagesForEvidence(
        db,
        projectId,
        evidence.run_id,
        evidence.id,
      );
      if (images.length > 0) {
        const prepared = await Promise.all(
          images.map(async (image, position) => {
            const bytes = await image.arrayBuffer();
            return {
              bytes,
              filename: image.name.normalize("NFC").trim(),
              contentType: image.type,
              byteSize: image.size,
              sha256: await sha256Bytes(bytes),
              position,
            };
          }),
        );
        if (storedImages.length > 0) {
          const sameImages =
            storedImages.length === prepared.length &&
            storedImages.every((stored, position) => {
              const incoming = prepared[position];
              return (
                incoming &&
                stored.filename === incoming.filename &&
                stored.content_type === incoming.contentType &&
                stored.byte_size === incoming.byteSize &&
                stored.sha256 === incoming.sha256 &&
                stored.position === incoming.position
              );
            });
          if (!sameImages) throw new EventKeyConflictError();
        } else {
          const imageInputs: RunEvidenceImageInput[] = prepared.map(
            (image) => {
              const id = crypto.randomUUID();
              return {
                id,
                object_key: `run-evidence/${projectId}/${evidence.run_id}/${evidence.id}/${id}`,
                filename: image.filename,
                content_type: image.contentType,
                byte_size: image.byteSize,
                sha256: image.sha256,
                position: image.position,
              };
            },
          );
          const uploadedKeys: string[] = [];
          try {
            for (const [position, image] of imageInputs.entries()) {
              const preparedImage = prepared[position];
              if (!preparedImage) throw new Error("Evidence image is missing");
              await attachmentsBucket.put(image.object_key, preparedImage.bytes, {
                httpMetadata: {
                  contentType: image.content_type,
                  contentDisposition: contentDisposition(image.filename),
                },
                customMetadata: {
                  evidenceId: evidence.id,
                  imageId: image.id,
                  projectId,
                  runId: evidence.run_id,
                  sha256: image.sha256,
                },
              });
              uploadedKeys.push(image.object_key);
            }
            const created = await createRunEvidenceImages(
              db,
              projectId,
              evidence.run_id,
              evidence.id,
              imageInputs,
            );
            if (!created) throw new HttpError(404, "Run evidence not found");
            storedImages = created;
          } catch (error) {
            if (uploadedKeys.length > 0) {
              try {
                await attachmentsBucket.delete(uploadedKeys);
              } catch (cleanupError) {
                console.error(
                  JSON.stringify({
                    message: "evidence image cleanup failed",
                    error:
                      cleanupError instanceof Error
                        ? cleanupError.message
                        : String(cleanupError),
                    evidenceId: evidence.id,
                  }),
                );
              }
            }
            throw error;
          }
        }
      }
      return json({
        runId: evidence.run_id,
        attempt: evidence.attempt,
        key: evidence.evidence_key,
        stage: evidence.workflow_stage,
        type: evidence.evidence_type,
        status: evidence.status,
        images: storedImages.map(evidenceImageJson),
      });
    } catch (error) {
      if (
        error instanceof EventKeyConflictError ||
        error instanceof HuntTransitionError
      ) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  if (pathname === "/run-events" && request.method === "POST") {
    const parsed = decodeRunEvent(await readJson(request));
    const projectId = parsed.runId
      ? (await requireActiveWorkerRunClaim(db, request, parsed.runId)).projectId
      : await requireAgentProject(db, request);
    const run = parsed.runId
      ? await getHuntRunForProject(db, projectId, parsed.runId)
      : null;
    if (parsed.runId && !run) throw new HttpError(404, "Run not found");
    assertRunEventIdentityNotOverridden({
      run,
      source: parsed.source,
      sourceKey: parsed.sourceKey,
    });
    const source = parsed.source ?? run?.source;
    const sourceKey = parsed.sourceKey ?? run?.source_key;
    const title = parsed.title ?? run?.title;
    if (!source || !sourceKey || !title) {
      throw new HttpError(400, "Run identity is incomplete");
    }
    if (
      !parsed.runId &&
      isReservedProposalIssueSourceKey(sourceKey)
    ) {
      throw new HttpError(403, "Run identity is reserved for proposal approval");
    }
    const input = {
      ...parsed,
      source,
      sourceKey,
      title,
      stage: dashboardStageForProgress(
        parsed.status,
        parsed.workflowStage ?? null,
      ),
      workflowStage: parsed.workflowStage ?? null,
      occurredAt: new Date(parsed.occurredAt).toISOString(),
      detail: parsed.detail ?? null,
      priority: parsed.priority ?? null,
      branch: parsed.branch ?? null,
      commitSha: parsed.commitSha ?? null,
      tracker: parsed.tracker
        ? {
            provider: parsed.tracker.provider,
            issueId: parsed.tracker.issueId ?? null,
            identifier: parsed.tracker.identifier ?? null,
            url: parsed.tracker.url ?? null,
            state: parsed.tracker.state ?? null,
          }
        : null,
      issueDescription: parsed.issueDescription ?? null,
      resultSummary: parsed.resultSummary ?? null,
      structuredResult: parsed.structuredResult ?? null,
      targetSha: parsed.targetSha ?? null,
      sourceCreatedAt: parsed.sourceCreatedAt
        ? new Date(parsed.sourceCreatedAt).toISOString()
        : null,
      qaStatus: null,
      stagingQaDetail: null,
      productionQaDetail: null,
      context: parsed.context ?? null,
    };
    try {
      const claimToken = request.headers.get("x-briar-claim-token");
      await assertQueuedHuntClaim(
        db,
        projectId,
        input,
        claimToken?.startsWith("briar_claim_")
          ? await sha256(claimToken)
          : null,
        new Date().toISOString(),
      );
      const runId = await recordHuntEvent(db, projectId, input);
      if (input.status === "completed" && run?.worker_id) {
        const project = await db
          .prepare(`select organization_id from briar_projects where id = ?`)
          .bind(projectId)
          .first<{ organization_id: string }>();
        if (project) {
          await auditExecutionEvent(db, {
            organizationId: project.organization_id,
            projectId,
            runId,
            workerId: run.worker_id,
            agentId: run.agent_id,
            action: "completed",
            detail: { eventKey: input.eventKey },
            occurredAt: input.occurredAt,
          });
        }
      }
      return json({
        runId,
        status: input.status,
        workflowStage: input.workflowStage,
      });
    } catch (error) {
      if (error instanceof EventKeyConflictError) {
        throw new HttpError(409, error.message);
      }
      if (error instanceof HuntTransitionError) {
        throw new HttpError(409, error.message);
      }
      if (error instanceof HuntClaimError) {
        throw new HttpError(409, error.message);
      }
      throw error;
    }
  }

  return undefined;
}
