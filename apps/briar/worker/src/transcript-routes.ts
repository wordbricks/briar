import * as Option from "effect/Option";
import {
  ingestAgentTranscript,
  listAgentTranscriptSegments,
  readAgentWorkLog,
  readLatestAgentWorkLogForRun,
  readRawTranscriptSegment,
  workLogEntryTranscriptEvent,
  type AgentTranscriptSegmentRow,
} from "./agent-worklog";
import { readArchivedWorkLog, readLatestArchivedWorkLogForRun } from "./archive";
import { contentDisposition } from "./attachment-storage";
import { sha256 } from "./crypto-digest";
import {
  getRunExecutionAttempt,
  recordRunCostRecords,
  recordRunUsageRecords,
  type RunExecutionAttemptRow,
  updateHuntRunExecutionMetrics,
} from "./db";
import { HttpError, json } from "./http-response";
import { decodeUuidOption } from "./query-contract";
import { readTranscriptRequest } from "./request-readers";
import { type TranscriptRequest } from "./transcript-request";
import { pendingExecutionWorkerUpdate } from "./worker-update-repository";

export type TranscriptRouteInput = {
  request: Request;
  url: URL;
  db: D1Database;
  env: Env;
  requireAgentProject: () => Promise<string>;
  requireWorkerProjectBinding: (projectId: string, workerId?: string) => Promise<{
    principal: { deviceId: string; organizationId: string };
    binding: { id: string };
  }>;
  requireRunExecutionProject: (runId: string) => Promise<string>;
  requireProjectAccess: (projectId: string) => Promise<void>;
};

const bearerToken = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
};

/**
 * The detached issue worker sends one metrics-only request after the agent has
 * recorded the terminal run event. Keep that narrow compatibility window
 * separate from ordinary transcript writes so a completed run cannot become
 * a general-purpose late-write channel.
 */
const isFinalExecutionMetricsPayload = (input: TranscriptRequest) => {
  if (
    input.workType !== "issue" ||
    !input.runId ||
    input.workId !== input.runId ||
    !input.executionId ||
    input.runAttempt === undefined ||
    input.executionMetrics === undefined ||
    input.events.length !== 1
  ) {
    return false;
  }
  const [event] = input.events;
  if (event.direction !== "server") return false;
  if (!event.payload || typeof event.payload !== "object") return false;
  const payload = event.payload as Record<string, unknown>;
  return payload.type === "execution.metrics" &&
    JSON.stringify(payload.executionMetrics) ===
      JSON.stringify(input.executionMetrics);
};

export async function handleTranscriptRoute(
  routeInput: TranscriptRouteInput,
): Promise<Response | undefined> {
  const { request, url, db, env } = routeInput;
  const { pathname } = url;
  const auth: unknown = undefined;
  const requireAgentProject = (_db: D1Database, _request: Request) =>
    routeInput.requireAgentProject();
  const requireWorkerProjectBinding = (
    _db: D1Database,
    _request: Request,
    projectId: string,
    workerId?: string,
  ) => routeInput.requireWorkerProjectBinding(projectId, workerId);
  const requireRunExecutionProject = (
    _db: D1Database,
    _request: Request,
    runId: string,
  ) => routeInput.requireRunExecutionProject(runId);
  const requireProjectAccess = (
    _auth: unknown,
    _db: D1Database,
    _request: Request,
    projectId: string,
  ) => routeInput.requireProjectAccess(projectId);

  if (pathname === "/transcripts" && request.method === "POST") {
    const input = await readTranscriptRequest(request);
    const recordedAt = new Date().toISOString();
    // Direct Project Agent tasks use their task UUID as the transcript session
    // key, but that UUID is not a Hunt run. Older Workers included it in the
    // compatibility runId field, so normalize it before run authorization and
    // persistence instead of rejecting otherwise valid task transcripts.
    const transcriptRunId = input.workType === "projectAgentTask"
      ? null
      : input.runId ?? null;
    let authenticatedWorkerId: string | null = null;
    let authenticatedWorkerDeviceId: string | null = null;
    let authenticatedWorkerOrganizationId: string | null = null;
    let authenticatedExecutionAttempt: RunExecutionAttemptRow | null = null;
    const projectId = bearerToken(request).startsWith("briar_worker_")
      ? (() => {
          if (!input.projectId) {
            throw new HttpError(400, "projectId is required for worker transcripts");
          }
          return input.projectId;
        })()
      : await requireAgentProject(db, request);
    if (bearerToken(request).startsWith("briar_worker_")) {
      const worker = await requireWorkerProjectBinding(
        db,
        request,
        projectId,
        input.workerId ?? undefined,
      );
      authenticatedWorkerId = worker.binding.id;
      authenticatedWorkerDeviceId = worker.principal.deviceId;
      authenticatedWorkerOrganizationId = worker.principal.organizationId;
      if (input.executionId) {
        authenticatedExecutionAttempt = await getRunExecutionAttempt(
          db,
          input.executionId,
        );
        if (
          !authenticatedExecutionAttempt ||
          authenticatedExecutionAttempt.project_id !== projectId ||
          authenticatedExecutionAttempt.worker_id !== authenticatedWorkerId ||
          authenticatedExecutionAttempt.run_id !== input.runId
        ) {
          throw new HttpError(403, "Execution attempt is not assigned to this worker");
        }
        if (
          input.runAttempt !== undefined &&
          input.runAttempt !== authenticatedExecutionAttempt.run_attempt
        ) {
          throw new HttpError(409, "Execution attempt does not match runAttempt");
        }
      } else if (
        transcriptRunId &&
        (await requireRunExecutionProject(db, request, transcriptRunId)) !==
          projectId
      ) {
        throw new HttpError(403, "Run is not assigned to this worker");
      }
    }
    if (input.executionId && !authenticatedExecutionAttempt) {
      throw new HttpError(403, "Only execution workers can report an execution");
    }
    const hasWorkerClaimIdentity = Boolean(
      input.claimToken || input.workType || input.workId,
    );
    if (authenticatedWorkerDeviceId && !hasWorkerClaimIdentity) {
      const pendingUpdate = await pendingExecutionWorkerUpdate(
        db,
        authenticatedWorkerDeviceId,
      );
      if (pendingUpdate && pendingUpdate.handoffState !== "idle") {
        throw new HttpError(
          409,
          "Worker transcript claim identity is required during a planned update",
        );
      }
    }
    if (input.claimToken || input.workType || input.workId) {
      if (
        !authenticatedWorkerId ||
        !authenticatedWorkerDeviceId ||
        !input.claimToken ||
        !input.workType ||
        !input.workId
      ) {
        throw new HttpError(400, "Worker transcript claim identity is incomplete");
      }
      const claimTokenHash = await sha256(input.claimToken);
      let active = input.workType === "issue"
        ? await db
            .prepare(
              `select 1 as active
               from briar_hunt_runs
               where id = ? and project_id = ? and worker_id = ?
                 and claim_token_hash = ? and lease_expires_at > ?
                 and status not in
                   ('backlog', 'completed', 'cancelled', 'blocked', 'failed')
                 and (
                   ? = 0
                   or (current_attempt = ? and last_execution_id = ?)
                 )`,
            )
            .bind(
              input.workId,
              projectId,
              authenticatedWorkerId,
              claimTokenHash,
              recordedAt,
              input.executionId && input.runAttempt !== undefined ? 1 : 0,
              input.runAttempt ?? 0,
              input.executionId ?? "",
            )
            .first<{ active: number }>()
        : input.workType === "projectAgentTask"
          ? await db
              .prepare(
                `select 1 as active
                 from briar_project_agent_task_jobs
                 where id = ? and project_id = ? and status = 'running'
                   and claimed_worker_id = ? and claim_token_hash = ?
                   and lease_expires_at > ?`,
              )
              .bind(
                input.workId,
                projectId,
                authenticatedWorkerId,
                claimTokenHash,
                recordedAt,
              )
              .first<{ active: number }>()
          : input.workType === "issueReply"
            ? await db
                .prepare(
                  `select 1 as active
                   from briar_issue_agent_reply_jobs
                   where id = ? and project_id = ? and status = 'running'
                     and claimed_worker_id = ? and claim_token_hash = ?
                     and lease_expires_at > ?`,
                )
                .bind(
                  input.workId,
                  projectId,
                  authenticatedWorkerId,
                  claimTokenHash,
                  recordedAt,
                )
                .first<{ active: number }>()
            : await db
                .prepare(
                  `select 1 as active
                   from briar_channel_agent_reply_jobs
                   where id = ? and organization_id = ? and status = 'running'
                     and claimed_device_id = ? and claimed_worker_id = ?
                     and claim_token_hash = ? and lease_expires_at > ?`,
                )
                .bind(
                  input.workId,
                  authenticatedWorkerOrganizationId,
                  authenticatedWorkerDeviceId,
                  authenticatedWorkerId,
                  claimTokenHash,
                  recordedAt,
                )
                .first<{ active: number }>();
      if (!active && isFinalExecutionMetricsPayload(input)) {
        active = await db
          .prepare(
            `select 1 as active
             from briar_hunt_runs
             where id = ? and project_id = ? and worker_id = ?
               and claim_token_hash = ? and status = 'completed'
               and current_attempt = ? and last_execution_id = ?
               and claimed_at is not null and lease_expires_at is not null
               and completed_at is not null
               and completed_at >= claimed_at
               and completed_at < lease_expires_at
               and completed_at <= ?`,
          )
          .bind(
            input.workId,
            projectId,
            authenticatedWorkerId,
            claimTokenHash,
            input.runAttempt,
            input.executionId,
            recordedAt,
          )
          .first<{ active: number }>();
      }
      if (!active) {
        throw new HttpError(409, "Worker claim is no longer active");
      }
    }
    if (
      input.executionMetrics &&
      (!authenticatedWorkerId || !input.runId || !input.runAttempt)
    ) {
      throw new HttpError(403, "Only execution workers can report run metrics");
    }
    if (authenticatedExecutionAttempt) {
      const clockSkewMs = 5 * 60_000;
      const earliestObservedAt =
        Date.parse(authenticatedExecutionAttempt.claimed_at) - clockSkewMs;
      const latestObservedAt = Date.parse(recordedAt) + clockSkewMs;
      if (
        input.usageRecords?.some((record) => {
          const observedAt = Date.parse(record.observedAt);
          return observedAt < earliestObservedAt || observedAt > latestObservedAt;
        })
      ) {
        throw new HttpError(
          400,
          "Usage observedAt is outside the execution attempt window",
        );
      }
      if (
        input.costRecords?.some((record) => {
          const observedAt = Date.parse(record.observedAt);
          return observedAt < earliestObservedAt || observedAt > latestObservedAt;
        })
      ) {
        throw new HttpError(
          400,
          "Cost observedAt is outside the execution attempt window",
        );
      }
    }
    const usageStored = input.usageRecords
      ? await recordRunUsageRecords(db, {
          executionId: input.executionId!,
          records: input.usageRecords,
          recordedAt,
        })
      : 0;
    const costStored = input.costRecords
      ? await recordRunCostRecords(db, {
          executionId: input.executionId!,
          records: input.costRecords,
          recordedAt,
        })
      : 0;
    const result = await ingestAgentTranscript(db, env.ARCHIVES, projectId, {
      sessionId: input.sessionId,
      runId: transcriptRunId,
      workerId: authenticatedWorkerId ?? input.workerId ?? null,
      agentProvider: input.agentProvider,
      events: input.events,
      observedAt: recordedAt,
    });
    if (input.executionMetrics) {
      await updateHuntRunExecutionMetrics(db, projectId, {
        runId: input.runId!,
        attempt: input.runAttempt!,
        workerId: authenticatedWorkerId!,
        executionId: input.executionId,
        metrics: input.executionMetrics,
      });
    }
    return json({ ...result, usageStored, costStored }, 202);
  }

  const transcriptMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/sessions\/([A-Za-z0-9_-]+)\/transcript$/u,
  );
  if (transcriptMatch && request.method === "GET") {
    const projectId = transcriptMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const requestedSessionId = transcriptMatch[2];
    const detachedRunId = requestedSessionId.startsWith("detached-")
      ? decodeUuidOption(requestedSessionId.slice("detached-".length))
      : Option.none<string>();
    const hotWorkLog = Option.isSome(detachedRunId)
      ? await readLatestAgentWorkLogForRun(db, projectId, detachedRunId.value)
      : await readAgentWorkLog(db, projectId, requestedSessionId);
    const workLog = hotWorkLog && hotWorkLog.entries.length > 0
      ? hotWorkLog
      : Option.isSome(detachedRunId)
        ? await readLatestArchivedWorkLogForRun(
            db,
            env.ARCHIVES,
            projectId,
            detachedRunId.value,
          )
        : await readArchivedWorkLog(
            db,
            env.ARCHIVES,
            projectId,
            requestedSessionId,
          );
    if (!workLog || workLog.entries.length === 0) {
      throw new HttpError(404, "Transcript not found");
    }
    return json({
      session: {
        sessionId: workLog.session.session_id,
        runId: workLog.session.run_id,
        workerId: workLog.session.worker_id,
        agentProvider: workLog.session.agent_provider,
        startedAt: workLog.session.started_at,
        lastEventAt: workLog.session.last_event_at,
        eventCount: workLog.entries.length,
        projection: "worklog",
      },
      // Work-log entries are a bounded snapshot. Returning the full set on
      // each live poll lets an upsert replace a writing entry in-place.
      events: workLog.entries.map((entry) => ({
        sequence: entry.sequence,
        direction: "server" as const,
        message: {
          type: "event",
          event: workLogEntryTranscriptEvent(entry),
        },
        recordedAt: entry.updated_at,
      })),
    });
  }

  const rawTranscriptSegmentMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/sessions\/([A-Za-z0-9_-]+)\/raw-transcript\/(\d+)-(\d+)$/u,
  );
  const rawTranscriptMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/sessions\/([A-Za-z0-9_-]+)\/raw-transcript$/u,
  );
  if (
    rawTranscriptSegmentMatch && request.method === "GET"
  ) {
    const projectId = rawTranscriptSegmentMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const requestedSessionId = rawTranscriptSegmentMatch[2];
    const detachedRunId = requestedSessionId.startsWith("detached-")
      ? decodeUuidOption(requestedSessionId.slice("detached-".length))
      : Option.none<string>();
    const hotWorkLog = Option.isSome(detachedRunId)
      ? await readLatestAgentWorkLogForRun(db, projectId, detachedRunId.value)
      : await readAgentWorkLog(db, projectId, requestedSessionId);
    const workLog = hotWorkLog ?? (Option.isSome(detachedRunId)
      ? await readLatestArchivedWorkLogForRun(
          db,
          env.ARCHIVES,
          projectId,
          detachedRunId.value,
        )
      : await readArchivedWorkLog(
          db,
          env.ARCHIVES,
          projectId,
          requestedSessionId,
        ));
    if (!workLog) throw new HttpError(404, "Transcript not found");
    const segments = "segments" in workLog
      ? workLog.segments as AgentTranscriptSegmentRow[]
      : await listAgentTranscriptSegments(
          db,
          projectId,
          workLog.session.session_id,
        );
    const firstSequence = Number(rawTranscriptSegmentMatch[3]);
    const lastSequence = Number(rawTranscriptSegmentMatch[4]);
    const segment = segments?.find((candidate) =>
      candidate.first_sequence === firstSequence &&
      candidate.last_sequence === lastSequence
    );
    if (!segment) throw new HttpError(404, "Transcript segment not found");
    const object = await readRawTranscriptSegment(env.ARCHIVES, segment);
    if (!object) throw new HttpError(404, "Transcript segment not found");
    return new Response(object.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": contentDisposition(object.filename).replace(
          /^inline;/u,
          "attachment;",
        ),
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (rawTranscriptMatch && request.method === "GET") {
    const projectId = rawTranscriptMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const requestedSessionId = rawTranscriptMatch[2];
    const detachedRunId = requestedSessionId.startsWith("detached-")
      ? decodeUuidOption(requestedSessionId.slice("detached-".length))
      : Option.none<string>();
    const hotWorkLog = Option.isSome(detachedRunId)
      ? await readLatestAgentWorkLogForRun(db, projectId, detachedRunId.value)
      : await readAgentWorkLog(db, projectId, requestedSessionId);
    const workLog = hotWorkLog ?? (Option.isSome(detachedRunId)
      ? await readLatestArchivedWorkLogForRun(
          db,
          env.ARCHIVES,
          projectId,
          detachedRunId.value,
        )
      : await readArchivedWorkLog(
          db,
          env.ARCHIVES,
          projectId,
          requestedSessionId,
        ));
    if (!workLog) throw new HttpError(404, "Transcript not found");
    const segments = "segments" in workLog
      ? workLog.segments as AgentTranscriptSegmentRow[]
      : await listAgentTranscriptSegments(
          db,
          projectId,
          workLog.session.session_id,
        );
    if (!segments || segments.length === 0) {
      throw new HttpError(404, "Transcript not found");
    }
    return json({
      sessionId: workLog.session.session_id,
      runId: workLog.session.run_id,
      agentProvider: workLog.session.agent_provider,
      eventCount: segments.reduce(
        (total, segment) => total + segment.event_count,
        0,
      ),
      uncompressedBytes: segments.reduce(
        (total, segment) => total + segment.uncompressed_bytes,
        0,
      ),
      compressedBytes: segments.reduce(
        (total, segment) => total + segment.compressed_bytes,
        0,
      ),
      segments: segments.map((segment) => ({
        firstSequence: segment.first_sequence,
        lastSequence: segment.last_sequence,
        eventCount: segment.event_count,
        uncompressedBytes: segment.uncompressed_bytes,
        compressedBytes: segment.compressed_bytes,
        sha256: segment.sha256,
        recordedAt: segment.recorded_at,
        url:
          `/projects/${projectId}/sessions/${requestedSessionId}/raw-transcript/` +
          `${segment.first_sequence}-${segment.last_sequence}`,
      })),
    });
  }

  return undefined;
}
