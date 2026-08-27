import { platform } from "node:os";
import { isAbsolute } from "node:path";

const updateRequestIdPattern = /^[0-9a-f-]{36}$/iu;
const versionPattern = /^\d+\.\d+\.\d+$/u;
const workerIdPattern = /^[0-9a-zA-Z-]{1,128}$/u;

export type WorkerUpdateDirective = {
  id: string;
  targetVersion: string;
  status: "requested";
  requestedAt: string;
  handoffState?: "idle" | "draining" | "ready" | "failed";
};

export type WorkerUpdateLaunch = {
  command: string;
  args: string[];
};

export function supportsRemoteWorkerUpdates(
  operatingSystem: ReturnType<typeof platform>,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  if (operatingSystem === "darwin") return true;
  const updater = environment.BRIAR_MANAGED_RUNTIME_UPDATER?.trim() ?? "";
  return operatingSystem === "linux" && isAbsolute(updater);
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

export function workerUpdateLaunch(
  directive: Pick<WorkerUpdateDirective, "id" | "targetVersion">,
  workerId: string,
  operatingSystem: ReturnType<typeof platform> = platform(),
  environment: NodeJS.ProcessEnv = process.env,
): WorkerUpdateLaunch {
  if (!workerIdPattern.test(workerId)) {
    throw new Error("Invalid worker update target");
  }
  if (operatingSystem === "darwin") {
    return {
      command: "/usr/bin/open",
      args: [workerUpdateDeepLink(directive)],
    };
  }
  const updater = environment.BRIAR_MANAGED_RUNTIME_UPDATER?.trim() ?? "";
  if (
    operatingSystem !== "linux" ||
    !isAbsolute(updater) ||
    !updateRequestIdPattern.test(directive.id) ||
    !versionPattern.test(directive.targetVersion)
  ) {
    throw new Error("Remote worker updates are not supported");
  }
  return {
    command: updater,
    args: [directive.id, directive.targetVersion, workerId],
  };
}
