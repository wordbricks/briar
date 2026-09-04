import type {
  AutoHuntDispatchGroup_Serialize,
} from "../../generated/tauri";
import type { AutoHuntWorkerResult } from "../../lib/auto-hunt-agent";
import type {
  AutoHuntSession,
  AutoHuntSessionEventType,
  AutoHuntSessionIssueOutcome,
  HuntRun,
} from "../../types";

/*
  The pure rules an agent session obeys, with no atom and no React in sight.

  They were the top half of `hooks/useAutoHuntSessions.ts`, and half of the app
  imported the hook module for them alone. `state/sync/apply.ts` applies them to
  the store, the actions call them before writing, and the views that only need
  to ask a question about a session ("can this one be stopped?") import them
  without pulling in the store at all.

  Every function here returns the session instance it was given when nothing
  changed. That is what keeps `agentSessionAtom(id)` quiet for the sessions a
  reconciliation pass looked at and left alone.
*/

/**
 * Drops the sessions another session names as its parent, so a task and the
 * worker dispatch it spawned render as one row rather than two.
 */
export function collapseLinkedAutoHuntSessions(
  sessions: readonly AutoHuntSession[],
) {
  const parentSessionIds = new Set(
    sessions.flatMap((session) =>
      session.parentSessionId ? [session.parentSessionId] : [],
    ),
  );
  return sessions.filter((session) => !parentSessionIds.has(session.id));
}

/*
  Remote worker task sessions run on an execution worker, so the desktop stop
  command cannot reach them. The app server cancels the queued job instead,
  which is why they keep a stop control even though `localOwner` is false.
*/
export function isRemoteAutoHuntTaskSession(
  session: Pick<AutoHuntSession, "localOwner" | "sessionType">,
) {
  return session.localOwner === false && session.sessionType === "task";
}

export function canStopAutoHuntSession(
  session: Pick<
    AutoHuntSession,
    "localOwner" | "sessionType" | "requestedWorkerId" | "workerId"
  >,
) {
  if (!isRemoteAutoHuntTaskSession(session)) return session.localOwner !== false;
  return Boolean(session.workerId ?? session.requestedWorkerId);
}

/** One entry of a session's timeline. */
export function agentSessionEvent(
  type: AutoHuntSessionEventType,
  occurredAt: string,
) {
  return { id: crypto.randomUUID(), type, occurredAt };
}

function outcomeForWorker(
  status: AutoHuntDispatchGroup_Serialize["workers"][number]["status"],
): AutoHuntSessionIssueOutcome {
  if (status === "completed" || status === "blocked" || status === "failed") {
    return status;
  }
  if (status === "cancelled") return "skipped";
  return "pending";
}

/** Folds a native dispatch group back into the session that started it. */
export function reconcileDispatchSession(
  session: AutoHuntSession,
  dispatch: AutoHuntDispatchGroup_Serialize,
): AutoHuntSession {
  const workers: AutoHuntWorkerResult[] = dispatch.workers.map((worker) => ({
    sessionId: worker.sessionId,
    runId: worker.runId,
    sourceKey: worker.sourceKey,
    conversationId: worker.conversationId,
    workspaceRoot: worker.workspaceRoot,
    outcome: worker.status === "cancelled"
      ? "cancelled"
      : outcomeForWorker(worker.status),
    summary: worker.summary ?? "",
    evidence: dispatch.events.flatMap((event) =>
      event.runId === worker.runId &&
        event.type === "worker_evidence" &&
        event.evidence
        ? [event.evidence]
        : []
    ),
  }));
  return {
    ...session,
    dispatchGroupId: dispatch.dispatchGroupId,
    status: dispatch.status,
    completedAt: dispatch.completedAt,
    error: dispatch.error,
    workers,
    dispatchEvents: dispatch.events,
    updatedAt: new Date().toISOString(),
    issues: session.issues.map((issue) => {
      const worker = dispatch.workers.find(
        (candidate) => candidate.runId === issue.runId,
      );
      return worker
        ? {
            ...issue,
            outcome: outcomeForWorker(worker.status),
            summary: worker.summary,
          }
        : issue;
    }),
  };
}

function issueOutcomeForRun(
  status: HuntRun["status"],
): AutoHuntSessionIssueOutcome {
  if (status === "completed" || status === "blocked" || status === "failed") {
    return status;
  }
  if (status === "cancelled") return "skipped";
  return "pending";
}

/**
 * Re-points a worker dispatch session at the runs that are on the board, and
 * completes it once every issue it dispatched reached a terminal outcome.
 */
export function reconcileWorkerDispatchSession(
  session: AutoHuntSession,
  runs: readonly HuntRun[],
  now = new Date().toISOString(),
): AutoHuntSession {
  if (session.sessionType !== "dispatch" || session.issues.length === 0) {
    return session;
  }
  const runsById = new Map(runs.map((run) => [run.id, run]));
  if (session.issues.some((issue) => !runsById.has(issue.runId))) {
    return session;
  }
  const issues = session.issues.map((issue) => {
    const run = runsById.get(issue.runId)!;
    return {
      ...issue,
      outcome: issueOutcomeForRun(run.status),
      summary: run.status === "completed"
        ? run.resultSummary
        : run.status === "blocked" || run.status === "failed"
        ? run.resultSummary ?? run.detail
        : issue.summary,
    };
  });
  const changed = issues.some((issue, index) =>
    issue.outcome !== session.issues[index]?.outcome ||
    issue.summary !== session.issues[index]?.summary
  );
  const isTerminal = issues.every((issue) => issue.outcome !== "pending");
  if (!changed && (!isTerminal || session.status !== "running")) return session;

  if (!isTerminal || session.status !== "running") {
    return { ...session, issues, updatedAt: now };
  }
  const summaries = issues.flatMap((issue) =>
    issue.summary ? [`${issue.sourceKey}: ${issue.summary}`] : []
  );
  return {
    ...session,
    issues,
    status: "completed",
    completedAt: now,
    summary: summaries.length > 0 ? summaries.join("\n\n") : null,
    error: null,
    updatedAt: now,
    events: [...session.events, agentSessionEvent("completed", now)],
  };
}

/** The identity a session has on the server: one project's session id. */
export function sessionSyncKey(
  session: Pick<AutoHuntSession, "projectId" | "id">,
) {
  return `${session.projectId}:${session.id}`;
}

/** Which of two copies of a session is the newer one. */
export function sessionVersion(session: Pick<AutoHuntSession, "updatedAt">) {
  return session.updatedAt;
}

/**
 * Merges server copies into the local list, newest `startedAt` first. A local
 * copy that is at least as new as the remote one wins outright; otherwise the
 * remote copy lands, keeping the detail only this device has.
 */
export function mergeSynchronizedSessions(
  localSessions: readonly AutoHuntSession[],
  remoteSessions: readonly AutoHuntSession[],
) {
  const merged = new Map(
    localSessions.map((session) => [sessionSyncKey(session), session]),
  );
  for (const remote of remoteSessions) {
    const key = sessionSyncKey(remote);
    const local = merged.get(key);
    if (local && sessionVersion(local) >= sessionVersion(remote)) continue;
    const preserveLocalDetail =
      remote.detailLoaded === false &&
      local?.detailLoaded !== false &&
      local?.localOwner !== false;
    merged.set(key, {
      ...remote,
      ...(preserveLocalDetail
        ? {
            request: local?.request ?? remote.request,
            followUps: local?.followUps ?? [],
            conversationId: local?.conversationId ?? null,
            summary: local?.summary ?? null,
            error: local?.error ?? null,
            events: local?.events ?? [],
            detailLoaded: true,
          }
        : {}),
      // A newer lightweight snapshot invalidates remote-owned detail. Local
      // owners retain their native detail, but remote sessions must fetch the
      // completed summary/events instead of presenting the older empty copy.
      localOwner: local?.localOwner ?? false,
      workspaceRoot: local?.workspaceRoot ?? null,
      dispatchEvents: local?.dispatchEvents ?? [],
      workers: local?.workers ?? [],
    });
  }
  return [...merged.values()].sort(
      (left, right) =>
        new Date(right.startedAt).getTime() -
        new Date(left.startedAt).getTime(),
  );
}

/**
 * Applies one project's server page: remote-owned sessions the page dropped go
 * away, local-owned ones never do, and `reset` replaces the project's remote
 * half wholesale.
 */
export function applyProjectAgentSessionSync(
  current: readonly AutoHuntSession[],
  projectId: string,
  remote: readonly AutoHuntSession[],
  deletedSessionIds: readonly string[],
  reset: boolean,
) {
  const deleted = new Set(deletedSessionIds);
  const retained = current.filter((session) => {
    if (session.projectId !== projectId || session.localOwner !== false) {
      return true;
    }
    if (reset) return false;
    return !deleted.has(session.id);
  });
  return mergeSynchronizedSessions(retained, remote);
}
