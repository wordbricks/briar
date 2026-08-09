export type AgentSkillProvider = "codex" | "claude" | "grok" | "opencode";
export type AgentSkillEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max"
  | "ultra";
export type AgentSkillKind = "issue_processing" | "custom";

export type AgentSkillInput = {
  id?: string;
  name: string;
  instructions: string;
  provider: AgentSkillProvider;
  model: string | null;
  effort: AgentSkillEffort | null;
  kind: AgentSkillKind;
  isDefault: boolean;
  position: number;
};

export type AgentSkillRow = {
  id: string;
  agent_id: string;
  name: string;
  instructions: string;
  provider: AgentSkillProvider;
  model: string | null;
  effort: AgentSkillEffort | null;
  kind: AgentSkillKind;
  is_default: number;
  position: number;
  created_at: string;
  updated_at: string;
};

export type AgentSkillFallback = {
  name: string;
  instructions: string;
  provider: AgentSkillProvider;
  model: string | null;
  effort: AgentSkillEffort | null;
  kind?: AgentSkillKind;
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
  const requested = input?.length
    ? input
    : [{
        ...fallback,
        kind: fallback.kind ?? "custom",
        isDefault: true,
        position: 0,
      }];
  if (requested.filter((skill) => skill.isDefault).length !== 1) {
    throw new Error("An Agent must have exactly one default Skill");
  }
  const names = new Set<string>();
  const ids = new Set<string>();
  return requested.map((skill, index) => {
    const normalizedName = skill.name.trim();
    const normalizedInstructions = skill.instructions.trim();
    const normalizedModel = skill.model?.trim() || null;
    const nameKey = normalizedName.toLocaleLowerCase("en-US");
    if (!normalizedName || normalizedName.length > 100) {
      throw new Error("Agent Skill name must contain 1 to 100 characters");
    }
    if (names.has(nameKey)) {
      throw new Error("Agent Skill names must be unique within an Agent");
    }
    names.add(nameKey);
    const id = skill.id ?? crypto.randomUUID();
    if (ids.has(id)) {
      throw new Error("Agent Skill IDs must be unique within an Agent");
    }
    ids.add(id);
    if (normalizedInstructions.length > 10_000) {
      throw new Error("Agent Skill instructions cannot exceed 10000 characters");
    }
    return {
      id,
      agent_id: agentId,
      name: normalizedName,
      instructions: normalizedInstructions,
      provider: skill.provider,
      model: normalizedModel,
      effort: skill.effort,
      kind: skill.kind,
      is_default: skill.isDefault ? 1 : 0,
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
         id, agent_id, name, instructions, provider, model, effort, kind,
         is_default, position, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (id) do update set
         name = excluded.name,
         instructions = excluded.instructions,
         provider = excluded.provider,
         model = excluded.model,
         effort = excluded.effort,
         kind = excluded.kind,
         is_default = excluded.is_default,
         position = excluded.position,
         updated_at = excluded.updated_at
       where briar_agent_skills.agent_id = excluded.agent_id`,
    )
    .bind(
      skill.id,
      skill.agent_id,
      skill.name,
      skill.instructions,
      skill.provider,
      skill.model,
      skill.effort,
      skill.kind,
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

export async function assertAgentSkillReplacementAllowed(
  db: D1Database,
  agentId: string,
  retainedSkillIds: readonly string[],
) {
  if (retainedSkillIds.length === 0) return;
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
}

/**
 * Replaces an Agent's Skill roster without deleting rows whose IDs are kept.
 *
 * The statements must run in one D1 batch. First, a copied-row insert turns an
 * ID owned by another Agent into a deliberate primary-key failure, so the
 * entire batch rolls back instead of silently adopting or ignoring it. Existing
 * names/defaults are then moved out of the unique indexes before the final
 * upserts, which makes name swaps and default changes safe. Only omitted IDs
 * are deleted (and therefore only those job references can be set to null).
 */
export function replaceAgentSkillStatements(
  db: D1Database,
  agentId: string,
  skills: readonly AgentSkillRow[],
): D1PreparedStatement[] {
  if (skills.length === 0) {
    throw new Error("An Agent must have at least one Skill");
  }
  if (skills.some((skill) => skill.agent_id !== agentId)) {
    throw new Error("Agent Skill rows must belong to the Agent being updated");
  }
  if (skills.filter((skill) => skill.is_default === 1).length !== 1) {
    throw new Error("An Agent must have exactly one default Skill");
  }
  const ids = skills.map((skill) => skill.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Agent Skill IDs must be unique within an Agent");
  }
  const placeholders = ids.map(() => "?").join(", ");
  return [
    db
      .prepare(
        `insert into briar_agent_skills (
           id, agent_id, name, instructions, provider, model, effort, kind,
           is_default, position, created_at, updated_at
         )
         select id, agent_id, name, instructions, provider, model, effort, kind,
                is_default, position, created_at, updated_at
         from briar_agent_skills
         where id in (${placeholders}) and agent_id != ?
         limit 1`,
      )
      .bind(...ids, agentId),
    // Close the race between the friendly preflight check and this atomic
    // batch. Copying a still-referenced removed row conflicts with its own
    // primary key and rolls the complete Agent update back.
    db
      .prepare(
        `insert into briar_agent_skills (
           id, agent_id, name, instructions, provider, model, effort, kind,
           is_default, position, created_at, updated_at
         )
         select skill.id, skill.agent_id, skill.name, skill.instructions,
                skill.provider, skill.model, skill.effort, skill.kind,
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
         id, agent_id, name, instructions, provider, model, effort, kind,
         is_default, position, created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      skill.id,
      skill.agent_id,
      skill.name,
      skill.instructions,
      skill.provider,
      skill.model,
      skill.effort,
      skill.kind,
      skill.is_default,
      skill.position,
      skill.created_at,
      skill.updated_at,
    );
}

/**
 * A client from before first-class Skills omits the `skills` field and expects
 * the Agent execution controls to affect the next run. Keep that rolling
 * compatibility behavior scoped to the default Skill; current clients submit
 * the complete roster and therefore keep Agent-level new-Skill defaults
 * independent from existing Skill runtimes.
 */
export function updateDefaultAgentSkillFromLegacyStatement(
  db: D1Database,
  input: {
    agentId: string;
    instructions: string;
    provider: AgentSkillProvider;
    model: string | null;
    effort: AgentSkillEffort | null;
    updatedAt: string;
  },
) {
  return db
    .prepare(
      `update briar_agent_skills
       set instructions = ?, provider = ?, model = ?, effort = ?, updated_at = ?
       where agent_id = ? and is_default = 1`,
    )
    .bind(
      input.instructions.trim(),
      input.provider,
      input.model?.trim() || null,
      input.effort,
      input.updatedAt,
      input.agentId,
    );
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
        `select id, agent_id, name, instructions, provider, model, effort, kind,
                is_default, position, created_at, updated_at
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
  const condition = skillId ? "id = ?" : "is_default = 1";
  return db
    .prepare(
      `select id, agent_id, name, instructions, provider, model, effort, kind,
              is_default, position, created_at, updated_at
       from briar_agent_skills
       where agent_id = ? and ${condition}
       order by position, created_at, id
       limit 1`,
    )
    .bind(...(skillId ? [agentId, skillId] : [agentId]))
    .first<AgentSkillRow>();
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
  instructions: skill.instructions,
  provider: skill.provider,
  model: skill.model,
  effort: skill.effort,
  kind: skill.kind,
  isDefault: skill.is_default === 1,
  position: skill.position,
  createdAt: skill.created_at,
  updatedAt: skill.updated_at,
});

export const defaultAgentSkillRow = (skills: readonly AgentSkillRow[]) =>
  skills.find((skill) => skill.is_default === 1) ?? null;

export const issueProcessingAgentSkillRow = (
  skills: readonly AgentSkillRow[],
) =>
  skills.find((skill) => skill.kind === "issue_processing") ??
  defaultAgentSkillRow(skills);

/**
 * A channel invocation can name one of the Agent's saved Skills in plain
 * language. Prefer the longest matching name so a specific Skill such as
 * "iOS release" wins over a broader "release" Skill; otherwise use the
 * configured default.
 */
export function agentSkillForMessage(
  skills: readonly AgentSkillRow[],
  message: string,
) {
  const normalizedMessage = message.normalize("NFKC").toLocaleLowerCase();
  return (
    [...skills]
      .sort((left, right) => right.name.length - left.name.length)
      .find((skill) =>
        normalizedMessage.includes(
          skill.name.normalize("NFKC").toLocaleLowerCase(),
        ),
      ) ?? defaultAgentSkillRow(skills)
  );
}
