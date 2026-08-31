import type { ProjectRow } from "./project-repository";

export function projectJson(row: ProjectRow) {
  return {
    id: row.id,
    workspaceId: row.organization_id,
    teamId: row.id,
    name: row.name,
    issueKeyPrefix: row.issue_key_prefix,
    scheduleTabEnabled: row.schedule_tab_enabled !== 0,
    icon: row.icon,
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    role: row.member_role,
    createdAt: row.created_at,
  };
}
