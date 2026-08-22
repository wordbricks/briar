import * as Schema from "effect/Schema";

export const WorkerUpdateHandoffWorkType = Schema.Literals([
  "issue",
  "projectAgentTask",
  "issueReply",
  "channelReply",
]);
export type WorkerUpdateHandoffWorkType =
  typeof WorkerUpdateHandoffWorkType.Type;

export type WorkerUpdateRequest = {
  id: string;
  targetVersion: string;
  status: "requested" | "completed" | "cancelled";
  requestedAt: string;
  handoffState: "idle" | "draining" | "ready" | "failed";
  handoffStartedAt: string | null;
  handoffCompletedAt: string | null;
  handoffError: string | null;
};

export type WorkerUpdateHandoffContext = {
  requestId: string;
  workType: WorkerUpdateHandoffWorkType;
  workId: string;
  runId: string | null;
  conversationId: string | null;
  workspacePath: string | null;
  createdAt: string;
};
