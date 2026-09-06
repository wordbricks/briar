import { hydrateAgentSkills } from "./agent-skills";
import type { OrganizationAgentRow } from "./organization-agents";

/*
  Plan §3.5: an Agent may write to every Organization Agent, plus the Agents of
  the projects the person who started the round trip can reach. Membership of
  the conversation's roster is deliberately not a condition — the answer comes
  back through the sender rather than being posted where the target lives.

  Organization owners and co-owners reach every project; everybody else needs a
  `briar_project_members` row. The same query runs at claim time and again when
  the send is applied, so a project a member lost in between drops its Agents
  from both the offered list and the accepted one.
*/
const agentMessageTargetSelect = `
  select agent.id, agent.organization_id, agent.project_id,
         project.name as project_name, agent.name, agent.avatar,
         agent.provider, agent.model, agent.description, agent.responsibility,
         agent.effort, agent.computer_use_policy, agent.designated_worker_id,
         agent.designated_worker_label, agent.created_at, agent.updated_at
  from briar_project_agents agent
  left join briar_teams project on project.id = agent.project_id
  where agent.organization_id = ? and agent.id <> ?
    and (
      agent.project_id is null
      or exists (
        select 1 from briar_organization_members membership
        where membership.organization_id = agent.organization_id
          and membership.user_id = ?
          and membership.role in ('owner', 'co-owner')
      )
      or exists (
        select 1 from briar_project_members project_membership
        where project_membership.project_id = agent.project_id
          and project_membership.organization_id = agent.organization_id
          and project_membership.user_id = ?
      )
    )
  order by agent.project_id is not null, agent.name, agent.id`;

export type AgentMessageTargetAgent = OrganizationAgentRow & {
  skills: NonNullable<OrganizationAgentRow["skills"]>;
};

export type AgentMessageTarget = {
  agentId: string;
  agentName: string;
  projectId: string | null;
  projectName: string | null;
  responsibility: string;
  skills: Array<{ id: string; name: string }>;
};

/**
 * The Agents one Agent may write to, with their live runtime configuration.
 * `viewerUserId` is the author of the message that started the round trip; a
 * conversation with no human author (a webhook, say) reaches nobody.
 */
export async function listAgentMessageTargetAgents(
  db: D1Database,
  input: {
    organizationId: string;
    viewerUserId: string | null;
    excludeAgentId: string;
  },
): Promise<AgentMessageTargetAgent[]> {
  if (!input.viewerUserId) return [];
  const rows = await db
    .prepare(agentMessageTargetSelect)
    .bind(
      input.organizationId,
      input.excludeAgentId,
      input.viewerUserId,
      input.viewerUserId,
    )
    .all<OrganizationAgentRow>();
  return hydrateAgentSkills(db, rows.results);
}

/** Claim-snapshot shape: enough for the runner to choose a recipient. */
export const agentMessageTargetJson = (
  agent: AgentMessageTargetAgent,
): AgentMessageTarget => ({
  agentId: agent.id,
  agentName: agent.name,
  projectId: agent.project_id,
  projectName: agent.project_id ? agent.project_name ?? "Project" : null,
  responsibility: agent.responsibility,
  skills: agent.skills.map((skill) => ({ id: skill.id, name: skill.name })),
});
