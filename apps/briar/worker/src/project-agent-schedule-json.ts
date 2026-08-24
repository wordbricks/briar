import { normalizeAutoHuntWorkflow } from "../../src/lib/auto-hunt-contract";
import { parseProjectAgentScheduleDays } from "../../src/lib/project-agent-schedule";
import { agentSkillJson } from "./agent-skills";
import { parseStructuredResult } from "./agent-result-json";
import type {
  ProjectAgentScheduleRow,
  ProjectAgentScheduleRunRow,
} from "./db";

export const projectAgentScheduleJson = (row: ProjectAgentScheduleRow) => ({
  id: row.id,
  projectId: row.project_id,
  agentId: row.agent_id,
  agentName: row.agent_name,
  agentProvider: row.agent_provider,
  name: row.name,
  recurrence: row.frequency ?? row.recurrence,
  timeOfDay: row.time_of_day,
  dayOfWeek: row.day_of_week,
  intervalValue: row.interval_value,
  intervalUnit: row.interval_unit,
  daysOfWeek: parseProjectAgentScheduleDays(row.days_of_week),
  notificationLevel: row.notification_level,
  timeZone: row.time_zone,
  enabled: row.enabled === 1,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const projectAgentScheduleRunJson = (
  row: ProjectAgentScheduleRunRow,
  claimToken?: string,
) => {
  const run = {
    id: row.id,
    projectId: row.project_id,
    scheduleId: row.schedule_id,
    scheduleName: row.schedule_name,
    agent: {
      id: row.agent_id,
      name: row.agent_name,
      provider: row.agent_provider,
      model: row.agent_model,
      effort: row.agent_effort,
      description: row.agent_description,
      responsibility: row.agent_responsibility,
      skill: row.agent_skill_markdown,
      skills: row.agent_skills.map(agentSkillJson),
    },
    workflow: normalizeAutoHuntWorkflow(JSON.parse(row.workflow_json)),
    status: row.status,
    scheduledFor: row.scheduled_for,
    leaseExpiresAt: row.lease_expires_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    resultSummary: row.result_summary,
    structuredResult: parseStructuredResult(row.structured_result_json),
    error: row.error,
  };
  return claimToken ? { ...run, claimToken } : run;
};
