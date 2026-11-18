import type { TeamRow } from "./team-repository";

export function teamJson(row: TeamRow) {
  return {
    id: row.id,
    workspaceId: row.organization_id,
    teamId: row.id,
    name: row.name,
    issueKeyPrefix: row.issue_key_prefix,
    scheduleTabEnabled: row.schedule_tab_enabled !== 0,
    icon: row.icon,
    iconName: row.icon_name,
    iconColor: row.icon_color,
    // Legacy shell (1.2.174) reads these two keys; the payload already carries
    // workspaceId above, so this pair stays as the old contract spelled it.
    organizationId: row.organization_id,
    organizationName: row.organization_name,
    role: row.member_role,
    createdAt: row.created_at,
  };
}
