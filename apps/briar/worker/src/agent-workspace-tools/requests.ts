import { sha256 } from "../crypto-digest";
import { toolError } from "./errors";
import type { AgentWorkspaceScope } from "./claim";

/**
 * Idempotency for workspace tool writes. A request key is scoped to the
 * claim's organization and work, so a retry after a timeout (by the CLI's own
 * transport retry, or by the agent re-running the command with the same
 * `--request-key`) returns the first result instead of writing twice.
 */
export type ToolOperation =
  | "issue.create"
  | "issue.note"
  | "issue.status"
  | "issue.update"
  | "channel.post";

export type ToolRequest = {
  readonly scope: AgentWorkspaceScope;
  readonly operation: ToolOperation;
  readonly requestKey: string;
  readonly payloadHash: string;
};

export async function toolRequest(
  scope: AgentWorkspaceScope,
  operation: ToolOperation,
  requestKey: string,
  payload: unknown,
): Promise<ToolRequest> {
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(requestKey)) {
    throw toolError("invalid_request", "The request key must be 1-128 letters, digits or . _ : -");
  }
  return {
    scope,
    operation,
    requestKey,
    payloadHash: await sha256(JSON.stringify({ operation, payload })),
  };
}

/** The stored result of an earlier identical request, or null when the key is new. */
export async function replayedResult<T>(db: D1Database, request: ToolRequest): Promise<T | null> {
  const row = await db.prepare(`select payload_hash, result_json from briar_agent_workspace_tool_requests
    where organization_id = ? and work_id = ? and request_key = ?`)
    .bind(request.scope.organizationId, request.scope.workId, request.requestKey)
    .first<{ payload_hash: string; result_json: string }>();
  if (!row) return null;
  if (row.payload_hash !== request.payloadHash) {
    throw toolError("idempotency_conflict", "This request key was already used for a different request");
  }
  return JSON.parse(row.result_json) as T;
}

/** The statement recording a request's result; batch it with the write it describes. */
export function recordRequestStatement(
  db: D1Database,
  request: ToolRequest,
  result: unknown,
  createdAt: string,
) {
  return db.prepare(`insert into briar_agent_workspace_tool_requests (
      organization_id, work_id, request_key, operation, payload_hash, agent_id, result_json, created_at)
    values (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(
      request.scope.organizationId,
      request.scope.workId,
      request.requestKey,
      request.operation,
      request.payloadHash,
      request.scope.agent?.id ?? null,
      JSON.stringify(result),
      createdAt,
    );
}

/**
 * Runs a write once per request key. A concurrent duplicate loses the primary
 * key race inside its batch; it then reads the winner's stored result.
 */
export async function onceForRequest<T>(
  db: D1Database,
  request: ToolRequest,
  write: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const earlier = await replayedResult<T>(db, request);
  if (earlier !== null) return { result: earlier, replayed: true };
  try {
    return { result: await write(), replayed: false };
  } catch (error) {
    const winner = await replayedResult<T>(db, request);
    if (winner !== null) return { result: winner, replayed: true };
    throw error;
  }
}
