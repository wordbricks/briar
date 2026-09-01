import {
  isRepositoryWorkflowPending,
  normalizeAutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import { sha256 } from "./crypto-digest";
import {
  claimDueProjectAgentScheduleRun,
  completeProjectAgentScheduleRun,
  createProjectAgentSchedule,
  deleteProjectAgentSchedule,
  listClaimableProjectAgentScheduleProjectIds,
  listProjectAgentScheduleRuns,
  listProjectAgentSchedules,
  renewProjectAgentScheduleRunLease,
  updateProjectAgentSchedule,
} from "./project-agent-schedule-repository";
import { decodeProjectAgentScheduleInput } from "./project-request-contract";
import { getProjectSettings } from "./project-settings-repository";
import { decodeProjectAgentScheduleRunCompletion } from "./worker-request-contract";

type ScheduleWrite = ReturnType<typeof decodeProjectAgentScheduleInput>;
type ScheduleCompletion = ReturnType<typeof decodeProjectAgentScheduleRunCompletion>;

export type ProjectAgentScheduleApplicationErrorReason =
  | "agent_not_found"
  | "claim_inactive"
  | "schedule_not_found"
  | "schedule_run_active";

export class ProjectAgentScheduleApplicationError extends Error {
  readonly name = "ProjectAgentScheduleApplicationError";

  constructor(
    readonly reason: ProjectAgentScheduleApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export async function listProjectAgentSchedulesApplication(db: D1Database, projectId: string) {
  return listProjectAgentSchedules(db, projectId);
}

export async function createProjectAgentScheduleApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly userId: string;
  readonly write: ScheduleWrite;
}) {
  const schedule = await createProjectAgentSchedule(input.db, input.projectId, {
    ...input.write,
    createdByUserId: input.userId,
  });
  if (!schedule) {
    throw new ProjectAgentScheduleApplicationError("agent_not_found", "Project agent not found");
  }
  return schedule;
}

export async function updateProjectAgentScheduleApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly scheduleId: string;
  readonly write: ScheduleWrite;
}) {
  const schedule = await updateProjectAgentSchedule(
    input.db,
    input.projectId,
    input.scheduleId,
    input.write,
  );
  if (!schedule) {
    throw new ProjectAgentScheduleApplicationError(
      "schedule_not_found",
      "Project agent schedule not found",
    );
  }
  return schedule;
}

export async function deleteProjectAgentScheduleApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly scheduleId: string;
}) {
  const result = await deleteProjectAgentSchedule(input.db, input.projectId, input.scheduleId);
  if (result === "running") {
    throw new ProjectAgentScheduleApplicationError(
      "schedule_run_active",
      "A schedule run is currently active",
    );
  }
  return result === "deleted";
}

export async function listProjectAgentScheduleRunsApplication(db: D1Database, projectId: string) {
  return listProjectAgentScheduleRuns(db, projectId);
}

export async function claimProjectAgentScheduleRunApplication(input: {
  readonly db: D1Database;
  readonly userId: string;
  readonly projectIds: readonly string[];
}) {
  const observedAt = new Date().toISOString();
  const projectIds = await listClaimableProjectAgentScheduleProjectIds(
    input.db,
    input.userId,
    input.projectIds,
    observedAt,
  );
  for (const projectId of projectIds) {
    const settings = await getProjectSettings(input.db, projectId);
    const workflow = normalizeAutoHuntWorkflow(
      settings?.workflow_json ? JSON.parse(settings.workflow_json) : null,
    );
    if (isRepositoryWorkflowPending(workflow)) continue;
    const claimToken = `briar_schedule_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const run = await claimDueProjectAgentScheduleRun(input.db, projectId, {
      claimTokenHash: await sha256(claimToken),
      observedAt,
    });
    if (!run) continue;
    return { run, claimToken };
  }
  return null;
}

export async function completeProjectAgentScheduleRunApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly runId: string;
  readonly completion: ScheduleCompletion;
}) {
  const run = await completeProjectAgentScheduleRun(input.db, input.projectId, input.runId, {
    claimTokenHash: await sha256(input.completion.claimToken),
    status: input.completion.status,
    resultSummary: input.completion.resultSummary ?? null,
    structuredResult: input.completion.structuredResult,
    error: input.completion.error ?? null,
    observedAt: new Date().toISOString(),
  });
  if (!run) {
    throw new ProjectAgentScheduleApplicationError(
      "claim_inactive",
      "Schedule run claim is no longer active",
    );
  }
  return run;
}

export async function renewProjectAgentScheduleRunApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly runId: string;
  readonly claimToken: string;
}) {
  const run = await renewProjectAgentScheduleRunLease(input.db, input.projectId, input.runId, {
    claimTokenHash: await sha256(input.claimToken),
    observedAt: new Date().toISOString(),
  });
  if (!run) {
    throw new ProjectAgentScheduleApplicationError(
      "claim_inactive",
      "Schedule run claim is no longer active",
    );
  }
  return run;
}
