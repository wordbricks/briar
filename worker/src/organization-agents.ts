import {
  handleFromName,
  type ChannelAgentProvider as AgentProvider,
  type ChannelAgentSummary,
} from "../../src/lib/channels-contract";
import {
  assertAgentSkillReplacementAllowed,
  agentSkillJson,
  hydrateAgentSkills,
  insertAgentSkillStatement,
  normalizedAgentSkillRows,
  replaceAgentSkillStatements,
  soleAgentSkillRowFromLegacy,
  type AgentSkillEffort,
  type AgentSkillInput,
  type AgentSkillRow,
} from "./agent-skills";

export type OrganizationAgentRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  project_name: string | null;
  handle: string | null;
  name: string;
  avatar: string | null;
  provider: AgentProvider;
  model: string | null;
  responsibility: string;
  skill_markdown?: string;
  effort: AgentSkillEffort | null;
  created_at: string;
  updated_at: string;
  skills?: AgentSkillRow[];
};

export const organizationAgentJson = (
  row: OrganizationAgentRow,
): ChannelAgentSummary & { skills: ReturnType<typeof agentSkillJson>[] } => ({
  agentId: row.id,
  handle: row.handle,
  name: row.name,
  avatar: row.avatar,
  provider: row.provider,
  model: row.model,
  effort: row.effort,
  projectId: row.project_id,
  projectName: row.project_name,
  responsibility: row.responsibility,
  skills: (row.skills ?? []).map(agentSkillJson),
  createdAt: row.created_at,
});

const agentSelect = `
  select agent.id, agent.organization_id, agent.project_id,
         project.name as project_name, agent.handle, agent.name, agent.avatar,
         agent.provider, agent.model, agent.responsibility,
         agent.skill_markdown, agent.effort, agent.created_at, agent.updated_at
  from briar_project_agents agent
  left join briar_projects project on project.id = agent.project_id`;

/**
 * Handles are unique per organization, so a desired handle that is taken gets a
 * numeric suffix. A name that leaves nothing behind after normalization (any
 * name with no Latin characters) falls back to the agent id, matching how
 * organization handles were backfilled in migration 0012.
 */
export async function allocateAgentHandle(
  db: D1Database,
  organizationId: string,
  desired: string,
  agentId: string,
) {
  const base =
    handleFromName(desired) || `agent-${agentId.replaceAll("-", "")}`;
  const taken = await db
    .prepare(
      `select id, handle from briar_project_agents
       where organization_id = ? and handle is not null`,
    )
    .bind(organizationId)
    .all<{ id: string; handle: string }>();
  const used = new Set(
    taken.results
      .filter((row) => row.id !== agentId)
      .map((row) => row.handle),
  );
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const suffixText = `-${suffix}`;
    const candidate = `${base.slice(0, 63 - suffixText.length)}${suffixText}`;
    if (!used.has(candidate)) return candidate;
  }
  return `agent-${agentId.replaceAll("-", "")}`;
}

function isAgentHandleConflict(error: unknown) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return message.includes("unique") &&
    message.includes("briar_project_agents") &&
    message.includes("handle");
}

/**
 * Allocation and mutation cannot be one D1 statement for the Agent writes that
 * also replace skills. If another request claims the candidate between the
 * lookup and the batch, rerun allocation and retry the whole atomic batch.
 */
export async function withAllocatedAgentHandle<T>(
  db: D1Database,
  organizationId: string,
  desired: string,
  agentId: string,
  write: (handle: string) => Promise<T>,
) {
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const handle = await allocateAgentHandle(
      db,
      organizationId,
      desired,
      agentId,
    );
    try {
      return await write(handle);
    } catch (error) {
      if (!isAgentHandleConflict(error) || attempt === 999) throw error;
    }
  }
  throw new Error("Agent handle allocation exhausted");
}

export async function listOrganizationAgents(
  db: D1Database,
  organizationId: string,
  options: { projectId?: string | null } = {},
) {
  const rows =
    options.projectId === undefined
      ? await db
          .prepare(
            `${agentSelect} where agent.organization_id = ?
             order by agent.project_id is not null, agent.name, agent.id`,
          )
          .bind(organizationId)
          .all<OrganizationAgentRow>()
      : options.projectId === null
        ? await db
            .prepare(
              `${agentSelect} where agent.organization_id = ? and agent.project_id is null
               order by agent.name, agent.id`,
            )
            .bind(organizationId)
            .all<OrganizationAgentRow>()
        : await db
            .prepare(
              `${agentSelect} where agent.organization_id = ? and agent.project_id = ?
               order by agent.name, agent.id`,
            )
            .bind(organizationId, options.projectId)
            .all<OrganizationAgentRow>();
  return hydrateAgentSkills(db, rows.results);
}

export async function getOrganizationAgent(
  db: D1Database,
  organizationId: string,
  agentId: string,
) {
  const agent = await db
    .prepare(`${agentSelect} where agent.organization_id = ? and agent.id = ?`)
    .bind(organizationId, agentId)
    .first<OrganizationAgentRow>();
  if (!agent) return null;
  return (await hydrateAgentSkills(db, [agent]))[0];
}

export async function createOrganizationAgent(
  db: D1Database,
  input: {
    id: string;
    organizationId: string;
    name: string;
    handle?: string;
    provider: AgentProvider;
    model: string | null;
    responsibility: string;
    effort: AgentSkillEffort | null;
    skills?: AgentSkillInput[];
    createdAt: string;
  },
) {
  const skillRows = normalizedAgentSkillRows(
    input.id,
    input.skills,
    {
      name: input.name,
      instructions: input.responsibility,
      provider: input.provider,
      model: input.model,
      effort: input.effort,
      kind: "custom",
    },
    input.createdAt,
  );
  await withAllocatedAgentHandle(
    db,
    input.organizationId,
    input.handle ?? input.name,
    input.id,
    async (handle) =>
      db.batch([
        db.prepare(
          `insert into briar_project_agents (
             id, organization_id, project_id, handle, name, provider, model,
             responsibility, effort, created_at, updated_at
           ) values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          input.id,
          input.organizationId,
          handle,
          input.name,
          input.provider,
          input.model,
          input.responsibility,
          input.effort,
          input.createdAt,
          input.createdAt,
        ),
        ...skillRows.map((skill) => insertAgentSkillStatement(db, skill)),
      ]),
  );
  return getOrganizationAgent(db, input.organizationId, input.id);
}

export async function updateOrganizationAgent(
  db: D1Database,
  input: {
    organizationId: string;
    agentId: string;
    name: string;
    handle?: string;
    provider: AgentProvider;
    model: string | null;
    responsibility: string;
    effort: AgentSkillEffort | null;
    skills?: AgentSkillInput[];
    updatedAt: string;
  },
) {
  const existing = await getOrganizationAgent(
    db,
    input.organizationId,
    input.agentId,
  );
  if (!existing || existing.project_id !== null) return null;
  const desired = input.handle ?? existing.handle ?? input.name;
  const supplementalStatements: D1PreparedStatement[] = [];
  if (input.skills !== undefined) {
    const skillRows = normalizedAgentSkillRows(
      input.agentId,
      input.skills,
      {
        name: input.name,
        instructions: input.responsibility,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        kind: "custom",
      },
      input.updatedAt,
    );
    await assertAgentSkillReplacementAllowed(
      db,
      input.agentId,
      skillRows,
    );
    supplementalStatements.push(
      ...replaceAgentSkillStatements(db, input.agentId, skillRows),
    );
  } else {
    const legacySkill = soleAgentSkillRowFromLegacy(existing.skills ?? [], {
        instructions: input.responsibility,
        provider: input.provider,
        model: input.model,
        effort: input.effort,
        updatedAt: input.updatedAt,
      });
    if (legacySkill) {
      await assertAgentSkillReplacementAllowed(db, input.agentId, [legacySkill]);
      supplementalStatements.push(
        ...replaceAgentSkillStatements(db, input.agentId, [legacySkill]),
      );
    }
  }
  const write = async (handle: string) =>
    db.batch([
      db.prepare(
        `update briar_project_agents
         set handle = ?, name = ?, provider = ?, model = ?, responsibility = ?,
             effort = ?, updated_at = ?
         where id = ? and organization_id = ? and project_id is null`,
      ).bind(
        handle,
        input.name,
        input.provider,
        input.model,
        input.responsibility,
        input.effort,
        input.updatedAt,
        input.agentId,
        input.organizationId,
      ),
      ...supplementalStatements,
    ]);
  if (desired === existing.handle) await write(existing.handle);
  else {
    await withAllocatedAgentHandle(
      db,
      input.organizationId,
      desired,
      input.agentId,
      write,
    );
  }
  return getOrganizationAgent(db, input.organizationId, input.agentId);
}

export async function deleteOrganizationAgent(
  db: D1Database,
  organizationId: string,
  agentId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_project_agents
       where id = ? and organization_id = ? and project_id is null`,
    )
    .bind(agentId, organizationId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
