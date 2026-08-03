import {
  ideaIssuePlanItemsSchema,
  type IdeaDetail,
  type IdeaIssuePlan,
  type IdeaIssuePlanItem,
  type IdeaJob,
  type IdeaMessage,
  type IdeaProvider,
  type IdeaStatus,
  type IdeaSummary,
} from "../../src/lib/ideas-contract";
import {
  isRepositoryWorkflowPending,
  normalizeAutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";

type IdeaRow = {
  id: string;
  project_id: string;
  author_user_id: string;
  author_name: string;
  author_image: string | null;
  title: string;
  title_is_auto: number;
  document_markdown: string;
  status: IdeaStatus;
  provider: IdeaProvider;
  model: string | null;
  version: number;
  generated_issue_count: number;
  created_at: string;
  updated_at: string;
};

type IdeaMessageRow = {
  id: string;
  role: "user" | "assistant";
  body: string;
  job_id: string | null;
  created_at: string;
};

export type IdeaJobRow = {
  id: string;
  project_id: string;
  idea_id: string;
  kind: "chat" | "issue_plan";
  trigger_message_id: string | null;
  reply_message_id: string | null;
  expected_version: number;
  provider: IdeaProvider;
  model: string | null;
  status: "queued" | "running" | "completed" | "failed";
  claimed_worker_id: string | null;
  claim_token_hash: string | null;
  claimed_at: string | null;
  lease_expires_at: string | null;
  attempts: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

type IdeaPlanRow = {
  id: string;
  idea_id: string;
  document_version: number;
  version: number;
  items_json: string;
  created_at: string;
  updated_at: string;
};

const ideaSelect = `
  select idea.id, idea.project_id, idea.author_user_id,
         author.name as author_name, author.image as author_image,
         idea.title, idea.title_is_auto, idea.document_markdown,
         idea.status, idea.provider, idea.model, idea.version,
         (select count(*) from briar_idea_generated_issues generated
          where generated.idea_id = idea.id) as generated_issue_count,
         idea.created_at, idea.updated_at
  from briar_ideas idea
  join "user" author on author.id = idea.author_user_id`;

const summaryJson = (row: IdeaRow): IdeaSummary => ({
  id: row.id,
  projectId: row.project_id,
  author: {
    id: row.author_user_id,
    name: row.author_name,
    image: row.author_image,
  },
  title: row.title,
  documentMarkdown: row.document_markdown,
  status: row.status,
  provider: row.provider,
  model: row.model,
  version: row.version,
  generatedIssueCount: row.generated_issue_count,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const messageJson = (row: IdeaMessageRow): IdeaMessage => ({
  id: row.id,
  role: row.role,
  body: row.body,
  jobId: row.job_id,
  createdAt: row.created_at,
});

const jobJson = (row: IdeaJobRow): IdeaJob => ({
  id: row.id,
  kind: row.kind,
  status: row.status,
  triggerMessageId: row.trigger_message_id,
  attempts: row.attempts,
  error: row.error,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const planJson = (row: IdeaPlanRow): IdeaIssuePlan => ({
  id: row.id,
  ideaId: row.idea_id,
  documentVersion: row.document_version,
  version: row.version,
  items: ideaIssuePlanItemsSchema.parse(JSON.parse(row.items_json)),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export async function listIdeas(db: D1Database, projectId: string) {
  const rows = await db
    .prepare(`${ideaSelect} where idea.project_id = ? order by idea.updated_at desc, idea.id`)
    .bind(projectId)
    .all<IdeaRow>();
  return rows.results.map(summaryJson);
}

export async function createIdea(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    authorUserId: string;
    provider: IdeaProvider;
    model: string | null;
    title: string;
    createdAt: string;
  },
) {
  await db
    .prepare(
      `insert into briar_ideas (
         id, project_id, author_user_id, title, provider, model,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.projectId,
      input.authorUserId,
      input.title,
      input.provider,
      input.model,
      input.createdAt,
      input.createdAt,
    )
    .run();
  return getIdea(db, input.projectId, input.id, input.authorUserId);
}

export async function getIdea(
  db: D1Database,
  projectId: string,
  ideaId: string,
  currentUserId: string,
): Promise<IdeaDetail | null> {
  const [row, messages, activeJob, plan, generated] = await Promise.all([
    db
      .prepare(`${ideaSelect} where idea.project_id = ? and idea.id = ?`)
      .bind(projectId, ideaId)
      .first<IdeaRow>(),
    db
      .prepare(
        `select id, role, body, job_id, created_at
         from briar_idea_messages where idea_id = ?
         order by created_at, id`,
      )
      .bind(ideaId)
      .all<IdeaMessageRow>(),
    db
      .prepare(
        `select * from briar_idea_jobs
         where id = (
           select latest.id from briar_idea_jobs latest
           where latest.idea_id = ? order by latest.created_at desc, latest.id desc
           limit 1
         ) and status in ('queued', 'running', 'failed')`,
      )
      .bind(ideaId)
      .first<IdeaJobRow>(),
    db
      .prepare(`select * from briar_idea_issue_plans where idea_id = ?`)
      .bind(ideaId)
      .first<IdeaPlanRow>(),
    db
      .prepare(
        `select run_id from briar_idea_generated_issues
         where idea_id = ? order by generation, position`,
      )
      .bind(ideaId)
      .all<{ run_id: string }>(),
  ]);
  if (!row) return null;
  return {
    ...summaryJson(row),
    canEdit: row.author_user_id === currentUserId,
    messages: messages.results.map(messageJson),
    activeJob: activeJob ? jobJson(activeJob) : null,
    plan: plan ? planJson(plan) : null,
    generatedRunIds: generated.results.map((item) => item.run_id),
  };
}

export async function updateIdea(
  db: D1Database,
  input: {
    projectId: string;
    ideaId: string;
    authorUserId: string;
    expectedVersion: number;
    title?: string;
    documentMarkdown?: string;
    status?: IdeaStatus;
    provider?: IdeaProvider;
    model?: string | null;
    updatedAt: string;
  },
) {
  const current = await db
    .prepare(
      `select * from briar_ideas
       where id = ? and project_id = ? and author_user_id = ?`,
    )
    .bind(input.ideaId, input.projectId, input.authorUserId)
    .first<{
      title: string;
      document_markdown: string;
      status: IdeaStatus;
      provider: IdeaProvider;
      model: string | null;
      title_is_auto: number;
    }>();
  if (!current) return "not_found" as const;
  const active = await db
    .prepare(
      `select id from briar_idea_jobs
       where idea_id = ? and status in ('queued', 'running')`,
    )
    .bind(input.ideaId)
    .first<{ id: string }>();
  if (active) return "busy" as const;
  const contentChanged = input.documentMarkdown !== undefined;
  const nextStatus =
    contentChanged && current.status !== "draft" && current.status !== "archived"
      ? "refining"
      : (input.status ?? current.status);
  const result = await db
    .prepare(
      `update briar_ideas
       set title = ?, title_is_auto = ?, document_markdown = ?, status = ?,
           provider = ?, model = ?, version = version + 1, updated_at = ?
       where id = ? and project_id = ? and author_user_id = ? and version = ?
       returning id`,
    )
    .bind(
      input.title ?? current.title,
      input.title === undefined ? current.title_is_auto : 0,
      input.documentMarkdown ?? current.document_markdown,
      nextStatus,
      input.provider ?? current.provider,
      input.model === undefined
        ? (input.provider !== undefined && input.provider !== current.provider
          ? null
          : current.model)
        : input.model,
      input.updatedAt,
      input.ideaId,
      input.projectId,
      input.authorUserId,
      input.expectedVersion,
    )
    .first<{ id: string }>();
  return result ? ("updated" as const) : ("conflict" as const);
}

export async function deleteIdea(
  db: D1Database,
  projectId: string,
  ideaId: string,
  authorUserId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_ideas
       where id = ? and project_id = ? and author_user_id = ?
         and not exists (
           select 1 from briar_idea_jobs job where job.idea_id = briar_ideas.id
             and job.status in ('queued', 'running')
         )`,
    )
    .bind(ideaId, projectId, authorUserId)
    .run();
  return result.meta.changes === 1;
}

async function enqueueJob(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    ideaId: string;
    authorUserId: string;
    kind: "chat" | "issue_plan";
    triggerMessageId: string | null;
    replyMessageId: string | null;
    createdAt: string;
  },
) {
  const idea = await db
    .prepare(
      `select version, provider, model, status from briar_ideas
       where id = ? and project_id = ? and author_user_id = ?`,
    )
    .bind(input.ideaId, input.projectId, input.authorUserId)
    .first<{
      version: number;
      provider: IdeaProvider;
      model: string | null;
      status: IdeaStatus;
    }>();
  if (!idea) return "not_found" as const;
  if (idea.status === "archived") return "archived" as const;
  if (input.kind === "issue_plan" && idea.status !== "ready") {
    return "not_ready" as const;
  }
  const active = await db
    .prepare(
      `select id from briar_idea_jobs
       where idea_id = ? and status in ('queued', 'running')`,
    )
    .bind(input.ideaId)
    .first<{ id: string }>();
  if (active) return "busy" as const;
  await db
    .prepare(
      `insert into briar_idea_jobs (
         id, project_id, idea_id, kind, trigger_message_id,
         reply_message_id, expected_version, provider, model,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      input.id,
      input.projectId,
      input.ideaId,
      input.kind,
      input.triggerMessageId,
      input.replyMessageId,
      idea.version,
      idea.provider,
      idea.model,
      input.createdAt,
      input.createdAt,
    )
    .run();
  return "queued" as const;
}

export async function sendIdeaMessage(
  db: D1Database,
  input: {
    jobId: string;
    messageId: string;
    replyMessageId: string;
    projectId: string;
    ideaId: string;
    authorUserId: string;
    body: string;
    createdAt: string;
  },
) {
  const idea = await db
    .prepare(
      `select version, provider, model, status from briar_ideas
       where id = ? and project_id = ? and author_user_id = ?`,
    )
    .bind(input.ideaId, input.projectId, input.authorUserId)
    .first<{
      version: number;
      provider: IdeaProvider;
      model: string | null;
      status: IdeaStatus;
    }>();
  if (!idea) return "not_found" as const;
  if (idea.status === "archived") return "archived" as const;
  const active = await db
    .prepare(
      `select id from briar_idea_jobs
       where idea_id = ? and status in ('queued', 'running')`,
    )
    .bind(input.ideaId)
    .first<{ id: string }>();
  if (active) return "busy" as const;
  await db.batch([
    db
      .prepare(
        `insert into briar_idea_messages (id, idea_id, role, body, job_id, created_at)
         values (?, ?, 'user', ?, ?, ?)`,
      )
      .bind(
        input.messageId,
        input.ideaId,
        input.body,
        input.jobId,
        input.createdAt,
      ),
    db
      .prepare(
        `insert into briar_idea_jobs (
           id, project_id, idea_id, kind, trigger_message_id,
           reply_message_id, expected_version, provider, model,
           created_at, updated_at
         ) values (?, ?, ?, 'chat', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.jobId,
        input.projectId,
        input.ideaId,
        input.messageId,
        input.replyMessageId,
        idea.version,
        idea.provider,
        idea.model,
        input.createdAt,
        input.createdAt,
      ),
  ]);
  return "queued" as const;
}

export async function enqueueIdeaPlan(
  db: D1Database,
  input: {
    jobId: string;
    projectId: string;
    ideaId: string;
    authorUserId: string;
    createdAt: string;
  },
) {
  return enqueueJob(db, {
    id: input.jobId,
    projectId: input.projectId,
    ideaId: input.ideaId,
    authorUserId: input.authorUserId,
    kind: "issue_plan",
    triggerMessageId: null,
    replyMessageId: null,
    createdAt: input.createdAt,
  });
}

export async function retryIdeaJob(
  db: D1Database,
  input: {
    failedJobId: string;
    jobId: string;
    replyMessageId: string;
    projectId: string;
    ideaId: string;
    authorUserId: string;
    createdAt: string;
  },
) {
  const failed = await db
    .prepare(
      `select job.kind, job.trigger_message_id
       from briar_idea_jobs job
       join briar_ideas idea on idea.id = job.idea_id
       where job.id = ? and job.idea_id = ? and job.project_id = ?
         and job.status = 'failed' and idea.author_user_id = ?`,
    )
    .bind(
      input.failedJobId,
      input.ideaId,
      input.projectId,
      input.authorUserId,
    )
    .first<{
      kind: "chat" | "issue_plan";
      trigger_message_id: string | null;
    }>();
  if (!failed) return "not_found" as const;
  return enqueueJob(db, {
    id: input.jobId,
    projectId: input.projectId,
    ideaId: input.ideaId,
    authorUserId: input.authorUserId,
    kind: failed.kind,
    triggerMessageId: failed.trigger_message_id,
    replyMessageId: failed.kind === "chat" ? input.replyMessageId : null,
    createdAt: input.createdAt,
  });
}

export async function claimNextIdeaJob(
  db: D1Database,
  projectId: string,
  input: {
    workerId: string;
    providers: IdeaProvider[];
    claimTokenHash: string;
    claimedAt: string;
    leaseExpiresAt: string;
  },
) {
  await db
    .prepare(
      `update briar_idea_jobs
       set status = 'failed', error = coalesce(error, 'Idea job lease expired repeatedly.'),
           claim_token_hash = null, lease_expires_at = null, updated_at = ?
       where project_id = ? and status = 'running' and attempts >= 3
         and lease_expires_at <= ?`,
    )
    .bind(input.claimedAt, projectId, input.claimedAt)
    .run();
  return db
    .prepare(
      `update briar_idea_jobs
       set status = 'running', claimed_worker_id = ?, claim_token_hash = ?,
           claimed_at = ?, lease_expires_at = ?, attempts = attempts + 1,
           error = null, updated_at = ?
       where id = (
         select job.id from briar_idea_jobs job
         where job.project_id = ? and job.attempts < 3
           and (job.status = 'queued'
             or (job.status = 'running' and job.lease_expires_at <= ?))
           and ((job.provider = 'codex' and ? = 1)
             or (job.provider = 'claude' and ? = 1)
             or (job.provider = 'grok' and ? = 1)
             or (job.provider = 'opencode' and ? = 1))
         order by job.created_at, job.id limit 1
       ) returning *`,
    )
    .bind(
      input.workerId,
      input.claimTokenHash,
      input.claimedAt,
      input.leaseExpiresAt,
      input.claimedAt,
      projectId,
      input.claimedAt,
      input.providers.includes("codex") ? 1 : 0,
      input.providers.includes("claude") ? 1 : 0,
      input.providers.includes("grok") ? 1 : 0,
      input.providers.includes("opencode") ? 1 : 0,
    )
    .first<IdeaJobRow>();
}

export async function ideaJobSnapshot(db: D1Database, job: IdeaJobRow) {
  const [idea, messages] = await Promise.all([
    db
      .prepare(
        `select id, title, title_is_auto, document_markdown, status, version
         from briar_ideas where id = ? and project_id = ?`,
      )
      .bind(job.idea_id, job.project_id)
      .first<{
        id: string;
        title: string;
        title_is_auto: number;
        document_markdown: string;
        status: IdeaStatus;
        version: number;
      }>(),
    db
      .prepare(
        `select id, role, body, job_id, created_at from briar_idea_messages
         where idea_id = ? order by created_at, id`,
      )
      .bind(job.idea_id)
      .all<IdeaMessageRow>(),
  ]);
  return idea
    ? { idea, messages: messages.results.map(messageJson) }
    : null;
}

export async function renewIdeaJobLease(
  db: D1Database,
  projectId: string,
  jobId: string,
  input: {
    workerId: string;
    claimTokenHash: string;
    leaseExpiresAt: string;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_idea_jobs set lease_expires_at = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ? returning *`,
    )
    .bind(
      input.leaseExpiresAt,
      input.updatedAt,
      jobId,
      projectId,
      input.workerId,
      input.claimTokenHash,
    )
    .first<IdeaJobRow>();
}

export async function getClaimedIdeaJob(
  db: D1Database,
  projectId: string,
  jobId: string,
  workerId: string,
  claimTokenHash: string,
) {
  return db
    .prepare(
      `select * from briar_idea_jobs
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ?`,
    )
    .bind(jobId, projectId, workerId, claimTokenHash)
    .first<IdeaJobRow>();
}

export async function failIdeaJob(
  db: D1Database,
  job: IdeaJobRow,
  claimTokenHash: string,
  error: string,
  updatedAt: string,
) {
  return db
    .prepare(
      `update briar_idea_jobs
       set status = case when attempts >= 3 then 'failed' else 'queued' end,
           claim_token_hash = null, claimed_at = null, lease_expires_at = null,
           error = ?, updated_at = ?
       where id = ? and project_id = ? and status = 'running'
         and claimed_worker_id = ? and claim_token_hash = ? returning *`,
    )
    .bind(
      error.slice(0, 4_000),
      updatedAt,
      job.id,
      job.project_id,
      job.claimed_worker_id,
      claimTokenHash,
    )
    .first<IdeaJobRow>();
}

export async function completeIdeaChatJob(
  db: D1Database,
  job: IdeaJobRow,
  claimTokenHash: string,
  result: { reply: string; documentMarkdown: string; title: string | null },
  completedAt: string,
) {
  const idea = await db
    .prepare(
      `select version, title_is_auto from briar_ideas
       where id = ? and project_id = ?`,
    )
    .bind(job.idea_id, job.project_id)
    .first<{ version: number; title_is_auto: number }>();
  if (!idea || idea.version !== job.expected_version || !job.reply_message_id) {
    return false;
  }
  const results = await db.batch([
    db
      .prepare(
        `update briar_ideas
         set document_markdown = ?,
             title = case when title_is_auto = 1 and ? is not null then ? else title end,
             status = 'refining', version = version + 1, updated_at = ?
         where id = ? and project_id = ? and version = ?`,
      )
      .bind(
        result.documentMarkdown,
        result.title,
        result.title,
        completedAt,
        job.idea_id,
        job.project_id,
        job.expected_version,
      ),
    db
      .prepare(
        `insert into briar_idea_messages (id, idea_id, role, body, job_id, created_at)
         select ?, ?, 'assistant', ?, ?, ?
         where exists (select 1 from briar_ideas where id = ? and version = ?)`,
      )
      .bind(
        job.reply_message_id,
        job.idea_id,
        result.reply,
        job.id,
        completedAt,
        job.idea_id,
        job.expected_version + 1,
      ),
    db
      .prepare(
        `update briar_idea_jobs
         set status = 'completed', claim_token_hash = null,
             lease_expires_at = null, completed_at = ?, updated_at = ?
         where id = ? and project_id = ? and status = 'running'
           and claimed_worker_id = ? and claim_token_hash = ?`,
      )
      .bind(
        completedAt,
        completedAt,
        job.id,
        job.project_id,
        job.claimed_worker_id,
        claimTokenHash,
      ),
  ]);
  return results.every((entry) => entry.meta.changes === 1);
}

export async function completeIdeaPlanJob(
  db: D1Database,
  job: IdeaJobRow,
  claimTokenHash: string,
  items: IdeaIssuePlanItem[],
  completedAt: string,
) {
  const parsed = ideaIssuePlanItemsSchema.parse(items);
  const planId = crypto.randomUUID();
  const results = await db.batch([
    db
      .prepare(
        `insert into briar_idea_issue_plans (
           id, idea_id, document_version, version, items_json, created_at, updated_at
         ) select ?, ?, ?, 1, ?, ?, ?
           from briar_ideas where id = ? and project_id = ? and version = ?
         on conflict(idea_id) do update set
           document_version = excluded.document_version,
           version = briar_idea_issue_plans.version + 1,
           items_json = excluded.items_json, updated_at = excluded.updated_at
         where briar_idea_issue_plans.idea_id = excluded.idea_id`,
      )
      .bind(
        planId,
        job.idea_id,
        job.expected_version,
        JSON.stringify(parsed),
        completedAt,
        completedAt,
        job.idea_id,
        job.project_id,
        job.expected_version,
      ),
    db
      .prepare(
        `update briar_idea_jobs
         set status = 'completed', claim_token_hash = null,
             lease_expires_at = null, completed_at = ?, updated_at = ?
         where id = ? and project_id = ? and status = 'running'
           and claimed_worker_id = ? and claim_token_hash = ?`,
      )
      .bind(
        completedAt,
        completedAt,
        job.id,
        job.project_id,
        job.claimed_worker_id,
        claimTokenHash,
      ),
  ]);
  return results.every((entry) => entry.meta.changes === 1);
}

export async function updateIdeaPlan(
  db: D1Database,
  input: {
    projectId: string;
    ideaId: string;
    authorUserId: string;
    expectedVersion: number;
    items: IdeaIssuePlanItem[];
    updatedAt: string;
  },
) {
  const items = ideaIssuePlanItemsSchema.parse(input.items);
  const result = await db
    .prepare(
      `update briar_idea_issue_plans
       set items_json = ?, version = version + 1, updated_at = ?
       where idea_id = ? and version = ?
         and exists (
           select 1 from briar_ideas idea
           where idea.id = briar_idea_issue_plans.idea_id
             and idea.project_id = ? and idea.author_user_id = ?
         ) returning id`,
    )
    .bind(
      JSON.stringify(items),
      input.updatedAt,
      input.ideaId,
      input.expectedVersion,
      input.projectId,
      input.authorUserId,
    )
    .first<{ id: string }>();
  return Boolean(result);
}

export async function convertIdeaPlanToIssues(
  db: D1Database,
  input: {
    projectId: string;
    ideaId: string;
    authorUserId: string;
    planVersion: number;
    createdAt: string;
  },
) {
  // Recover generated runs left in the short-lived replacement state if a
  // previous Worker invocation terminated before its finally block ran.
  await db
    .prepare(
      `update briar_hunt_runs set status = 'queued', updated_at = ?
       where status = 'backlog' and claim_token_hash is null and id in (
         select generated.run_id from briar_idea_generated_issues generated
         join briar_ideas idea on idea.id = generated.idea_id
         where idea.id = ? and idea.project_id = ?
           and (idea.replacement_lock_until is null or idea.replacement_lock_until <= ?)
       )`,
    )
    .bind(input.createdAt, input.ideaId, input.projectId, input.createdAt)
    .run();
  const lockUntil = new Date(Date.parse(input.createdAt) + 60_000).toISOString();
  const lock = await db
    .prepare(
      `update briar_ideas set replacement_lock_until = ?
       where id = ? and project_id = ? and author_user_id = ?
         and status = 'ready'
         and (replacement_lock_until is null or replacement_lock_until <= ?)
       returning title, provider, model, version`,
    )
    .bind(
      lockUntil,
      input.ideaId,
      input.projectId,
      input.authorUserId,
      input.createdAt,
    )
    .first<{
      title: string;
      provider: IdeaProvider;
      model: string | null;
      version: number;
    }>();
  if (!lock) return { outcome: "not_ready" as const, runIds: [] };
  try {
    const [plan, settings, project, generated] = await Promise.all([
      db
        .prepare(
          `select * from briar_idea_issue_plans
           where idea_id = ? and version = ?`,
        )
        .bind(input.ideaId, input.planVersion)
        .first<IdeaPlanRow>(),
      db
        .prepare(
          `select github_repository, workflow_json from briar_project_settings
           where project_id = ?`,
        )
        .bind(input.projectId)
        .first<{ github_repository: string | null; workflow_json: string }>(),
      db
        .prepare(`select name from briar_projects where id = ?`)
        .bind(input.projectId)
        .first<{ name: string }>(),
      db
        .prepare(
          `select generated.run_id, generated.generation, run.status,
                  run.claim_token_hash
           from briar_idea_generated_issues generated
           join briar_hunt_runs run on run.id = generated.run_id
           where generated.idea_id = ?`,
        )
        .bind(input.ideaId)
        .all<{
          run_id: string;
          generation: number;
          status: string;
          claim_token_hash: string | null;
        }>(),
    ]);
    if (!plan || !settings || !project) {
      return { outcome: "not_found" as const, runIds: [] };
    }
    if (
      generated.results.some(
        (item) => item.status !== "queued" || item.claim_token_hash !== null,
      )
    ) {
      return { outcome: "active_issues" as const, runIds: [] };
    }
    if (generated.results.length > 0) {
      const paused = await db.batch(
        generated.results.map((item) =>
          db
            .prepare(
              `update briar_hunt_runs set status = 'backlog', updated_at = ?
               where id = ? and project_id = ? and status = 'queued'
                 and claim_token_hash is null`,
            )
            .bind(input.createdAt, item.run_id, input.projectId),
        ),
      );
      if (paused.some((result) => result.meta.changes !== 1)) {
        await db.batch(
          generated.results.map((item) =>
            db
              .prepare(
                `update briar_hunt_runs set status = 'queued', updated_at = ?
                 where id = ? and project_id = ? and status = 'backlog'`,
              )
              .bind(input.createdAt, item.run_id, input.projectId),
          ),
        );
        return { outcome: "active_issues" as const, runIds: [] };
      }
    }
    const workflow = normalizeAutoHuntWorkflow(JSON.parse(settings.workflow_json));
    if (isRepositoryWorkflowPending(workflow)) {
      return { outcome: "workflow_pending" as const, runIds: [] };
    }
    const items = ideaIssuePlanItemsSchema.parse(JSON.parse(plan.items_json));
    const generation =
      Math.max(0, ...generated.results.map((item) => item.generation)) + 1;
    const idsByKey = new Map(items.map((item) => [item.key, crypto.randomUUID()]));
    const statements: D1PreparedStatement[] = [];
    for (const old of generated.results) {
      statements.push(
        db
          .prepare(
            `delete from briar_hunt_runs
             where id = ? and project_id = ? and status in ('queued', 'backlog')
               and claim_token_hash is null`,
          )
          .bind(old.run_id, input.projectId),
      );
    }
    for (const [position, item] of items.entries()) {
      const runId = idsByKey.get(item.key)!;
      const sourceKey = `briar-idea:${input.ideaId}:g${generation}:${item.key}`;
      const eventId = crypto.randomUUID();
      statements.push(
        db
          .prepare(
            `insert into briar_hunt_runs (
               id, project_id, source, source_key, title, stage, status,
               workflow_snapshot_json, detail, priority, repository,
               issue_description, pull_request_urls, source_created_at,
               context_json, preferred_agent_provider, preferred_agent_model,
               preferred_agent_effort, started_at, last_event_at,
               created_at, updated_at
             ) values (?, ?, 'issue', ?, ?, 'queued', 'queued', ?, ?, ?, ?, ?,
                       '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            runId,
            input.projectId,
            sourceKey,
            item.title,
            JSON.stringify(workflow),
            "아이디어 문서에서 생성된 이슈가 Auto Hunt 처리를 기다리고 있습니다.",
            item.priority,
            settings.github_repository ?? project.name,
            item.description,
            input.createdAt,
            JSON.stringify({
              origin: "idea",
              ideaId: input.ideaId,
              ideaTitle: lock.title,
              generation,
            }),
            item.provider ?? lock.provider,
            item.model ?? lock.model,
            item.effort,
            input.createdAt,
            input.createdAt,
            input.createdAt,
            input.createdAt,
          ),
        db
          .prepare(
            `insert into briar_hunt_events (
               id, run_id, event_key, attempt, revision, stage, status,
               detail, actor, pull_request_urls, occurred_at, recorded_at
             ) values (?, ?, ?, 1, 1, 'queued', 'queued', ?, 'briar-idea',
                       '[]', ?, ?)`,
          )
          .bind(
            eventId,
            runId,
            `${sourceKey}:queued:intake`,
            "아이디어 계획에서 원자적으로 생성되었습니다.",
            input.createdAt,
            input.createdAt,
          ),
        db
          .prepare(
            `insert into briar_idea_generated_issues (
               idea_id, generation, run_id, position, created_at
             ) values (?, ?, ?, ?, ?)`,
          )
          .bind(input.ideaId, generation, runId, position, input.createdAt),
      );
    }
    for (const item of items) {
      for (const prerequisiteKey of item.prerequisiteKeys) {
        statements.push(
          db
            .prepare(
              `insert into briar_issue_dependencies (
                 project_id, prerequisite_run_id, dependent_run_id,
                 created_by_user_id, created_at
               ) values (?, ?, ?, ?, ?)`,
            )
            .bind(
              input.projectId,
              idsByKey.get(prerequisiteKey),
              idsByKey.get(item.key),
              input.authorUserId,
              input.createdAt,
            ),
        );
      }
    }
    statements.push(
      db
        .prepare(
          `update briar_ideas
           set status = 'issues_created', version = version + 1,
               replacement_lock_until = null, updated_at = ?
           where id = ? and project_id = ? and version = ?`,
        )
        .bind(input.createdAt, input.ideaId, input.projectId, lock.version),
    );
    await db.batch(statements);
    return {
      outcome: "created" as const,
      runIds: items.map((item) => idsByKey.get(item.key)!),
    };
  } finally {
    await db
      .prepare(
        `update briar_hunt_runs set status = 'queued', updated_at = ?
         where id in (
           select generated.run_id from briar_idea_generated_issues generated
           where generated.idea_id = ?
         ) and project_id = ? and status = 'backlog' and claim_token_hash is null`,
      )
      .bind(input.createdAt, input.ideaId, input.projectId)
      .run();
    await db
      .prepare(
        `update briar_ideas set replacement_lock_until = null
         where id = ? and project_id = ? and replacement_lock_until = ?`,
      )
      .bind(input.ideaId, input.projectId, lockUntil)
      .run();
  }
}
