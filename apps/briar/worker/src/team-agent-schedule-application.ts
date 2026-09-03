import {
  isRepositoryWorkflowPending,
  normalizeAutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import { sha256 } from "./crypto-digest";
import {
  claimDueTeamAgentScheduleRun,
  completeTeamAgentScheduleRun,
  createTeamAgentSchedule,
  deleteTeamAgentSchedule,
  listClaimableTeamAgentScheduleTeamIds,
  listTeamAgentScheduleRuns,
  listTeamAgentSchedules,
  renewTeamAgentScheduleRunLease,
  updateTeamAgentSchedule,
} from "./team-agent-schedule-repository";
import { decodeTeamAgentScheduleInput } from "./team-request-contract";
import { getTeamSettings } from "./team-settings-repository";
import { decodeProjectAgentScheduleRunCompletion } from "./worker-request-contract";

type ScheduleWrite = ReturnType<typeof decodeTeamAgentScheduleInput>;
type ScheduleCompletion = ReturnType<typeof decodeProjectAgentScheduleRunCompletion>;

export type TeamAgentScheduleApplicationErrorReason =
  | "agent_not_found"
  | "claim_inactive"
  | "schedule_not_found"
  | "schedule_run_active";

export class TeamAgentScheduleApplicationError extends Error {
  readonly name = "TeamAgentScheduleApplicationError";

  constructor(
    readonly reason: TeamAgentScheduleApplicationErrorReason,
    message: string,
  ) {
    super(message);
  }
}

export async function listTeamAgentSchedulesApplication(db: D1Database, projectId: string) {
  return listTeamAgentSchedules(db, projectId);
}

export async function createTeamAgentScheduleApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly userId: string;
  readonly write: ScheduleWrite;
}) {
  const schedule = await createTeamAgentSchedule(input.db, input.projectId, {
    ...input.write,
    createdByUserId: input.userId,
  });
  if (!schedule) {
    throw new TeamAgentScheduleApplicationError("agent_not_found", "Project agent not found");
  }
  return schedule;
}

export async function updateTeamAgentScheduleApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly scheduleId: string;
  readonly write: ScheduleWrite;
}) {
  const schedule = await updateTeamAgentSchedule(
    input.db,
    input.projectId,
    input.scheduleId,
    input.write,
  );
  if (!schedule) {
    throw new TeamAgentScheduleApplicationError(
      "schedule_not_found",
      "Project agent schedule not found",
    );
  }
  return schedule;
}

export async function deleteTeamAgentScheduleApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly scheduleId: string;
}) {
  const result = await deleteTeamAgentSchedule(input.db, input.projectId, input.scheduleId);
  if (result === "running") {
    throw new TeamAgentScheduleApplicationError(
      "schedule_run_active",
      "A schedule run is currently active",
    );
  }
  return result === "deleted";
}

export async function listTeamAgentScheduleRunsApplication(db: D1Database, projectId: string) {
  return listTeamAgentScheduleRuns(db, projectId);
}

export async function claimTeamAgentScheduleRunApplication(input: {
  readonly db: D1Database;
  readonly userId: string;
  readonly projectIds: readonly string[];
}) {
  const observedAt = new Date().toISOString();
  const projectIds = await listClaimableTeamAgentScheduleTeamIds(
    input.db,
    input.userId,
    input.projectIds,
    observedAt,
  );
  for (const projectId of projectIds) {
    const settings = await getTeamSettings(input.db, projectId);
    const workflow = normalizeAutoHuntWorkflow(
      settings?.workflow_json ? JSON.parse(settings.workflow_json) : null,
    );
    if (isRepositoryWorkflowPending(workflow)) continue;
    const claimToken = `briar_schedule_claim_${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
    const run = await claimDueTeamAgentScheduleRun(input.db, projectId, {
      claimTokenHash: await sha256(claimToken),
      observedAt,
    });
    if (!run) continue;
    return { run, claimToken };
  }
  return null;
}

export async function completeTeamAgentScheduleRunApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly runId: string;
  readonly completion: ScheduleCompletion;
}) {
  const run = await completeTeamAgentScheduleRun(input.db, input.projectId, input.runId, {
    claimTokenHash: await sha256(input.completion.claimToken),
    status: input.completion.status,
    resultSummary: input.completion.resultSummary ?? null,
    structuredResult: input.completion.structuredResult,
    error: input.completion.error ?? null,
    observedAt: new Date().toISOString(),
  });
  if (!run) {
    throw new TeamAgentScheduleApplicationError(
      "claim_inactive",
      "Schedule run claim is no longer active",
    );
  }
  return run;
}

export async function renewTeamAgentScheduleRunApplication(input: {
  readonly db: D1Database;
  readonly projectId: string;
  readonly runId: string;
  readonly claimToken: string;
}) {
  const run = await renewTeamAgentScheduleRunLease(input.db, input.projectId, input.runId, {
    claimTokenHash: await sha256(input.claimToken),
    observedAt: new Date().toISOString(),
  });
  if (!run) {
    throw new TeamAgentScheduleApplicationError(
      "claim_inactive",
      "Schedule run claim is no longer active",
    );
  }
  return run;
}
