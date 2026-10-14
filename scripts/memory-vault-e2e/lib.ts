/**
 * Shared helpers for the memory vault end-to-end check (see run.ts).
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AgentService } from "../../packages/contracts/src/gen/briar/app/v1/agent_pb";
import { ChannelService } from "../../packages/contracts/src/gen/briar/app/v1/channel_pb";
import { DmMemoryService } from "../../packages/contracts/src/gen/briar/app/v1/dm_memory_pb";
import { createAuthenticatedConnectClient } from "../../apps/briar/src-cli/connect-client";
import {
  createWorkerQueueClient,
  createWorkerQueueOperations,
} from "../../apps/briar/src-cli/worker-queue-client";

export const repoRoot = resolve(import.meta.dir, "../..");
export const workDirectory = join(import.meta.dir, ".work");
export const statePath = join(workDirectory, "state.json");
export const apiPort = 8799;
export const adminPort = 8795;
export const apiUrl = `http://127.0.0.1:${apiPort}`;
export const adminUrl = `http://127.0.0.1:${adminPort}`;
/** `database_id` of `briar-db` in wrangler.jsonc; only ever used locally here. */
export const localDatabaseId = "b83c9a2a-2a41-48ec-8bc4-ef038f5c9685";
export const readmeSha256 = "d907567be6ee97bae6df48a58ce4018a1a4e98d5dc628031ef208956a74ba583";

/** Everything the seed created; read by the per-session Worker processes. */
export type E2eState = {
  workspaceId: string;
  projectId: string;
  userA: { id: string; token: string };
  userB: { id: string; token: string };
  agentId: string;
  agentName: string;
  workerId: string;
  deviceId: string;
  workerToken: string;
  dmA: string;
  dmB: string;
  group: string;
  adminToken: string;
};

export const saveState = async (state: E2eState) => {
  await mkdir(workDirectory, { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2), { mode: 0o600 });
};
export const loadState = async (): Promise<E2eState> => JSON.parse(await readFile(statePath, "utf8"));

export const sha256Hex = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");

type SqlValue = string | number | null;

/**
 * Runs SQL against the dev server's local D1 through Miniflare's local
 * explorer API (the running process owns the SQLite file). Local only.
 */
export async function d1<T extends Record<string, unknown>>(sql: string, params: SqlValue[] = []): Promise<T[]> {
  const response = await fetch(`${apiUrl}/cdn-cgi/local/explorer/api/d1/database/${localDatabaseId}/raw`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // The explorer API takes string parameters; SQLite's affinity converts them.
    body: JSON.stringify({ sql, params: params.map((value) => value === null ? null : String(value)) }),
  });
  const json = await response.json() as {
    success: boolean;
    errors: Array<{ message: string }>;
    result: Array<{ results: { columns: string[]; rows: unknown[][] } }> | null;
  };
  if (!json.success || !json.result) throw new Error(`local D1 query failed: ${JSON.stringify(json.errors)} for ${sql.slice(0, 120)}`);
  const last = json.result.at(-1)!.results;
  return (last.rows ?? []).map((row) => Object.fromEntries(last.columns.map((column, index) => [column, row[index]])) as T);
}

export const appClients = (sessionToken: string) => ({
  agents: createAuthenticatedConnectClient(AgentService, apiUrl, sessionToken, { binary: true }),
  channels: createAuthenticatedConnectClient(ChannelService, apiUrl, sessionToken, { binary: true }),
  dmMemory: createAuthenticatedConnectClient(DmMemoryService, apiUrl, sessionToken, { binary: true }),
});

export const workerClients = (workerToken: string) => {
  const queue = createWorkerQueueClient(apiUrl, workerToken);
  return { queue, operations: createWorkerQueueOperations(queue) };
};

/** One assertion of the evidence: name, PASS/FAIL, and a short detail. */
export type Check = { goal: string; name: string; ok: boolean; detail?: unknown };

export const timed = async <T>(fn: () => Promise<T>) => {
  const started = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - started) };
};

/** Strips anything token-shaped before it reaches stdout or the evidence. */
export const redact = (text: string) => text
  .replace(/briar_worker_[0-9a-f]{16,}/gu, "briar_worker_<redacted>")
  .replace(/briar_claim_[0-9a-f]{16,}/gu, "briar_claim_<redacted>")
  .replace(/art_v2_[A-Za-z0-9_.?=-]+/gu, "art_v2_<redacted>")
  .replace(/e2e-session-[0-9a-f]{16,}/gu, "e2e-session-<redacted>");
