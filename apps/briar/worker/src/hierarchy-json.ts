import {
  cloneAutoHuntWorkflow,
  normalizeAutoHuntWorkflow,
} from "../../src/lib/auto-hunt-contract";
import type {
  PlanningProjectRow,
  ProjectIssueRow,
  TeamHierarchyRow,
} from "./hierarchy-repository";

const workflowJson = (raw: string | null) => {
  if (!raw) return cloneAutoHuntWorkflow();
  try {
    return normalizeAutoHuntWorkflow(JSON.parse(raw));
  } catch {
    return cloneAutoHuntWorkflow();
  }
};

export const teamHierarchyJson = (
  row: TeamHierarchyRow,
  runtime?: Awaited<
    ReturnType<
      typeof import("./hierarchy-repository").listTeamAgentsAndSchedules
    >
  >,
) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  workspaceName: row.workspace_name,
  name: row.name,
  issueKeyPrefix: row.issue_key_prefix,
  icon: row.icon,
  role: row.role,
  repository: row.github_repository
    ? {
      id: row.github_repository_id,
      name: row.github_repository,
    }
    : null,
  agents: (runtime?.agents ?? []).map((agent) => ({
    id: agent.id,
    name: agent.name,
    provider: agent.provider,
    designatedWorkerId: agent.designated_worker_id,
    createdAt: agent.created_at,
    updatedAt: agent.updated_at,
  })),
  schedule: {
    enabled: row.schedule_tab_enabled !== 0,
    entries: (runtime?.schedules ?? []).map((schedule) => ({
      id: schedule.id,
      agentId: schedule.agent_id,
      name: schedule.name,
      enabled: schedule.enabled !== 0,
      recurrence: schedule.recurrence,
      timeOfDay: schedule.time_of_day,
      timeZone: schedule.time_zone,
      createdAt: schedule.created_at,
      updatedAt: schedule.updated_at,
    })),
  },
  workflow: workflowJson(row.workflow_json),
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const planningProjectJson = (row: PlanningProjectRow) => ({
  id: row.id,
  workspaceId: row.workspace_id,
  workspaceName: row.workspace_name,
  teamId: row.team_id,
  teamName: row.team_name,
  name: row.name,
  description: row.description,
  status: row.status,
  leadUserId: row.lead_user_id,
  leadName: row.lead_name,
  startDate: row.start_date,
  targetDate: row.target_date,
  icon: row.icon,
  color: row.color,
  sortOrder: row.sort_order,
  isDefault: row.is_default !== 0,
  role: row.role,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const projectIssueJson = (row: ProjectIssueRow) => ({
  id: row.id,
  runNumber: row.run_number,
  workspaceId: row.workspace_id,
  teamId: row.team_id,
  teamName: row.team_name,
  projectId: row.project_id,
  projectName: row.project_name,
  issueKey: `${row.issue_key_prefix}-${row.run_number}`,
  source: row.source,
  sourceKey: row.source_key,
  title: row.title,
  status: row.status,
  workflowStage: row.workflow_stage,
  priority: row.priority,
  assigneeUserId: row.assignee_user_id,
  repository: row.repository,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});
