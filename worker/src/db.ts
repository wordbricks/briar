export type ProjectRow = {
  id: string;
  name: string;
  repository_path: string;
  created_at: string;
};

export type HuntRunRow = {
  id: string;
  run_number: number;
  source: string;
  source_key: string;
  title: string;
  stage: string;
  detail: string | null;
  repository: string;
  branch: string | null;
  commit_sha: string | null;
  started_at: string;
  completed_at: string | null;
  last_event_at: string;
};

export type HuntEventRow = {
  id: string;
  run_id: string;
  event_key: string;
  stage: string;
  detail: string | null;
  actor: string;
  branch: string | null;
  commit_sha: string | null;
  occurred_at: string;
};

export type HuntEventInput = {
  source: "issue" | "error" | "feedback";
  sourceKey: string;
  title: string;
  stage:
    | "queued"
    | "analyzing"
    | "implementing"
    | "pr_open"
    | "staging_qa"
    | "production_qa"
    | "completed"
    | "blocked"
    | "failed"
    | "cancelled";
  eventKey: string;
  occurredAt: string;
  actor: string;
  repository: string;
  detail: string | null;
  branch: string | null;
  commitSha: string | null;
};

export class EventKeyConflictError extends Error {
  constructor() {
    super("Event key was reused with different hunt data");
  }
}

export async function listProjects(db: D1Database, ownerUserId: string) {
  const result = await db
    .prepare(
      `select id, name, repository_path, created_at
       from briar_projects
       where owner_user_id = ?
       order by created_at`,
    )
    .bind(ownerUserId)
    .all<ProjectRow>();
  return result.results;
}

export async function createProject(
  db: D1Database,
  input: {
    ownerUserId: string;
    name: string;
    repositoryPath: string;
    agentTokenHash: string;
  },
) {
  const project: ProjectRow = {
    id: crypto.randomUUID(),
    name: input.name,
    repository_path: input.repositoryPath,
    created_at: new Date().toISOString(),
  };
  await db
    .prepare(
      `insert into briar_projects (
         id, owner_user_id, name, repository_path, agent_token_hash,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      project.id,
      input.ownerUserId,
      project.name,
      project.repository_path,
      input.agentTokenHash,
      project.created_at,
      project.created_at,
    )
    .run();
  return project;
}

export async function getProject(
  db: D1Database,
  projectId: string,
  ownerUserId: string,
) {
  return await db
    .prepare(
      `select id, name, repository_path, created_at
       from briar_projects
       where id = ? and owner_user_id = ?`,
    )
    .bind(projectId, ownerUserId)
    .first<ProjectRow>();
}

export async function listDashboardRuns(db: D1Database, projectId: string) {
  const runs = await db
    .prepare(
      `select id, run_number, source, source_key, title, stage, detail,
              repository, branch, commit_sha, started_at, completed_at,
              last_event_at
       from briar_hunt_runs
       where project_id = ?
       order by last_event_at desc
       limit 200`,
    )
    .bind(projectId)
    .all<HuntRunRow>();

  const events = await db
    .prepare(
      `select event.id, event.run_id, event.event_key, event.stage,
              event.detail, event.actor, event.branch, event.commit_sha,
              event.occurred_at
       from briar_hunt_events event
       join briar_hunt_runs run on run.id = event.run_id
       where run.project_id = ?
         and run.id in (
           select id from briar_hunt_runs
           where project_id = ?
           order by last_event_at desc
           limit 200
         )
       order by event.occurred_at desc, event.id desc`,
    )
    .bind(projectId, projectId)
    .all<HuntEventRow>();

  return { runs: runs.results, events: events.results };
}

export async function findProjectIdByAgentTokenHash(
  db: D1Database,
  agentTokenHash: string,
) {
  return await db
    .prepare("select id from briar_projects where agent_token_hash = ?")
    .bind(agentTokenHash)
    .first<string>("id");
}

const digestRunId = async (
  projectId: string,
  source: HuntEventInput["source"],
  sourceKey: string,
) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${projectId}\u0000${source}\u0000${sourceKey}`),
    ),
  );
  const hex = [...digest.slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

const sameEvent = (row: HuntEventRow, input: HuntEventInput) =>
  row.stage === input.stage &&
  row.detail === input.detail &&
  row.actor === input.actor &&
  row.branch === input.branch &&
  row.commit_sha === input.commitSha &&
  row.occurred_at === input.occurredAt;

export async function recordHuntEvent(
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) {
  const existingRunId = await db
    .prepare(
      `select id from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?`,
    )
    .bind(projectId, input.source, input.sourceKey)
    .first<string>("id");
  const runId =
    existingRunId ??
    (await digestRunId(projectId, input.source, input.sourceKey));
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const completedAt =
    input.stage === "completed" || input.stage === "cancelled"
      ? input.occurredAt
      : null;

  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, detail,
           repository, branch, commit_sha, started_at, completed_at,
           last_event_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(project_id, source, source_key) do nothing`,
      )
      .bind(
        runId,
        projectId,
        input.source,
        input.sourceKey,
        input.title,
        input.stage,
        input.detail,
        input.repository,
        input.branch,
        input.commitSha,
        input.occurredAt,
        completedAt,
        input.occurredAt,
        recordedAt,
        recordedAt,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, stage, detail, actor, branch, commit_sha,
           occurred_at, recorded_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        runId,
        input.eventKey,
        input.stage,
        input.detail,
        input.actor,
        input.branch,
        input.commitSha,
        input.occurredAt,
        recordedAt,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set title = case when ? >= last_event_at then ? else title end,
             stage = case when ? >= last_event_at then ? else stage end,
             detail = case when ? >= last_event_at then ? else detail end,
             repository = case when ? >= last_event_at then ? else repository end,
             branch = case
               when ? >= last_event_at then coalesce(?, branch) else branch end,
             commit_sha = case
               when ? >= last_event_at then coalesce(?, commit_sha) else commit_sha end,
             completed_at = case
               when ? < last_event_at then completed_at
               when ? in ('completed', 'cancelled') then ?
               else null
             end,
             last_event_at = max(last_event_at, ?),
             updated_at = ?
         where id = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        input.occurredAt,
        input.title,
        input.occurredAt,
        input.stage,
        input.occurredAt,
        input.detail,
        input.occurredAt,
        input.repository,
        input.occurredAt,
        input.branch,
        input.occurredAt,
        input.commitSha,
        input.occurredAt,
        input.stage,
        input.occurredAt,
        input.occurredAt,
        recordedAt,
        runId,
        eventId,
      ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, stage, detail, actor, branch,
                commit_sha, occurred_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(runId, input.eventKey)
      .first<HuntEventRow>();
    if (!existingEvent || !sameEvent(existingEvent, input)) {
      throw new EventKeyConflictError();
    }
  }

  return runId;
}
