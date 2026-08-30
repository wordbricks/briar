export const projectAgentSessionJson = (row: {
  project_id: string;
  id: string;
  requested_by_user_id: string | null;
  payload_json: string;
}) => ({
  id: row.id,
  projectId: row.project_id,
  ...(JSON.parse(row.payload_json) as Record<string, unknown>),
  requestedByUserId: row.requested_by_user_id,
  workspaceRoot: null,
  dispatchEvents: [],
  workers: [],
  detailLoaded: true,
});
