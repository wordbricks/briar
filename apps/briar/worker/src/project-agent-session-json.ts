import { decodeStoredProjectAgentSessionPayload } from "./project-request-contract";

export const projectAgentSessionJson = (row: {
  project_id: string;
  id: string;
  requested_by_user_id: string | null;
  payload_json: string;
}) => {
  const payload = decodeStoredProjectAgentSessionPayload(row.payload_json);
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
