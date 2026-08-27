export type MergeQueueProfileRow = {
  project_id: string;
  repository_id: number;
  repository: string;
  base_branch: "main";
  enabled: number;
  readiness_stage_id: string;
  quiet_window_ms: number;
  max_batch_size: number;
  created_at: string;
  updated_at: string;
};

const activeBatchStates = `
  'collecting', 'frozen', 'enqueueing', 'waiting_tail', 'validating',
  'publishing', 'awaiting_merge', 'blocked', 'draining'`;

export async function getMergeQueueProfile(
  db: D1Database,
  projectId: string,
) {
  return db.prepare(
    "select * from briar_merge_queue_profiles where project_id = ?",
  ).bind(projectId).first<MergeQueueProfileRow>();
}

export async function configureMergeQueueProfile(
  db: D1Database,
  input: {
    projectId: string;
    repositoryId: number;
    repository: string;
    enabled: boolean;
    readinessStageId: string;
    quietWindowMs: number;
    maxBatchSize: number;
    observedAt: string;
  },
) {
  const repository = input.repository.toLowerCase();
  const active = await db.prepare(
    `select id, repository_id, repository, base_branch from briar_merge_batches
     where project_id = ? and state in (${activeBatchStates}) limit 1`,
  ).bind(input.projectId).first<{
    id: string;
    repository_id: number;
    repository: string;
    base_branch: string;
  }>();
  const current = await getMergeQueueProfile(db, input.projectId);
  if (
    active && (
      !input.enabled || active.repository_id !== input.repositoryId ||
      active.repository !== repository || active.base_branch !== "main" ||
      current?.readiness_stage_id !== input.readinessStageId
    )
  ) {
    return { outcome: "active_batch" as const, profile: current };
  }

  const laneOwner = input.enabled
    ? await db.prepare(
        `select project_id from briar_merge_queue_profiles
         where repository_id = ? and base_branch = 'main' and enabled = 1
           and project_id <> ? limit 1`,
      ).bind(input.repositoryId, input.projectId).first<{ project_id: string }>()
    : null;
  if (laneOwner) {
    return {
      outcome: "lane_owned" as const,
      ownerProjectId: laneOwner.project_id,
      profile: current,
    };
  }

  try {
    await db.prepare(
      `insert into briar_merge_queue_profiles (
       project_id, repository_id, repository, base_branch, enabled,
       readiness_stage_id, quiet_window_ms, max_batch_size, created_at, updated_at
     ) values (?, ?, ?, 'main', ?, ?, ?, ?, ?, ?)
     on conflict(project_id) do update set
       repository_id = excluded.repository_id,
       repository = excluded.repository,
       base_branch = excluded.base_branch,
       created_at = case
         when briar_merge_queue_profiles.repository_id <> excluded.repository_id
           or briar_merge_queue_profiles.repository <> excluded.repository
           or briar_merge_queue_profiles.readiness_stage_id <>
             excluded.readiness_stage_id
         then excluded.created_at else briar_merge_queue_profiles.created_at
       end,
       enabled = excluded.enabled,
       readiness_stage_id = excluded.readiness_stage_id,
       quiet_window_ms = excluded.quiet_window_ms,
       max_batch_size = excluded.max_batch_size,
       updated_at = excluded.updated_at`,
    ).bind(
      input.projectId,
      input.repositoryId,
      repository,
      input.enabled ? 1 : 0,
      input.readinessStageId,
      input.quietWindowMs,
      input.maxBatchSize,
      input.observedAt,
      input.observedAt,
    ).run();
  } catch (error) {
    if (!input.enabled) throw error;
    const racedOwner = await db.prepare(
      `select project_id from briar_merge_queue_profiles
       where repository_id = ? and base_branch = 'main' and enabled = 1
         and project_id <> ? limit 1`,
    ).bind(input.repositoryId, input.projectId).first<{ project_id: string }>();
    if (!racedOwner) throw error;
    return {
      outcome: "lane_owned" as const,
      ownerProjectId: racedOwner.project_id,
      profile: current,
    };
  }
  return {
    outcome: "updated" as const,
    profile: (await getMergeQueueProfile(db, input.projectId))!,
  };
}

export async function listEnabledMergeQueueProjectIds(db: D1Database) {
  const result = await db.prepare(
    `select project_id from briar_merge_queue_profiles
     where enabled = 1 order by project_id`,
  ).all<{ project_id: string }>();
  return result.results.map((row) => row.project_id);
}
