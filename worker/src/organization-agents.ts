import {
  handleFromName,
  type ChannelAgentProvider as AgentProvider,
  type ChannelAgentSummary,
} from "../../src/lib/channels-contract";

export type OrganizationAgentRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  handle: string | null;
  name: string;
  provider: AgentProvider;
  model: string | null;
  responsibility: string;
  effort: string | null;
  created_at: string;
  updated_at: string;
};

export const organizationAgentJson = (
  row: OrganizationAgentRow,
): ChannelAgentSummary => ({
  agentId: row.id,
  handle: row.handle,
  name: row.name,
  provider: row.provider,
  model: row.model,
  projectId: row.project_id,
  responsibility: row.responsibility,
  createdAt: row.created_at,
});

const agentSelect = `
  select id, organization_id, project_id, handle, name, provider, model,
         responsibility, effort, created_at, updated_at
  from briar_project_agents`;

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
      `select handle from briar_project_agents
       where organization_id = ? and handle is not null
         and (handle = ? or handle glob ?)`,
    )
    .bind(organizationId, base, `${base}-[0-9]*`)
    .all<{ handle: string }>();
  const used = new Set(taken.results.map((row) => row.handle));
  if (!used.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, 59)}-${suffix}`;
    if (!used.has(candidate)) return candidate;
  }
  return `agent-${agentId.replaceAll("-", "")}`;
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
            `${agentSelect} where organization_id = ?
             order by project_id is not null, name, id`,
          )
          .bind(organizationId)
          .all<OrganizationAgentRow>()
      : options.projectId === null
        ? await db
            .prepare(
              `${agentSelect} where organization_id = ? and project_id is null
               order by name, id`,
            )
            .bind(organizationId)
            .all<OrganizationAgentRow>()
        : await db
            .prepare(
              `${agentSelect} where organization_id = ? and project_id = ?
               order by name, id`,
            )
            .bind(organizationId, options.projectId)
            .all<OrganizationAgentRow>();
  return rows.results;
}

export async function getOrganizationAgent(
  db: D1Database,
  organizationId: string,
  agentId: string,
) {
  return db
    .prepare(`${agentSelect} where organization_id = ? and id = ?`)
    .bind(organizationId, agentId)
    .first<OrganizationAgentRow>();
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
    effort: string | null;
    createdAt: string;
  },
) {
  const handle = await allocateAgentHandle(
    db,
    input.organizationId,
    input.handle ?? input.name,
    input.id,
  );
  await db
    .prepare(
      `insert into briar_project_agents (
         id, organization_id, project_id, handle, name, provider, model,
         responsibility, effort, created_at, updated_at
       ) values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
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
    )
    .run();
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
    effort: string | null;
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
  const handle =
    desired === existing.handle
      ? existing.handle
      : await allocateAgentHandle(
          db,
          input.organizationId,
          desired,
          input.agentId,
        );
  await db
    .prepare(
      `update briar_project_agents
       set handle = ?, name = ?, provider = ?, model = ?, responsibility = ?,
           effort = ?, updated_at = ?
       where id = ? and organization_id = ? and project_id is null`,
    )
    .bind(
      handle,
      input.name,
      input.provider,
      input.model,
      input.responsibility,
      input.effort,
      input.updatedAt,
      input.agentId,
      input.organizationId,
    )
    .run();
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
