import type { ModelEffort } from "../../src/lib/agent-provider-contract";
import type { AgentProvider } from "../../src/lib/agent-provider";
import type {
  AgentSkillApprovalPolicy,
  AgentSkillExecutionMode,
} from "../../src/lib/channels-contract";
import {
  agentSkillBodyMaxLength,
  agentSkillDescriptionMaxLength,
  agentSkillsMaxCount,
} from "../../src/lib/agent-limits";

export type AgentSkillProvider = AgentProvider;
export type AgentSkillEffort = ModelEffort;
export type AgentSkillKind = "issue_processing" | "custom";

export type AgentSkillInput = {
  id?: string;
  name: string;
  description: string;
  body: string;
  provider: AgentSkillProvider;
  model: string | null;
  effort: AgentSkillEffort | null;
  kind: AgentSkillKind;
  executionMode?: AgentSkillExecutionMode;
  approvalPolicy?: AgentSkillApprovalPolicy;
  position: number;
};

export type AgentSkillRow = {
  id: string;
  agent_id: string;
  name: string;
  description: string;
  body: string;
  provider: AgentSkillProvider;
  model: string | null;
  effort: AgentSkillEffort | null;
  kind: AgentSkillKind;
  execution_mode: AgentSkillExecutionMode;
  approval_policy: AgentSkillApprovalPolicy;
  is_default: number;
  position: number;
  created_at: string;
  updated_at: string;
};

export type AgentSkillFallback = {
  name: string;
  description: string;
  body: string;
  provider: AgentSkillProvider;
  model: string | null;
  effort: AgentSkillEffort | null;
  kind?: AgentSkillKind;
  executionMode?: AgentSkillExecutionMode;
  approvalPolicy?: AgentSkillApprovalPolicy;
};

export class AgentSkillConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentSkillConflictError";
  }
}

const agentSkillRosterConflictMessage =
  "Agent Skill roster changed or is referenced by queued or running work; refresh and try again";

export function agentSkillConflictMessage(error: unknown): string | null {
  if (error instanceof AgentSkillConflictError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  return /unique constraint failed:\s*briar_agent_skills\.id\b/iu.test(message)
    ? agentSkillRosterConflictMessage
    : null;
}

export function normalizedAgentSkillRows(
  agentId: string,
  input: readonly AgentSkillInput[] | undefined,
  fallback: AgentSkillFallback,
  observedAt: string,
): AgentSkillRow[] {
  const requested: readonly AgentSkillInput[] = input ?? [{
    ...fallback,
    kind: fallback.kind ?? "custom",
    position: 0,
  }];
  if (requested.length > agentSkillsMaxCount) {
    throw new Error(`An Agent can have at most ${agentSkillsMaxCount} Skills`);
  }
  const names = new Set<string>();
  const ids = new Set<string>();
  return requested.map((skill, index) => {
    const normalizedName = skill.name.trim();
    const normalizedDescription = skill.description.trim();
    const normalizedBody = skill.body.trim();
    const normalizedModel = skill.model?.trim() || null;
    const nameKey = normalizedName.toLocaleLowerCase("en-US");
    if (!normalizedName || normalizedName.length > 100) {
      throw new Error("Agent Skill name must contain 1 to 100 characters");
    }
    if (names.has(nameKey)) {
      throw new Error("Agent Skill names must be unique within an Agent");
    }
    if (
      !normalizedDescription ||
      normalizedDescription.length > agentSkillDescriptionMaxLength
    ) {
      throw new Error(
        `Agent Skill description must contain 1 to ${agentSkillDescriptionMaxLength} characters`,
      );
    }
    names.add(nameKey);
    const id = skill.id ?? crypto.randomUUID();
    if (ids.has(id)) {
      throw new Error("Agent Skill IDs must be unique within an Agent");
    }
    ids.add(id);
    if (!normalizedBody || normalizedBody.length > agentSkillBodyMaxLength) {
      throw new Error(
        `Agent Skill body must contain 1 to ${agentSkillBodyMaxLength} characters`,
      );
    }
    return {
      id,
      agent_id: agentId,
      name: normalizedName,
      description: normalizedDescription,
      body: normalizedBody,
      provider: skill.provider,
      model: normalizedModel,
      effort: skill.effort,
      kind: skill.kind,
      execution_mode: skill.executionMode ?? "task",
      approval_policy: skill.approvalPolicy ?? "explicit",
      is_default: 0,
      position: skill.position ?? index,
      created_at: observedAt,
      updated_at: observedAt,
    };
  });
}

function upsertAgentSkillStatement(db: D1Database, skill: AgentSkillRow) {
  return db
    .prepare(
      `insert into briar_agent_skills (
         id, agent_id, name, description, body, provider, model, effort, kind,
         execution_mode, approval_policy, is_default, position, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (id) do update set
         name = excluded.name,
         description = excluded.description,
         body = excluded.body,
         provider = excluded.provider,
         model = excluded.model,
         effort = excluded.effort,
         kind = excluded.kind,
         execution_mode = excluded.execution_mode,
         approval_policy = excluded.approval_policy,
         is_default = excluded.is_default,
         position = excluded.position,
         updated_at = excluded.updated_at
       where briar_agent_skills.agent_id = excluded.agent_id`,
    )
    .bind(
      skill.id,
      skill.agent_id,
      skill.name,
      skill.description,
      skill.body,
      skill.provider,
      skill.model,
      skill.effort,
      skill.kind,
      skill.execution_mode,
      skill.approval_policy,
      skill.is_default,
      skill.position,
      skill.created_at,
      skill.updated_at,
    );
}

const activeAgentSkillJobPredicate = (skillAlias: string) => `
  exists (
    select 1 from briar_project_agent_task_jobs task
    where task.skill_id = ${skillAlias}.id
      and task.status in ('queued', 'running')
  )
  or exists (
    select 1 from briar_channel_agent_reply_jobs reply
    where reply.skill_id = ${skillAlias}.id
      and reply.status in ('queued', 'running')
  )`;

const activeDirectAgentSkillJobPredicate = (skillAlias: string) => `
  exists (
    select 1 from briar_project_agent_task_jobs task
    where task.skill_id = ${skillAlias}.id
      and task.status in ('queued', 'running')
  )`;

const agentSkillRuntimeChanged = (
  current: Pick<
    AgentSkillRow,
    "body" | "provider" | "model" | "effort" | "execution_mode" | "approval_policy"
  >,
  requested: Pick<
    AgentSkillRow,
    "body" | "provider" | "model" | "effort" | "execution_mode" | "approval_policy"
  >,
) =>
  current.body !== requested.body ||
  current.provider !== requested.provider ||
  current.model !== requested.model ||
  current.effort !== requested.effort ||
  current.execution_mode !== requested.execution_mode ||
  current.approval_policy !== requested.approval_policy;

export async function assertAgentSkillReplacementAllowed(
  db: D1Database,
  agentId: string,
  skills: readonly AgentSkillRow[],
) {
  const retainedSkillIds = skills.map((skill) => skill.id);
  if (retainedSkillIds.length === 0) {
    const blocked = await db
      .prepare(
        `select skill.name
         from briar_agent_skills skill
         where skill.agent_id = ?
           and (${activeAgentSkillJobPredicate("skill")})
         order by skill.position, skill.created_at, skill.id
         limit 1`,
      )
      .bind(agentId)
      .first<{ name: string }>();
    if (blocked) {
      throw new AgentSkillConflictError(
        `Agent Skill "${blocked.name}" cannot be deleted while queued or running work still references it`,
      );
    }
    return;
  }
  const placeholders = retainedSkillIds.map(() => "?").join(", ");
  const blocked = await db
    .prepare(
      `select skill.name
       from briar_agent_skills skill
       where skill.agent_id = ? and skill.id not in (${placeholders})
         and (${activeAgentSkillJobPredicate("skill")})
       order by skill.position, skill.created_at, skill.id
       limit 1`,
    )
    .bind(agentId, ...retainedSkillIds)
    .first<{ name: string }>();
  if (blocked) {
    throw new AgentSkillConflictError(
      `Agent Skill "${blocked.name}" cannot be deleted while queued or running work still references it`,
    );
  }

  const active = await db
    .prepare(
      `select skill.id, skill.name, skill.body, skill.provider,
              skill.model, skill.effort, skill.execution_mode,
              skill.approval_policy
       from briar_agent_skills skill
       where skill.agent_id = ? and skill.id in (${placeholders})
         and (${activeDirectAgentSkillJobPredicate("skill")})
       order by skill.position, skill.created_at, skill.id`,
    )
    .bind(agentId, ...retainedSkillIds)
    .all<
      Pick<
        AgentSkillRow,
        "id" | "name" | "body" | "provider" | "model" | "effort" |
          "execution_mode" | "approval_policy"
      >
    >();
  const requestedById = new Map(skills.map((skill) => [skill.id, skill]));
  const changed = active.results.find((current) => {
    const requested = requestedById.get(current.id);
    return requested ? agentSkillRuntimeChanged(current, requested) : false;
  });
  if (changed) {
    throw new AgentSkillConflictError(
      `Agent Skill "${changed.name}" cannot change body or execution settings while queued or running direct Agent work still references it`,
    );
  }
}

function guardActiveDirectAgentSkillRuntimeStatement(
  db: D1Database,
  agentId: string,
  skills: readonly AgentSkillRow[],
) {
  const requestedRuntimeJson = JSON.stringify(
    skills.map((skill) => ({
      id: skill.id,
      body: skill.body,
      provider: skill.provider,
      model: skill.model,
      effort: skill.effort,
      executionMode: skill.execution_mode,
      approvalPolicy: skill.approval_policy,
    })),
  );
  return db
    .prepare(
      `with requested as (
         select json_extract(value, '$.id') as id,
                json_extract(value, '$.body') as body,
                json_extract(value, '$.provider') as provider,
                json_extract(value, '$.model') as model,
                json_extract(value, '$.effort') as effort,
                json_extract(value, '$.executionMode') as execution_mode,
                json_extract(value, '$.approvalPolicy') as approval_policy
         from json_each(?)
       )
       insert into briar_agent_skills (
         id, agent_id, name, description, body, provider, model, effort, kind,
         execution_mode, approval_policy, is_default, position, created_at, updated_at
       )
       select skill.id, skill.agent_id, skill.name, skill.description,
              skill.body, skill.provider, skill.model, skill.effort, skill.kind,
              skill.execution_mode, skill.approval_policy,
              skill.is_default, skill.position, skill.created_at,
              skill.updated_at
       from briar_agent_skills skill
       join requested on requested.id = skill.id
       where skill.agent_id = ?
         and (${activeDirectAgentSkillJobPredicate("skill")})
         and (
           skill.body is not requested.body
           or skill.provider is not requested.provider
           or skill.model is not requested.model
           or skill.effort is not requested.effort
           or skill.execution_mode is not requested.execution_mode
           or skill.approval_policy is not requested.approval_policy
         )
       limit 1`,
    )
    .bind(requestedRuntimeJson, agentId);
}

/**
 * Replaces an Agent's Skill roster without deleting rows whose IDs are kept.
 *
 * The statements must run in one D1 batch. First, a copied-row insert turns an
 * ID owned by another Agent into a deliberate primary-key failure, so the
 * entire batch rolls back instead of silently adopting or ignoring it. Existing
 * names are then moved out of the unique index before the final
 * upserts, which makes name swaps safe. Only omitted IDs
 * are deleted (and therefore only those job references can be set to null).
 */
export function replaceAgentSkillStatements(
  db: D1Database,
  agentId: string,
  skills: readonly AgentSkillRow[],
): D1PreparedStatement[] {
  if (skills.some((skill) => skill.agent_id !== agentId)) {
    throw new Error("Agent Skill rows must belong to the Agent being updated");
  }
  const ids = skills.map((skill) => skill.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Agent Skill IDs must be unique within an Agent");
  }
  if (ids.length === 0) {
    return [
      // Preserve the active-work deletion guard inside the same atomic batch
      // as the roster replacement so a new reference cannot race the preflight.
      db
        .prepare(
          `insert into briar_agent_skills (
             id, agent_id, name, description, body, provider, model, effort, kind,
             execution_mode, approval_policy, is_default, position, created_at, updated_at
           )
           select skill.id, skill.agent_id, skill.name, skill.description,
                  skill.body, skill.provider, skill.model, skill.effort, skill.kind,
                  skill.execution_mode, skill.approval_policy,
                  skill.is_default, skill.position, skill.created_at,
                  skill.updated_at
           from briar_agent_skills skill
           where skill.agent_id = ?
             and (${activeAgentSkillJobPredicate("skill")})
           limit 1`,
        )
        .bind(agentId),
      db
        .prepare(`delete from briar_agent_skills where agent_id = ?`)
        .bind(agentId),
    ];
  }
  const placeholders = ids.map(() => "?").join(", ");
  return [
    db
      .prepare(
        `insert into briar_agent_skills (
           id, agent_id, name, description, body, provider, model, effort, kind,
           execution_mode, approval_policy, is_default, position, created_at, updated_at
         )
         select id, agent_id, name, description, body, provider, model, effort, kind,
                execution_mode, approval_policy, is_default, position, created_at, updated_at
         from briar_agent_skills
         where id in (${placeholders}) and agent_id != ?
         limit 1`,
      )
      .bind(...ids, agentId),
    // Runtime settings are read when a direct task is claimed. Changing them
    // while that task is queued or running can make its pinned Worker
    // ineligible or resume it with a different provider. The self-insert turns
    // a preflight race into the same retryable primary-key conflict used by the
    // deletion guard below.
    guardActiveDirectAgentSkillRuntimeStatement(db, agentId, skills),
    // Close the race between the friendly preflight check and this atomic
    // batch. Copying a still-referenced removed row conflicts with its own
    // primary key and rolls the complete Agent update back.
    db
      .prepare(
        `insert into briar_agent_skills (
           id, agent_id, name, description, body, provider, model, effort, kind,
           execution_mode, approval_policy, is_default, position, created_at, updated_at
         )
         select skill.id, skill.agent_id, skill.name, skill.description,
                skill.body, skill.provider, skill.model, skill.effort, skill.kind,
                skill.execution_mode, skill.approval_policy,
                skill.is_default, skill.position, skill.created_at,
                skill.updated_at
         from briar_agent_skills skill
         where skill.agent_id = ? and skill.id not in (${placeholders})
           and (${activeAgentSkillJobPredicate("skill")})
         limit 1`,
      )
      .bind(agentId, ...ids),
    db
      .prepare(
        `update briar_agent_skills
         set is_default = 0,
             name = '__briar_tmp_' || lower(hex(randomblob(16))) || '_' || id
         where agent_id = ?`,
      )
      .bind(agentId),
    db
      .prepare(
        `delete from briar_agent_skills
         where agent_id = ? and id not in (${placeholders})`,
      )
      .bind(agentId, ...ids),
    ...skills.map((skill) => upsertAgentSkillStatement(db, skill)),
  ];
}

export function insertAgentSkillStatement(
  db: D1Database,
  skill: AgentSkillRow,
) {
  return db
    .prepare(
      `insert into briar_agent_skills (
         id, agent_id, name, description, body, provider, model, effort, kind,
         execution_mode, approval_policy, is_default, position, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      skill.id,
      skill.agent_id,
      skill.name,
      skill.description,
      skill.body,
      skill.provider,
      skill.model,
      skill.effort,
      skill.kind,
      skill.execution_mode,
      skill.approval_policy,
      skill.is_default,
      skill.position,
      skill.created_at,
      skill.updated_at,
    );
}

/**
 * A client from before first-class Skills omits the `skills` field and expects
 * the Agent execution controls to affect the next run. Preserve that behavior
 * only when the Agent has one unambiguous Skill. A multi-Skill roster must
 * never be changed by an implicit selection.
 */
export function soleAgentSkillRowFromLegacy(
  skills: readonly AgentSkillRow[],
  input: {
    description: string;
    body: string;
    provider: AgentSkillProvider;
    model: string | null;
    effort: AgentSkillEffort | null;
    updatedAt: string;
  },
) {
  if (skills.length !== 1) return null;
  return {
    ...skills[0],
    description: input.description.trim(),
    body: input.body.trim(),
    provider: input.provider,
    model: input.model?.trim() || null,
    effort: input.effort,
    is_default: 0,
    updated_at: input.updatedAt,
  } satisfies AgentSkillRow;
}

export async function listAgentSkills(
  db: D1Database,
  agentIds: readonly string[],
) {
  if (agentIds.length === 0) return [];
  const uniqueAgentIds = [...new Set(agentIds)];
  const rows: AgentSkillRow[] = [];
  for (let offset = 0; offset < uniqueAgentIds.length; offset += 100) {
    const chunk = uniqueAgentIds.slice(offset, offset + 100);
    const placeholders = chunk.map(() => "?").join(", ");
    const result = await db
      .prepare(
        `select id, agent_id, name, description, body, provider, model, effort, kind,
                execution_mode, approval_policy, is_default, position, created_at, updated_at
         from briar_agent_skills
         where agent_id in (${placeholders})
         order by agent_id, position, created_at, id`,
      )
      .bind(...chunk)
      .all<AgentSkillRow>();
    rows.push(...result.results);
  }
  return rows.sort((left, right) =>
    left.agent_id < right.agent_id
      ? -1
      : left.agent_id > right.agent_id
        ? 1
        : left.position - right.position ||
          left.created_at.localeCompare(right.created_at) ||
          left.id.localeCompare(right.id)
  );
}

export async function getAgentSkill(
  db: D1Database,
  agentId: string,
  skillId?: string | null,
) {
  if (skillId) {
    return db
      .prepare(
        `select id, agent_id, name, description, body, provider, model, effort, kind,
                execution_mode, approval_policy, is_default, position, created_at, updated_at
         from briar_agent_skills
         where agent_id = ? and id = ?
         limit 1`,
      )
      .bind(agentId, skillId)
      .first<AgentSkillRow>();
  }
  const result = await db
    .prepare(
      `select id, agent_id, name, description, body, provider, model, effort, kind,
              execution_mode, approval_policy, is_default, position, created_at, updated_at
       from briar_agent_skills
       where agent_id = ?
       order by position, created_at, id
       limit 2`,
    )
    .bind(agentId)
    .all<AgentSkillRow>();
  return result.results.length === 1 ? result.results[0] : null;
}

export async function hydrateAgentSkills<T extends { id: string }>(
  db: D1Database,
  agents: readonly T[],
): Promise<Array<T & { skills: AgentSkillRow[] }>> {
  const skills = await listAgentSkills(db, agents.map((agent) => agent.id));
  const byAgent = new Map<string, AgentSkillRow[]>();
  for (const skill of skills) {
    const current = byAgent.get(skill.agent_id) ?? [];
    current.push(skill);
    byAgent.set(skill.agent_id, current);
  }
  return agents.map((agent) => ({
    ...agent,
    skills: byAgent.get(agent.id) ?? [],
  }));
}

export const agentSkillJson = (skill: AgentSkillRow) => ({
  id: skill.id,
  agentId: skill.agent_id,
  name: skill.name,
  description: skill.description,
  body: skill.body,
  // Rolling/native compatibility only. New clients persist description/body.
  instructions: skill.body,
  provider: skill.provider,
  model: skill.model,
  effort: skill.effort,
  kind: skill.kind,
  executionMode: skill.execution_mode,
  approvalPolicy: skill.approval_policy,
  // Workers from before explicit Skill selection require this wire field.
  // It is always false and has no selection or persistence semantics.
  isDefault: false,
  position: skill.position,
  createdAt: skill.created_at,
  updatedAt: skill.updated_at,
});

export const issueProcessingAgentSkillRow = (
  skills: readonly AgentSkillRow[],
) => skills.find((skill) => skill.kind === "issue_processing") ?? null;
