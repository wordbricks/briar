export const managedComputerRemoteSessionStates = [
  "created",
  "connecting",
  "connected",
  "disconnected",
  "ended",
  "expired",
  "rejected",
] as const;

export type ManagedComputerRemoteSessionState =
  (typeof managedComputerRemoteSessionStates)[number];

export type ManagedComputerRemoteSessionRow = {
  id: string;
  organization_id: string;
  managed_computer_id: string;
  agent_id: string | null;
  controller_user_id: string;
  request_id: string;
  state: ManagedComputerRemoteSessionState;
  client_token_hash: string;
  token_expires_at: string;
  token_consumed_at: string | null;
  connection_generation: number;
  max_expires_at: string;
  connected_at: string | null;
  disconnected_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  controller_bytes: number;
  screen_bytes: number;
  created_at: string;
  updated_at: string;
};

export function managedComputerRemoteSessionJson(
  row: ManagedComputerRemoteSessionRow,
) {
  return {
    id: row.id,
    managedComputerId: row.managed_computer_id,
    agentId: row.agent_id,
    state: row.state,
    connectionGeneration: row.connection_generation,
    tokenExpiresAt: row.token_expires_at,
    maxExpiresAt: row.max_expires_at,
    connectedAt: row.connected_at,
    disconnectedAt: row.disconnected_at,
    endedAt: row.ended_at,
  };
}
