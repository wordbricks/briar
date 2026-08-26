import { useMemo } from "react";
import { IssueActivityRealtimeTransport } from "../lib/issue-activity-realtime";
import { useAgentActivity } from "./use-agent-activity";

export function useIssueAgentActivity(
  token: string | null,
  projectId: string,
  runId: string,
) {
  const transport = useMemo(() => {
    if (!token) return null;
    return new IssueActivityRealtimeTransport({
      token,
      projectId,
      runId,
    });
  }, [projectId, runId, token]);
  return useAgentActivity(transport);
}
