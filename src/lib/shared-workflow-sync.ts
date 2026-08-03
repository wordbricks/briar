import type { AutoHuntWorkflow } from "./auto-hunt-contract";

/**
 * Shared project workflows (including required tools) live in project settings.
 * Each connected worker machine keeps a local copy so health probes and the
 * worker process can check those tools without another round trip.
 */
export function shouldSyncSharedWorkflow(input: {
  connectedLocally: boolean;
  sharedWorkflow: AutoHuntWorkflow | null | undefined;
  lastSyncedKey: string | null;
  projectId: string;
}): { sync: boolean; key: string | null } {
  if (!input.connectedLocally || !input.sharedWorkflow) {
    return { sync: false, key: null };
  }
  const key = `${input.projectId}:${JSON.stringify(input.sharedWorkflow)}`;
  if (input.lastSyncedKey === key) {
    return { sync: false, key };
  }
  return { sync: true, key };
}
