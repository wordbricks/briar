import {
  type ChannelAgentProvider as AgentProvider,
  type ChannelAgentSummary,
} from "../../src/lib/channels-contract";
import type { ComputerUsePolicy } from "../../src/lib/computer-use-contract";
import {
  assertAgentSkillReplacementAllowed,
  agentSkillJson,
  hydrateAgentSkills,
  insertAgentSkillStatement,
  normalizedAgentSkillRows,
  replaceAgentSkillStatements,
  type AgentSkillEffort,
  type AgentSkillInput,
  type AgentSkillRow,
} from "./agent-skills";

export type WorkspaceAgentRow = {
  id: string;
  organization_id: string;
  project_id: string | null;
  project_name: string | null;
  name: string;
  avatar: string | null;
  provider: AgentProvider;
  model: string | null;
  description: string;
  responsibility: string;
  skill_markdown?: string;
  effort: AgentSkillEffort | null;
  computer_use_policy: ComputerUsePolicy;
  designated_worker_id?: string | null;
  designated_worker_label?: string | null;
  created_at: string;
  updated_at: string;
  skills?: AgentSkillRow[];
};

export const organizationAgentJson = (
  row: WorkspaceAgentRow,
): ChannelAgentSummary & { skills: ReturnType<typeof agentSkillJson>[] } => ({
  agentId: row.id,
  name: row.name,
  avatar: row.avatar,
  provider: row.provider,
  model: row.model,
  effort: row.effort,
  computerUsePolicy: row.computer_use_policy,
  projectId: row.project_id,
  projectName: row.project_name,
  description: row.description,
  responsibility: row.responsibility,
  skills: (row.skills ?? []).map(agentSkillJson),
  createdAt: row.created_at,
});

const agentSelect = `
  select agent.id, agent.organization_id, agent.project_id,
         team.name as project_name, agent.name, agent.avatar,
         agent.provider, agent.model, agent.description, agent.responsibility,
         agent.skill_markdown, agent.effort, agent.computer_use_policy,
         agent.designated_worker_id,
         agent.designated_worker_label, agent.created_at, agent.updated_at
  from briar_project_agents agent
  left join briar_teams team on team.id = agent.project_id`;

export async function listWorkspaceAgents(
  db: D1Database,
  workspaceId: string,
  options: { projectId?: string | null } = {},
) {
  const rows =
    options.projectId === undefined
      ? await db
          .prepare(
            `${agentSelect} where agent.organization_id = ?
             order by agent.project_id is not null, agent.name, agent.id`,
          )
          .bind(workspaceId)
          .all<WorkspaceAgentRow>()
      : options.projectId === null
        ? await db
            .prepare(
              `${agentSelect} where agent.organization_id = ? and agent.project_id is null
               order by agent.name, agent.id`,
            )
            .bind(workspaceId)
            .all<WorkspaceAgentRow>()
        : await db
            .prepare(
              `${agentSelect} where agent.organization_id = ? and agent.project_id = ?
               order by agent.name, agent.id`,
            )
            .bind(workspaceId, options.projectId)
            .all<WorkspaceAgentRow>();
  return hydrateAgentSkills(db, rows.results);
}

export async function getWorkspaceAgent(
  db: D1Database,
  workspaceId: string,
  agentId: string,
) {
  const agent = await db
    .prepare(`${agentSelect} where agent.organization_id = ? and agent.id = ?`)
    .bind(workspaceId, agentId)
    .first<WorkspaceAgentRow>();
  if (!agent) return null;
  return (await hydrateAgentSkills(db, [agent]))[0];
}

export async function createWorkspaceAgent(
  db: D1Database,
  input: {
    id: string;
    workspaceId: string;
    name: string;
    provider: AgentProvider;
    model: string | null;
    description?: string;
    responsibility: string;
    effort: AgentSkillEffort | null;
    computerUsePolicy?: ComputerUsePolicy;
    skills?: AgentSkillInput[];
    createdAt: string;
  },
) {
  const skillRows = normalizedAgentSkillRows(
    input.id,
    input.skills ?? [],
    input.createdAt,
  );
  await db.batch([
    db.prepare(
      `insert into briar_project_agents (
         id, organization_id, project_id, name, provider, model,
         description, responsibility, effort, computer_use_policy,
         created_at, updated_at
       ) values (?, ?, null, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      input.id,
      input.workspaceId,
      input.name,
      input.provider,
      input.model,
      input.description ?? "",
      input.responsibility,
      input.effort,
      input.computerUsePolicy ?? "disabled",
      input.createdAt,
      input.createdAt,
    ),
    ...skillRows.map((skill) => insertAgentSkillStatement(db, skill)),
  ]);
  return getWorkspaceAgent(db, input.workspaceId, input.id);
}

export async function updateWorkspaceAgent(
  db: D1Database,
  input: {
    workspaceId: string;
    agentId: string;
    name: string;
    provider: AgentProvider;
    model: string | null;
    description?: string;
    responsibility: string;
    effort: AgentSkillEffort | null;
    computerUsePolicy?: ComputerUsePolicy;
    skills: AgentSkillInput[];
    updatedAt: string;
  },
) {
  const existing = await getWorkspaceAgent(
    db,
    input.workspaceId,
    input.agentId,
  );
  if (!existing || existing.project_id !== null) return null;
  const skillRows = normalizedAgentSkillRows(
    input.agentId,
    input.skills,
    input.updatedAt,
  );
  await assertAgentSkillReplacementAllowed(db, input.agentId, skillRows);
  const supplementalStatements = replaceAgentSkillStatements(
    db,
    input.agentId,
    skillRows,
  );
  await db.batch([
    db.prepare(
      `update briar_project_agents
       set name = ?, provider = ?, model = ?, description = ?, responsibility = ?,
           effort = ?, computer_use_policy = coalesce(?, computer_use_policy),
           updated_at = ?
       where id = ? and organization_id = ? and project_id is null`,
    ).bind(
      input.name,
      input.provider,
      input.model,
      input.description ?? existing.description,
      input.responsibility,
      input.effort,
      input.computerUsePolicy ?? null,
      input.updatedAt,
      input.agentId,
      input.workspaceId,
    ),
    ...supplementalStatements,
  ]);
  return getWorkspaceAgent(db, input.workspaceId, input.agentId);
}

export async function deleteWorkspaceAgent(
  db: D1Database,
  workspaceId: string,
  agentId: string,
) {
  const result = await db
    .prepare(
      `delete from briar_project_agents
       where id = ? and organization_id = ? and project_id is null`,
    )
    .bind(agentId, workspaceId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
