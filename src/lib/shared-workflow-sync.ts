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

export type SharedWorkflowSyncResult =
  | { projectId: string; status: "synced" | "unchanged"; key: string }
  | { projectId: string; status: "missing" }
  | { projectId: string; status: "failed"; error: unknown };

/**
 * Refresh every locally connected project's cached workflow from project
 * settings. A failure for one project must not prevent the remaining local
 * projects from being refreshed when the desktop app starts.
 */
export async function syncSharedProjectWorkflows(input: {
  projectIds: string[];
  lastSyncedKeys: ReadonlyMap<string, string>;
  loadSharedWorkflow: (
    projectId: string,
  ) => Promise<AutoHuntWorkflow | null | undefined>;
  updateLocalWorkflow: (
    projectId: string,
    workflow: AutoHuntWorkflow,
  ) => Promise<unknown>;
}): Promise<SharedWorkflowSyncResult[]> {
  return Promise.all(
    [...new Set(input.projectIds)].map(async (projectId) => {
      try {
        const sharedWorkflow = await input.loadSharedWorkflow(projectId);
        const syncPlan = shouldSyncSharedWorkflow({
          connectedLocally: true,
          sharedWorkflow,
          lastSyncedKey: input.lastSyncedKeys.get(projectId) ?? null,
          projectId,
        });
        if (!sharedWorkflow || !syncPlan.key) {
          return { projectId, status: "missing" } as const;
        }
        if (!syncPlan.sync) {
          return { projectId, status: "unchanged", key: syncPlan.key } as const;
        }
        await input.updateLocalWorkflow(projectId, sharedWorkflow);
        return { projectId, status: "synced", key: syncPlan.key } as const;
      } catch (error) {
        return { projectId, status: "failed", error } as const;
      }
    }),
  );
}
