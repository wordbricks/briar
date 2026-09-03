import * as Atom from "effect/unstable/reactivity/Atom";

import type { ExecutionWorker } from "../../types";
import { shallowArrayEqual } from "./upsert";

/*
  Execution workers normalized by id, with one id index per team.

  `DashboardPayload.workers` is optional, so the index distinguishes "the server
  never sent workers for this team" (`null`) from "it sent an empty list"
  (`[]`). The reassembled payload has to keep that difference: the merge rules
  treat an absent projection as untouched.
*/

/** Every known execution worker, keyed by worker id. */
export const workersByIdAtom = Atom.make<ReadonlyMap<string, ExecutionWorker>>(
  new Map(),
).pipe(Atom.keepAlive, Atom.withLabel("entities/workers"));

/** One worker, or `null` when it is not in the store. */
export const workerAtom = Atom.family((workerId: string) =>
  Atom.map(workersByIdAtom, (workers) => workers.get(workerId) ?? null).pipe(
    Atom.withLabel(`entities/workers/${workerId}`),
  ),
);

/** A team's worker ids, or `null` when the payload carried no worker list. */
export const teamWorkerIdsAtom = Atom.family((teamId: string) =>
  Atom.make<string[] | null>(null).pipe(
    Atom.keepAlive,
    Atom.withEquality<string[] | null>(shallowArrayEqual),
    Atom.withLabel(`entities/workers/team/${teamId}/ids`),
  ),
);

/** A team's workers resolved against the store, or `null` when absent. */
export const teamWorkersAtom = Atom.family((teamId: string) =>
  Atom.make((get): ExecutionWorker[] | null => {
    const ids = get(teamWorkerIdsAtom(teamId));
    if (!ids) return null;
    const workers = get(workersByIdAtom);
    const resolved: ExecutionWorker[] = [];
    for (const id of ids) {
      const worker = workers.get(id);
      if (worker) resolved.push(worker);
    }
    return resolved;
  }).pipe(
    Atom.withEquality<ExecutionWorker[] | null>(shallowArrayEqual),
    Atom.withLabel(`entities/workers/team/${teamId}`),
  ),
);
