import { teamAgentSkill } from "../../src/lib/team-agent";
import {
  assertAgentSkillReplacementAllowed,
  hydrateAgentSkills,
  insertAgentSkillStatement,
  normalizedAgentSkillRows,
  replaceAgentSkillStatements,
  type AgentSkillEffort,
  type AgentSkillInput,
} from "./agent-skills";

import {
  type TeamAgentProvider,
  type TeamAgentRow,
} from "./team-agent-model";
import type { ComputerUsePolicy } from "../../src/lib/computer-use-contract";

export async function listTeamAgents(db: D1Database, projectId: string) {
  const result = await db
    .prepare(
      `select id, organization_id, project_id, name, avatar, avatar_pet_json,
              avatar_spritesheet_object_key, provider, model, effort,
              computer_use_policy,
              designated_worker_id, designated_worker_label,
              description, responsibility, skill_markdown, calendar_color,
              created_at, updated_at
       from briar_project_agents
       where project_id = ?
       order by created_at, id`,
    )
    .bind(projectId)
    .all<TeamAgentRow>();
  return hydrateAgentSkills(db, result.results);
}

export async function getTeamAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
) {
  const agent = await db
    .prepare(
      `select id, organization_id, project_id, name, avatar, avatar_pet_json,
              avatar_spritesheet_object_key, provider, model, effort,
              computer_use_policy,
              designated_worker_id, designated_worker_label,
              description, responsibility,
              skill_markdown, calendar_color, created_at, updated_at
       from briar_project_agents
       where id = ? and project_id = ?`,
    )
    .bind(agentId, projectId)
    .first<TeamAgentRow>();
  if (!agent) return null;
  return (await hydrateAgentSkills(db, [agent]))[0];
}

export async function createTeamAgent(
  db: D1Database,
  projectId: string,
  input: {
    name: string;
    avatar?: string | null;
    avatarPetJson?: string | null;
    avatarSpritesheetObjectKey?: string | null;
    provider: TeamAgentProvider;
    model: string | null;
    effort: AgentSkillEffort | null;
    computerUsePolicy?: ComputerUsePolicy;
    designatedWorkerId?: string | null;
    designatedWorkerLabel?: string | null;
    description?: string;
    responsibility: string;
    calendarColor: string;
    skills?: AgentSkillInput[];
  },
) {
  const createdAt = new Date().toISOString();
  const agent: TeamAgentRow = {
    id: crypto.randomUUID(),
    organization_id: "",
    project_id: projectId,
    name: input.name,
    avatar: input.avatar ?? null,
    avatar_pet_json: input.avatarPetJson ?? null,
    avatar_spritesheet_object_key: input.avatarSpritesheetObjectKey ?? null,
    provider: input.provider,
    model: input.model,
    effort: input.effort,
    computer_use_policy: input.computerUsePolicy ?? "disabled",
    designated_worker_id: input.designatedWorkerId ?? null,
    designated_worker_label: input.designatedWorkerLabel ?? null,
    description: input.description ?? "",
    responsibility: input.responsibility,
    skill_markdown: teamAgentSkill({
      name: input.name,
      responsibility: input.responsibility,
    }),
    calendar_color: input.calendarColor,
    created_at: createdAt,
    updated_at: createdAt,
  };
  // Organization identity follows the project and is required before the
  // Agent can appear in a channel roster.
  const organization = await db
    .prepare(`select organization_id from briar_teams where id = ?`)
    .bind(projectId)
    .first<{ organization_id: string }>();
  if (!organization) throw new Error("Project not found");
  agent.organization_id = organization.organization_id;
  const skillRows = normalizedAgentSkillRows(
    agent.id,
    input.skills ?? [],
    createdAt,
  );
  await db.batch([
        db.prepare(
          `insert into briar_project_agents (
             id, organization_id, project_id, name, avatar,
             avatar_pet_json, avatar_spritesheet_object_key, provider, model,
             effort, computer_use_policy, designated_worker_id, designated_worker_label,
             description, responsibility, skill_markdown, calendar_color,
             created_at, updated_at
           ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          agent.id,
          organization.organization_id,
          agent.project_id,
          agent.name,
          agent.avatar,
          agent.avatar_pet_json,
          agent.avatar_spritesheet_object_key,
          agent.provider,
          agent.model,
          agent.effort,
          agent.computer_use_policy,
          agent.designated_worker_id,
          agent.designated_worker_label,
          agent.description,
          agent.responsibility,
          agent.skill_markdown,
          agent.calendar_color,
          agent.created_at,
          agent.updated_at,
        ),
        ...skillRows.map((skill) => insertAgentSkillStatement(db, skill)),
      ]);
  return (await getTeamAgent(db, projectId, agent.id))!;
}

export async function deleteTeamAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
) {
  const deleted = await db
    .prepare(
      `delete from briar_project_agents
       where id = ? and project_id = ?
         and not exists (
           select 1 from briar_project_agent_schedule_runs
           where project_id = ? and agent_id = ? and status = 'running'
         )
       returning id, organization_id, project_id, name, avatar, avatar_pet_json,
                 avatar_spritesheet_object_key, provider, model, effort,
                 computer_use_policy,
                 designated_worker_id, designated_worker_label,
                 description, responsibility, skill_markdown, calendar_color,
                 created_at, updated_at`,
    )
    .bind(agentId, projectId, projectId, agentId)
    .first<TeamAgentRow>();
  if (deleted) return deleted;
  return (await getTeamAgent(db, projectId, agentId)) ? "running" : null;
}

export async function updateTeamAgent(
  db: D1Database,
  projectId: string,
  agentId: string,
  input: {
    name: string;
    avatar?: string | null;
    codexPet?: {
      json: string;
      objectKey: string;
    } | null;
    provider: TeamAgentProvider;
    model: string | null;
    effort: AgentSkillEffort | null;
    computerUsePolicy?: ComputerUsePolicy;
    designatedWorkerId?: string | null;
    designatedWorkerLabel?: string | null;
    description?: string;
    responsibility: string;
    calendarColor: string;
    skills: AgentSkillInput[];
  },
) {
  const updatedAt = new Date().toISOString();
  const existing = await getTeamAgent(db, projectId, agentId);
  if (!existing) return null;
  const skill = teamAgentSkill({
    name: input.name,
    responsibility: input.responsibility,
  });
  const skillRows = normalizedAgentSkillRows(
    agentId,
    input.skills,
    updatedAt,
  );
  await assertAgentSkillReplacementAllowed(db, agentId, skillRows);
  const supplementalStatements = replaceAgentSkillStatements(
    db,
    agentId,
    skillRows,
  );
  const results = await db.batch([
      db.prepare(
        `update briar_project_agents
         set name = ?,
             avatar = case when ? = 1 then ? else avatar end,
             avatar_pet_json = case when ? = 1 then ? else avatar_pet_json end,
             avatar_spritesheet_object_key =
               case when ? = 1 then ? else avatar_spritesheet_object_key end,
             provider = ?, model = ?, effort = ?,
             computer_use_policy = coalesce(?, computer_use_policy),
             designated_worker_id = ?, designated_worker_label = ?,
             description = ?, responsibility = ?,
             skill_markdown = ?, calendar_color = ?, updated_at = ?
         where id = ? and project_id = ?`,
      ).bind(
        input.name,
        input.avatar === undefined ? 0 : 1,
        input.avatar ?? null,
        input.codexPet === undefined ? 0 : 1,
        input.codexPet ? input.codexPet.json : null,
        input.codexPet === undefined ? 0 : 1,
        input.codexPet ? input.codexPet.objectKey : null,
        input.provider,
        input.model,
        input.effort,
        input.computerUsePolicy ?? null,
        input.designatedWorkerId ?? null,
        input.designatedWorkerLabel ?? null,
        input.description ?? existing.description,
        input.responsibility,
        skill,
        input.calendarColor,
        updatedAt,
        agentId,
        projectId,
      ),
      ...supplementalStatements,
    ]);
  if ((results[0]?.meta.changes ?? 0) === 0) return null;
  return getTeamAgent(db, projectId, agentId);
}
