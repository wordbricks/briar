import { spawn, type ChildProcess } from "node:child_process";
import { isAbsolute } from "node:path";
import type { Config } from "./config-contract";
import { loadConfig } from "./command-support";
import { interruptibleSleep } from "./worker";

type ManagedWorkerChild = {
  child: ChildProcess;
  startedAt: number;
};

export function managedWorkerProjectIds(config: Config) {
  const managed = config.managedComputer;
  if (!managed) return [];
  return config.teams
    .filter((project) =>
      project.executionWorker?.deviceId === managed.deviceId &&
      project.executionWorker.organizationId === managed.organizationId
    )
    .map((project) => project.id)
    .sort();
}

export function managedWorkerProcessCommand(
  projectId: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configured = environment.BRIAR_CLI?.trim();
  if (configured) {
    if (!isAbsolute(configured)) throw new Error("BRIAR_CLI must be absolute");
    return [configured, "worker", "--team", projectId];
  }
  const entry = process.argv[1];
  if (!entry || !isAbsolute(entry)) {
    throw new Error("Unable to resolve the Briar CLI entry point");
  }
  return [process.execPath, entry, "worker", "--team", projectId];
}

const pollInterval = () => {
  const configured = Number.parseInt(
    process.env.BRIAR_MANAGED_WORKER_POLL_MS ?? "",
    10,
  );
  return Number.isInteger(configured) && configured >= 1_000 && configured <= 60_000
    ? configured
    : 5_000;
};

export type WorkerSupervisorOptions = {
  /** Project IDs whose workers this supervisor keeps alive. */
  desiredProjectIds: (config: Config) => string[] | Promise<string[]>;
  /** Extra environment for each worker child. */
  childEnvironment: (config: Config, projectId: string) => NodeJS.ProcessEnv;
  /** Event name prefix so logs distinguish managed and sandbox supervisors. */
  eventPrefix: string;
};

const managedSupervisorOptions: WorkerSupervisorOptions = {
  desiredProjectIds: managedWorkerProjectIds,
  childEnvironment: (config) => ({
    BRIAR_MANAGED_CREDENTIAL_FILE: config.managedComputer!.credentialFile,
  }),
  eventPrefix: "managed_worker",
};

export function managedComputerWorkerSupervisor() {
  return runWorkerSupervisor(managedSupervisorOptions);
}

export async function runWorkerSupervisor(options: WorkerSupervisorOptions) {
  const prefix = options.eventPrefix;
  const nodeProcess = process as NodeJS.Process;
  const children = new Map<string, ManagedWorkerChild>();
  const restartAttempts = new Map<string, number>();
  const restartAfter = new Map<string, number>();
  const stop = new AbortController();
  const requestStop = () => stop.abort();
  nodeProcess.once("SIGINT", requestStop);
  nodeProcess.once("SIGTERM", requestStop);
  let previousDesired = "";

  try {
    while (!stop.signal.aborted) {
      try {
        const config = await loadConfig();
        const desired = await options.desiredProjectIds(config);
        const desiredSet = new Set(desired);
        const desiredKey = desired.join(",");
        if (desiredKey !== previousDesired) {
          console.log(JSON.stringify({
            event: `${prefix}_projects`,
            projectCount: desired.length,
            projectIds: desired,
          }));
          previousDesired = desiredKey;
        }

        for (const [projectId, running] of children) {
          if (!desiredSet.has(projectId)) {
            running.child.kill("SIGTERM");
          }
        }

        for (const projectId of desired) {
          if (children.has(projectId)) continue;
          if ((restartAfter.get(projectId) ?? 0) > Date.now()) continue;
          const command = managedWorkerProcessCommand(projectId);
          const child = spawn(command[0]!, command.slice(1), {
            stdio: "inherit",
            env: {
              ...process.env,
              BRIAR_API_URL: config.apiUrl,
              BRIAR_TEAM_ID: projectId,
              ...options.childEnvironment(config, projectId),
            },
          });
          const running = { child, startedAt: Date.now() };
          children.set(projectId, running);
          console.log(JSON.stringify({
            event: `${prefix}_started`,
            projectId,
            pid: child.pid ?? null,
          }));
          child.once("exit", (code, signal) => {
            if (children.get(projectId) !== running) return;
            children.delete(projectId);
            const stable = Date.now() - running.startedAt >= 60_000;
            const attempt = stable
              ? 1
              : Math.min(6, (restartAttempts.get(projectId) ?? 0) + 1);
            restartAttempts.set(projectId, attempt);
            restartAfter.set(
              projectId,
              Date.now() + Math.min(60_000, 1_000 * 2 ** (attempt - 1)),
            );
            console.error(JSON.stringify({
              event: `${prefix}_exited`,
              projectId,
              code,
              signal,
              restartAttempt: attempt,
            }));
          });
        }
      } catch (error) {
        console.error(JSON.stringify({
          event: `${prefix}_reconcile_failed`,
          message: error instanceof Error ? error.message : String(error),
        }));
      }
      await interruptibleSleep(pollInterval(), stop.signal);
    }
  } finally {
    const exits = [...children.values()].map(({ child }) => {
      child.kill("SIGTERM");
      return new Promise<void>((resolve) => child.once("exit", () => resolve()));
    });
    await Promise.race([
      Promise.all(exits),
      interruptibleSleep(10_000),
    ]);
    for (const { child } of children.values()) {
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }
}
