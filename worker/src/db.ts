import {
  isTerminalTrackerState,
  type AutoHuntQaEnvironment,
  type AutoHuntQaStatus,
  type AutoHuntSource,
  type AutoHuntStage,
} from "../../src/lib/auto-hunt-contract";

export type ProjectRow = {
  id: string;
  name: string;
  created_at: string;
};

export type ProjectSettingsRow = {
  project_id: string;
  velen_org: string | null;
  data_source: string | null;
  linear_enabled: number;
  linear_source: string | null;
  linear_team_key: string | null;
  github_repository: string | null;
  created_at: string;
  updated_at: string;
};

export type HuntRunRow = {
  id: string;
  run_number: number;
  source: AutoHuntSource;
  source_key: string;
  title: string;
  stage: AutoHuntStage;
  detail: string | null;
  priority: number | null;
  repository: string;
  branch: string | null;
  commit_sha: string | null;
  tracker_provider: string | null;
  tracker_issue_id: string | null;
  tracker_issue_identifier: string | null;
  tracker_issue_url: string | null;
  tracker_issue_state: string | null;
  issue_description: string | null;
  result_summary: string | null;
  pull_request_urls: string;
  target_sha: string | null;
  source_created_at: string | null;
  staging_qa_status: AutoHuntQaStatus | null;
  production_qa_status: AutoHuntQaStatus | null;
  staging_qa_detail: string | null;
  production_qa_detail: string | null;
  context_json: string | null;
  started_at: string;
  completed_at: string | null;
  last_event_at: string;
  event_count: number;
};

export type HuntEventRow = {
  id: string;
  run_id: string;
  event_key: string;
  stage: AutoHuntStage;
  detail: string | null;
  actor: string;
  branch: string | null;
  commit_sha: string | null;
  qa_status: AutoHuntQaStatus | null;
  tracker_issue_state: string | null;
  pull_request_urls: string;
  target_sha: string | null;
  occurred_at: string;
  recorded_at: string;
};

export type TrackerInput = {
  provider: string;
  issueId: string | null;
  identifier: string | null;
  url: string | null;
  state: string | null;
} | null;

export type HuntEventInput = {
  source: AutoHuntSource;
  sourceKey: string;
  title: string;
  stage: AutoHuntStage;
  eventKey: string;
  occurredAt: string;
  actor: string;
  repository: string;
  detail: string | null;
  priority: number | null;
  branch: string | null;
  commitSha: string | null;
  tracker: TrackerInput;
  issueDescription: string | null;
  resultSummary: string | null;
  pullRequestUrls: string[];
  targetSha: string | null;
  sourceCreatedAt: string | null;
  qaStatus: "pending" | null;
  stagingQaDetail: string | null;
  productionQaDetail: string | null;
  context: Record<string, unknown> | null;
};

export type ProjectSettingsInput = {
  velenOrg: string | null;
  dataSource: string | null;
  linear: {
    enabled: boolean;
    source: string | null;
    teamKey: string | null;
  };
  githubRepository: string | null;
};

export class EventKeyConflictError extends Error {
  constructor() {
    super("Event key was reused with different Auto Hunt data");
  }
}
export class HuntTransitionError extends Error {}

const stableJson = (value: unknown) => JSON.stringify(value);
const normalizedUrls = (urls: string[]) => [...new Set(urls)].sort();
const parseUrls = (value: string | null | undefined) => {
  if (!value) return [];
  const parsed: unknown = JSON.parse(value);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
};

export async function listProjects(db: D1Database, ownerUserId: string) {
  const result = await db
    .prepare(
      `select id, name, created_at
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
    agentTokenHash: string;
  },
) {
  const createdAt = new Date().toISOString();
  const project: ProjectRow = {
    id: crypto.randomUUID(),
    name: input.name,
    created_at: createdAt,
  };
  await db.batch([
    db
      .prepare(
        `insert into briar_projects (
           id, owner_user_id, name, agent_token_hash, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        project.id,
        input.ownerUserId,
        project.name,
        input.agentTokenHash,
        createdAt,
        createdAt,
      ),
    db
      .prepare(
        `insert into briar_project_settings (
           project_id, created_at, updated_at
         ) values (?, ?, ?)`,
      )
      .bind(project.id, createdAt, createdAt),
  ]);
  return project;
}

export async function getProject(
  db: D1Database,
  projectId: string,
  ownerUserId: string,
) {
  return await db
    .prepare(
      `select id, name, created_at
       from briar_projects
       where id = ? and owner_user_id = ?`,
    )
    .bind(projectId, ownerUserId)
    .first<ProjectRow>();
}

export async function getProjectSettings(db: D1Database, projectId: string) {
  return await db
    .prepare(
      `select project_id, velen_org, data_source, linear_enabled,
              linear_source, linear_team_key, github_repository,
              created_at, updated_at
       from briar_project_settings
       where project_id = ?`,
    )
    .bind(projectId)
    .first<ProjectSettingsRow>();
}

export async function updateProjectSettings(
  db: D1Database,
  projectId: string,
  input: ProjectSettingsInput,
) {
  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      `insert into briar_project_settings (
         project_id, velen_org, data_source, linear_enabled, linear_source,
         linear_team_key, github_repository, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(project_id) do update set
         velen_org = excluded.velen_org,
         data_source = excluded.data_source,
         linear_enabled = excluded.linear_enabled,
         linear_source = excluded.linear_source,
         linear_team_key = excluded.linear_team_key,
         github_repository = excluded.github_repository,
         updated_at = excluded.updated_at`,
    )
    .bind(
      projectId,
      input.velenOrg,
      input.dataSource,
      input.linear.enabled ? 1 : 0,
      input.linear.enabled ? input.linear.source : null,
      input.linear.enabled ? input.linear.teamKey : null,
      input.githubRepository,
      updatedAt,
      updatedAt,
    )
    .run();
  return await getProjectSettings(db, projectId);
}

export async function listDashboardRuns(db: D1Database, projectId: string) {
  const runs = await db
    .prepare(
      `select run.id, run.run_number, run.source, run.source_key, run.title,
              run.stage, run.detail, run.priority, run.repository, run.branch,
              run.commit_sha, run.tracker_provider, run.tracker_issue_id,
              run.tracker_issue_identifier, run.tracker_issue_url,
              run.tracker_issue_state, run.issue_description,
              run.result_summary, run.pull_request_urls, run.target_sha,
              run.source_created_at, run.staging_qa_status,
              run.production_qa_status, run.staging_qa_detail,
              run.production_qa_detail, run.context_json, run.started_at,
              run.completed_at, run.last_event_at,
              (select count(*) from briar_hunt_events event
               where event.run_id = run.id) as event_count
       from briar_hunt_runs run
       where run.project_id = ?
       order by
         case when run.stage in ('completed', 'cancelled') then 1 else 0 end,
         run.last_event_at desc
       limit 200`,
    )
    .bind(projectId)
    .all<HuntRunRow>();

  const events = await db
    .prepare(
      `select ranked.id, ranked.run_id, ranked.event_key, ranked.stage,
              ranked.detail, ranked.actor, ranked.branch, ranked.commit_sha,
              ranked.qa_status, ranked.tracker_issue_state,
              ranked.pull_request_urls, ranked.target_sha,
              ranked.occurred_at, ranked.recorded_at
       from (
         select event.*,
                row_number() over (
                  partition by event.run_id
                  order by event.occurred_at desc, event.id desc
                ) as event_rank
         from briar_hunt_events event
         join briar_hunt_runs run on run.id = event.run_id
         where run.project_id = ?
       ) ranked
       where ranked.event_rank <= 20
       order by ranked.occurred_at desc, ranked.id desc`,
    )
    .bind(projectId)
    .all<HuntEventRow>();

  return { runs: runs.results, events: events.results };
}

export async function getNextQueuedHuntRun(
  db: D1Database,
  projectId: string,
) {
  return await db
    .prepare(
      `select run.*,
              (select count(*) from briar_hunt_events event
               where event.run_id = run.id) as event_count
       from briar_hunt_runs run
       where run.project_id = ? and run.stage = 'queued'
       order by
         case when run.priority is null then 1 else 0 end,
         run.priority asc,
         coalesce(run.source_created_at, run.started_at) asc,
         run.run_number asc
       limit 1`,
    )
    .bind(projectId)
    .first<HuntRunRow>();
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

export async function replaceProjectAgentToken(
  db: D1Database,
  projectId: string,
  ownerUserId: string,
  agentTokenHash: string,
) {
  const result = await db
    .prepare(
      `update briar_projects
       set agent_token_hash = ?, updated_at = ?
       where id = ? and owner_user_id = ?`,
    )
    .bind(agentTokenHash, new Date().toISOString(), projectId, ownerUserId)
    .run();
  return result.meta.changes > 0;
}

const digestRunId = async (
  projectId: string,
  source: AutoHuntSource,
  sourceKey: string,
) => {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${projectId}\u0000${source}\u0000${sourceKey}`),
    ),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes]
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
  row.qa_status === input.qaStatus &&
  row.tracker_issue_state === input.tracker?.state &&
  row.pull_request_urls === stableJson(input.pullRequestUrls) &&
  row.target_sha === input.targetSha &&
  row.occurred_at === input.occurredAt;

const loadRunForIdentity = async (
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) => {
  if (input.tracker?.issueId) {
    const byTracker = await db
      .prepare(
        `select * from briar_hunt_runs
         where project_id = ? and tracker_provider = ? and tracker_issue_id = ?
         limit 1`,
      )
      .bind(projectId, input.tracker.provider, input.tracker.issueId)
      .first<HuntRunRow>();
    if (byTracker) return byTracker;
  }
  return await db
    .prepare(
      `select * from briar_hunt_runs
       where project_id = ? and source = ? and source_key = ?
       limit 1`,
    )
    .bind(projectId, input.source, input.sourceKey)
    .first<HuntRunRow>();
};

const assertCompletionEligible = async (
  db: D1Database,
  projectId: string,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (input.stage !== "completed") return;
  if (!run || !["passed", "skipped"].includes(run.production_qa_status ?? "")) {
    throw new HuntTransitionError("Auto Hunt completion requires Production QA");
  }
  const resultSummary = input.resultSummary ?? run.result_summary;
  if (!resultSummary?.trim()) {
    throw new HuntTransitionError("Auto Hunt completion requires a result summary");
  }
  const settings = await getProjectSettings(db, projectId);
  const trackerProvider = input.tracker?.provider ?? run.tracker_provider;
  const trackerState = input.tracker?.state ?? run.tracker_issue_state;
  if (
    settings?.linear_enabled === 1 &&
    trackerProvider === "linear" &&
    !isTerminalTrackerState(trackerState)
  ) {
    throw new HuntTransitionError(
      "Auto Hunt completion requires a terminal Linear issue",
    );
  }
};

const forwardStageRank: Partial<Record<AutoHuntStage, number>> = {
  queued: 0,
  analyzing: 1,
  implementing: 2,
  pr_open: 3,
  staging_qa: 4,
  production_qa: 5,
  completed: 6,
};

const assertStageTransition = async (
  db: D1Database,
  run: HuntRunRow | null,
  input: HuntEventInput,
) => {
  if (!run || input.occurredAt < run.last_event_at || input.stage === run.stage) {
    return;
  }
  if (run.stage === "completed" || run.stage === "cancelled") {
    throw new HuntTransitionError(`Auto Hunt run is already ${run.stage}`);
  }
  if (["blocked", "failed", "cancelled"].includes(input.stage)) return;
  const nextRank = forwardStageRank[input.stage];
  if (nextRank === undefined) return;
  let floorRank = forwardStageRank[run.stage];
  if (floorRank === undefined) {
    floorRank =
      (await db
        .prepare(
          `select max(case stage
             when 'queued' then 0 when 'analyzing' then 1
             when 'implementing' then 2 when 'pr_open' then 3
             when 'staging_qa' then 4 when 'production_qa' then 5
             when 'completed' then 6 else null end) as stage_rank
           from briar_hunt_events where run_id = ?`,
        )
        .bind(run.id)
        .first<number>("stage_rank")) ?? 0;
  }
  if (nextRank < floorRank) {
    throw new HuntTransitionError(
      `Auto Hunt stage cannot regress from rank ${floorRank} to ${nextRank}`,
    );
  }
};

export async function recordHuntEvent(
  db: D1Database,
  projectId: string,
  input: HuntEventInput,
) {
  const normalizedInput = {
    ...input,
    pullRequestUrls: normalizedUrls(input.pullRequestUrls),
  };
  const existingRun = await loadRunForIdentity(db, projectId, normalizedInput);
  await assertStageTransition(db, existingRun, normalizedInput);
  await assertCompletionEligible(db, projectId, existingRun, normalizedInput);

  if (existingRun) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, stage, detail, actor, branch,
                commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(existingRun.id, normalizedInput.eventKey)
      .first<HuntEventRow>();
    if (existingEvent) {
      if (!sameEvent(existingEvent, normalizedInput)) {
        throw new EventKeyConflictError();
      }
      return existingRun.id;
    }
  }

  const runId =
    existingRun?.id ??
    (await digestRunId(projectId, normalizedInput.source, normalizedInput.sourceKey));
  const eventId = crypto.randomUUID();
  const recordedAt = new Date().toISOString();
  const completedAt = ["completed", "cancelled"].includes(normalizedInput.stage)
    ? normalizedInput.occurredAt
    : null;
  const mergedPullRequestUrls = normalizedUrls([
    ...parseUrls(existingRun?.pull_request_urls),
    ...normalizedInput.pullRequestUrls,
  ]);
  const qaStatus = normalizedInput.qaStatus;
  const stagingQaStatus =
    normalizedInput.stage === "staging_qa" && qaStatus === "pending"
      ? "pending"
      : null;
  const productionQaStatus =
    normalizedInput.stage === "production_qa" && qaStatus === "pending"
      ? "pending"
      : null;

  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_runs (
           id, project_id, source, source_key, title, stage, detail, priority,
           repository, branch, commit_sha, tracker_provider,
           tracker_issue_id, tracker_issue_identifier, tracker_issue_url,
           tracker_issue_state, issue_description, result_summary,
           pull_request_urls, target_sha, source_created_at,
           staging_qa_status, production_qa_status, staging_qa_detail,
           production_qa_detail, context_json, started_at, completed_at,
           last_event_at, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(project_id, source, source_key) do nothing`,
      )
      .bind(
        runId,
        projectId,
        normalizedInput.source,
        normalizedInput.sourceKey,
        normalizedInput.title,
        normalizedInput.stage,
        normalizedInput.detail,
        normalizedInput.priority,
        normalizedInput.repository,
        normalizedInput.branch,
        normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.tracker?.state ?? null,
        normalizedInput.issueDescription,
        normalizedInput.resultSummary,
        stableJson(mergedPullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        stagingQaStatus,
        productionQaStatus,
        normalizedInput.stagingQaDetail,
        normalizedInput.productionQaDetail,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt,
        completedAt,
        normalizedInput.occurredAt,
        recordedAt,
        recordedAt,
      ),
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, stage, detail, actor, branch, commit_sha,
           qa_status, tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        runId,
        normalizedInput.eventKey,
        normalizedInput.stage,
        normalizedInput.detail,
        normalizedInput.actor,
        normalizedInput.branch,
        normalizedInput.commitSha,
        qaStatus,
        normalizedInput.tracker?.state ?? null,
        stableJson(normalizedInput.pullRequestUrls),
        normalizedInput.targetSha,
        normalizedInput.occurredAt,
        recordedAt,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set title = case when ? >= last_event_at then ? else title end,
             stage = case
               when ? < last_event_at then stage
               when stage = 'completed' and ? <> 'completed' then stage
               when ? not in ('blocked', 'failed', 'cancelled') and ? < (
                 select coalesce(max(case event.stage
                   when 'queued' then 0 when 'analyzing' then 1
                   when 'implementing' then 2 when 'pr_open' then 3
                   when 'staging_qa' then 4 when 'production_qa' then 5
                   when 'completed' then 6 else null end), 0)
                 from briar_hunt_events event where event.run_id = briar_hunt_runs.id
               ) then stage
               else ?
             end,
             detail = case when ? >= last_event_at then ? else detail end,
             priority = case when ? >= last_event_at then coalesce(?, priority) else priority end,
             repository = case when ? >= last_event_at then ? else repository end,
             branch = case when ? >= last_event_at then coalesce(?, branch) else branch end,
             commit_sha = case when ? >= last_event_at then coalesce(?, commit_sha) else commit_sha end,
             tracker_provider = coalesce(?, tracker_provider),
             tracker_issue_id = coalesce(?, tracker_issue_id),
             tracker_issue_identifier = coalesce(?, tracker_issue_identifier),
             tracker_issue_url = coalesce(?, tracker_issue_url),
             tracker_issue_state = case when ? >= last_event_at then coalesce(?, tracker_issue_state) else tracker_issue_state end,
             issue_description = case when ? >= last_event_at then coalesce(?, issue_description) else issue_description end,
             result_summary = case when ? >= last_event_at then coalesce(?, result_summary) else result_summary end,
             pull_request_urls = ?,
             target_sha = case when ? >= last_event_at then coalesce(?, target_sha) else target_sha end,
             source_created_at = coalesce(source_created_at, ?),
             staging_qa_status = case
               when ? >= last_event_at and ? = 'staging_qa' and ? = 'pending' then 'pending'
               else staging_qa_status
             end,
             production_qa_status = case
               when ? >= last_event_at and ? = 'production_qa' and ? = 'pending' then 'pending'
               else production_qa_status
             end,
             staging_qa_detail = case when ? >= last_event_at then coalesce(?, staging_qa_detail) else staging_qa_detail end,
             production_qa_detail = case when ? >= last_event_at then coalesce(?, production_qa_detail) else production_qa_detail end,
             context_json = case when ? >= last_event_at then coalesce(?, context_json) else context_json end,
             completed_at = case
               when ? < last_event_at then completed_at
               when ? in ('completed', 'cancelled') then ?
               when stage = 'completed' and ? <> 'completed' then completed_at
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
        normalizedInput.occurredAt, normalizedInput.title,
        normalizedInput.occurredAt, normalizedInput.stage,
        normalizedInput.stage, forwardStageRank[normalizedInput.stage] ?? 7,
        normalizedInput.stage,
        normalizedInput.occurredAt, normalizedInput.detail,
        normalizedInput.occurredAt, normalizedInput.priority,
        normalizedInput.occurredAt, normalizedInput.repository,
        normalizedInput.occurredAt, normalizedInput.branch,
        normalizedInput.occurredAt, normalizedInput.commitSha,
        normalizedInput.tracker?.provider ?? null,
        normalizedInput.tracker?.issueId ?? null,
        normalizedInput.tracker?.identifier ?? null,
        normalizedInput.tracker?.url ?? null,
        normalizedInput.occurredAt, normalizedInput.tracker?.state ?? null,
        normalizedInput.occurredAt, normalizedInput.issueDescription,
        normalizedInput.occurredAt, normalizedInput.resultSummary,
        stableJson(mergedPullRequestUrls),
        normalizedInput.occurredAt, normalizedInput.targetSha,
        normalizedInput.sourceCreatedAt,
        normalizedInput.occurredAt, normalizedInput.stage, qaStatus,
        normalizedInput.occurredAt, normalizedInput.stage, qaStatus,
        normalizedInput.occurredAt, normalizedInput.stagingQaDetail,
        normalizedInput.occurredAt, normalizedInput.productionQaDetail,
        normalizedInput.occurredAt,
        normalizedInput.context ? stableJson(normalizedInput.context) : null,
        normalizedInput.occurredAt, normalizedInput.stage,
        normalizedInput.occurredAt, normalizedInput.stage,
        normalizedInput.occurredAt, recordedAt, runId, eventId,
      ),
  ]);

  if ((results[1]?.meta.changes ?? 0) === 0) {
    const existingEvent = await db
      .prepare(
        `select id, run_id, event_key, stage, detail, actor, branch,
                commit_sha, qa_status, tracker_issue_state,
                pull_request_urls, target_sha, occurred_at, recorded_at
         from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(runId, normalizedInput.eventKey)
      .first<HuntEventRow>();
    if (!existingEvent || !sameEvent(existingEvent, normalizedInput)) {
      throw new EventKeyConflictError();
    }
  }

  return runId;
}

export type QaActionOutcome =
  | "passed"
  | "already_passed"
  | "skipped"
  | "already_skipped"
  | "ineligible"
  | "not_found";

export async function recordQaResult(
  db: D1Database,
  projectId: string,
  input: {
    runId: string;
    environment: AutoHuntQaEnvironment;
    result: "passed" | "skipped";
    actor: string;
    observedAt: string;
    detail: string | null;
  },
): Promise<QaActionOutcome> {
  const run = await db
    .prepare(`select * from briar_hunt_runs where id = ? and project_id = ?`)
    .bind(input.runId, projectId)
    .first<HuntRunRow>();
  if (!run) return "not_found";

  const statusColumn =
    input.environment === "staging" ? "staging_qa_status" : "production_qa_status";
  const expectedStage =
    input.environment === "staging" ? "staging_qa" : "production_qa";
  const currentStatus = run[statusColumn];
  if (currentStatus === input.result) return `already_${input.result}`;
  const eligible =
    input.result === "passed"
      ? run.stage === expectedStage && currentStatus === "pending"
      : currentStatus === "pending" &&
        [expectedStage, "blocked", "failed"].includes(run.stage);
  if (!eligible) return "ineligible";

  const eventId = crypto.randomUUID();
  const eventKey = `admin:qa-${input.result === "passed" ? "pass" : "skip"}:${input.environment}`;
  const detail =
    input.detail ??
    (input.result === "passed"
      ? `${input.environment === "staging" ? "Stage" : "Production"} QA를 완료했습니다.`
      : `${input.environment === "staging" ? "Stage" : "Production"} QA를 건너뛰었습니다.`);
  const recordedAt = new Date().toISOString();
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_hunt_events (
           id, run_id, event_key, stage, detail, actor, branch, commit_sha,
           qa_status, tracker_issue_state, pull_request_urls, target_sha,
           occurred_at, recorded_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(run_id, event_key) do nothing`,
      )
      .bind(
        eventId,
        run.id,
        eventKey,
        expectedStage,
        detail,
        input.actor,
        run.branch,
        run.commit_sha,
        input.result,
        run.tracker_issue_state,
        run.pull_request_urls,
        run.target_sha,
        input.observedAt,
        recordedAt,
      ),
    db
      .prepare(
        `update briar_hunt_runs
         set ${statusColumn} = ?, detail = ?, last_event_at = max(last_event_at, ?),
             updated_at = ?
         where id = ? and project_id = ?
           and exists (
             select 1 from briar_hunt_events
             where id = ? and run_id = briar_hunt_runs.id
           )`,
      )
      .bind(
        input.result,
        detail,
        input.observedAt,
        recordedAt,
        run.id,
        projectId,
        eventId,
      ),
  ]);

  if ((results[0]?.meta.changes ?? 0) === 0) {
    const existing = await db
      .prepare(
        `select qa_status from briar_hunt_events
         where run_id = ? and event_key = ?`,
      )
      .bind(run.id, eventKey)
      .first<AutoHuntQaStatus>("qa_status");
    if (existing !== input.result) throw new EventKeyConflictError();
    return `already_${input.result}`;
  }
  return input.result;
}

export async function getHuntRunForProject(
  db: D1Database,
  projectId: string,
  runId: string,
) {
  return db
    .prepare(`select * from briar_hunt_runs where id = ? and project_id = ?`)
    .bind(runId, projectId)
    .first<HuntRunRow>();
}
