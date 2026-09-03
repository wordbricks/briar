import { decodeStoredTeamAgentSessionPayload } from "./team-request-contract";

export const teamAgentSessionJson = (row: {
  project_id: string;
  id: string;
  requested_by_user_id: string | null;
  payload_json: string;
}) => {
  const payload = decodeStoredTeamAgentSessionPayload(row.payload_json);
  return {
    id: row.id,
    projectId: row.project_id,
    ...payload,
    requestedByUserId: row.requested_by_user_id,
    workspaceRoot: null,
    dispatchEvents: [],
    workers: [],
    detailLoaded: true,
  };
};
