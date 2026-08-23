import { platform } from "node:os";

const updateRequestIdPattern = /^[0-9a-f-]{36}$/iu;
const versionPattern = /^\d+\.\d+\.\d+$/u;

export type WorkerUpdateDirective = {
  id: string;
  targetVersion: string;
  status: "requested";
  requestedAt: string;
  handoffState?: "idle" | "draining" | "ready" | "failed";
};

export function supportsRemoteWorkerUpdates(
  operatingSystem: ReturnType<typeof platform>,
): boolean {
  return operatingSystem === "darwin";
}

export function workerUpdateDeepLink(
  directive: Pick<WorkerUpdateDirective, "id" | "targetVersion">,
): string {
  if (
    !updateRequestIdPattern.test(directive.id) ||
    !versionPattern.test(directive.targetVersion)
  ) {
    throw new Error("Invalid worker update directive");
  }
  return `briar-companion://worker-update/${directive.id}?target=${encodeURIComponent(directive.targetVersion)}`;
}
