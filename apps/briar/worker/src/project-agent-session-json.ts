import { corsHeaders } from "./http-response";

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

export const projectAgentSessionSummaryJson = (row: {
  project_id: string;
  session_id: string;
  summary_json: string;
  archived: number;
}) => {
  const summary = JSON.parse(row.summary_json) as Record<string, unknown>;
  // `inboxVersion` is an internal projection used by the organization feed;
  // keep the existing public Agent-session contract unchanged.
  delete summary.inboxVersion;
  return {
    id: row.session_id,
    projectId: row.project_id,
    ...summary,
    followUps: [],
    conversationId: null,
    workspaceRoot: null,
    summary: null,
    error: null,
    events: [],
    dispatchEvents: [],
    workers: [],
    archived: row.archived === 1,
    detailLoaded: false,
  };
};

export const projectAgentSessionSyncEtag = (
  projectId: string,
  cursor: number,
) => `"project-agent-sessions:${projectId}:${cursor}"`;

export const projectAgentSessionSyncJson = (
  body: unknown,
  etag: string,
  status = 200,
) =>
  Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-cache",
      ETag: etag,
    },
  });
