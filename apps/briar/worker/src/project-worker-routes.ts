import { json } from "./http-response";
import { workerJson } from "./worker-json";
import {
  countLeasedRuns,
  getProjectExecutionWorkerPolicy,
  listExecutionWorkers,
  projectExecutionWorkerCapabilityCatalog,
  reapStalledHuntRuns,
} from "./workers";

export type ProjectWorkerRouteInput = {
  request: Request;
  url: URL;
  db: D1Database;
  requireProjectAccess: (projectId: string) => Promise<void>;
};

export async function handleProjectWorkerRoute(
  routeInput: ProjectWorkerRouteInput,
): Promise<Response | undefined> {
  const { request, url, db } = routeInput;
  const { pathname } = url;
  const auth: unknown = undefined;
  const requireProjectAccess = (
    _auth: unknown,
    _db: D1Database,
    _request: Request,
    projectId: string,
  ) => routeInput.requireProjectAccess(projectId);

  const projectWorkersMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/workers$/u,
  );
  const projectAgentCapabilitiesMatch = pathname.match(
    /^\/projects\/([0-9a-f-]+)\/agent-capabilities$/u,
  );
  if (projectAgentCapabilitiesMatch && request.method === "GET") {
    const projectId = projectAgentCapabilitiesMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const observedAt = new Date().toISOString();
    const [workers, policy] = await Promise.all([
      listExecutionWorkers(db, projectId, observedAt),
      getProjectExecutionWorkerPolicy(db, projectId),
    ]);
    return json({
      ...projectExecutionWorkerCapabilityCatalog(workers, policy),
      observedAt,
    });
  }
  if (projectWorkersMatch && request.method === "GET") {
    const projectId = projectWorkersMatch[1];
    await requireProjectAccess(auth, db, request, projectId);
    const observedAt = new Date().toISOString();
    // Reading the dashboard is the other regular touchpoint, so recover
    // abandoned runs here too rather than waiting for the next claim.
    const reaped = await reapStalledHuntRuns(db, projectId, observedAt);
    const workers = await listExecutionWorkers(db, projectId, observedAt);
    return json({
      workers: workers.map((worker) => workerJson(worker, observedAt)),
      leasedRuns: await countLeasedRuns(db, projectId, observedAt),
      reaped,
    });
  }

  return undefined;
}
