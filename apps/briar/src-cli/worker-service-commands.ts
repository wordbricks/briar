import { existsSync } from "node:fs";
import {
  isLaunchdServiceNotFound,
  launchdServiceTarget,
  restartInstalledServices,
  removeServiceDefinition,
  serviceDefinition,
  writeServiceDefinition,
} from "./worker";
import {
  cliVersion,
  values,
  value,
  has,
  loadConfig,
  currentProject,
} from "./command-support";
import { createWorkerControlClient } from "./worker-control-client";

async function workerStatus() {
  const config = await loadConfig();
  const project = value("--project")
    ? config.projects.find((candidate) => candidate.id === value("--project"))
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 프로젝트를 찾지 못했습니다.");
  }
  const definition = serviceDefinition({
    projectId: project.id,
    briarBinary: process.execPath,
    workingDirectory: project.repositoryPath,
  });
  console.log(
    JSON.stringify(
      {
        projectId: project.id,
        service: definition.label,
        unitPath: definition.path,
        logPath: definition.logPath,
        registered: Boolean(project.executionWorker),
        workerId: project.executionWorker?.workerId ?? null,
        deviceId: project.executionWorker?.deviceId ?? null,
        label: project.executionWorker?.label ?? null,
        maxConcurrentSessions:
          project.executionWorker?.maxConcurrentSessions ?? null,
      },
      null,
      2,
    ),
  );
}

async function workerRestartServices() {
  const config = await loadConfig();
  const projects = config.projects.filter((project) => {
    if (!project.executionWorker) return false;
    const definition = serviceDefinition({
      projectId: project.id,
      briarBinary: process.execPath,
      workingDirectory: project.repositoryPath,
    });
    return existsSync(definition.path);
  });
  const handoffs = new Map<
    string,
    { workerId: string; token: string; requestId: string }
  >();
  for (const project of projects) {
    const registered = project.executionWorker;
    if (!registered || handoffs.has(registered.workerId)) continue;
    const token = process.env.BRIAR_WORKER_TOKEN ?? registered.token;
    if (!token) {
      throw new Error("Worker machine credential is unavailable");
    }
    const prepared = await createWorkerControlClient(
      config.apiUrl,
      token,
    ).prepareUpdateHandoff(
      registered.workerId,
      cliVersion,
    );
    handoffs.set(registered.workerId, {
      workerId: registered.workerId,
      token,
      requestId: prepared.update.id,
    });
  }

  const deadline = Date.now() + 30_000;
  while (true) {
    let ready = true;
    for (const handoff of handoffs.values()) {
      const status = await createWorkerControlClient(
        config.apiUrl,
        handoff.token,
      ).getUpdateHandoff(
        handoff.workerId,
        handoff.requestId,
      );
      if (status.update?.handoffState === "failed") {
        throw new Error(
          `Worker update handoff failed: ${status.update.handoffError ?? "unknown reason"}`,
        );
      }
      if (!status.ready || status.activeWorkCount > 0) ready = false;
    }
    if (ready) break;
    if (Date.now() >= deadline) {
      throw new Error(
        "Worker update handoff timed out after 30 seconds; services were not restarted so the old lease remains the safe fallback.",
      );
    }
    await Bun.sleep(500);
  }

  const definitions = config.projects
    .filter((project) => Boolean(project.executionWorker))
    .map((project) =>
      serviceDefinition({
        projectId: project.id,
        briarBinary: process.execPath,
        workingDirectory: project.repositoryPath,
      }),
    );
  const result = restartInstalledServices(definitions, {
    exists: existsSync,
    run: (command) => {
      const spawned = Bun.spawnSync({
        cmd: command,
        stdout: "pipe",
        stderr: "pipe",
      });
      return {
        success: spawned.success,
        error: new TextDecoder().decode(spawned.stderr).trim(),
      };
    },
  });
  console.log(JSON.stringify(result));
}

async function workerService(action: "install" | "uninstall") {
  const config = await loadConfig();
  const project = value("--project")
    ? config.projects.find((candidate) => candidate.id === value("--project"))
    : await currentProject(config);
  if (!project) {
    throw new Error("이 컴퓨터에 연결된 프로젝트를 찾지 못했습니다.");
  }
  if (action === "install" && !project.executionWorker) {
    throw new Error(
      "서비스를 설치하기 전에 `briar worker register`를 실행하세요.",
    );
  }
  const briarBinary = value("--briar-binary") ?? process.execPath;
  const runtimeBinary = value("--runtime-binary");
  const cliScript = value("--cli-script");
  const definition = serviceDefinition({
    projectId: project.id,
    briarBinary,
    runtimeBinary,
    cliScript,
    workingDirectory: project.repositoryPath,
  });
  const command =
    action === "install" ? definition.enableCommand : definition.disableCommand;
  if (action === "install") {
    await writeServiceDefinition(definition);
  }
  const launchdTarget = action === "uninstall"
    ? launchdServiceTarget(definition)
    : null;
  const launchdServiceAlreadyGone = launchdTarget !== null && (() => {
    const probe = Bun.spawnSync({
      cmd: ["launchctl", "print", launchdTarget],
      stdout: "pipe",
      stderr: "pipe",
    });
    if (probe.success) return false;
    const output = [
      new TextDecoder().decode(probe.stdout),
      new TextDecoder().decode(probe.stderr),
    ].join("\n");
    return isLaunchdServiceNotFound(output);
  })();
  if (!launchdServiceAlreadyGone) {
    const argv =
      command[0] === "launchctl"
        ? [...command, definition.path]
        : command;
    const spawned = Bun.spawnSync({ cmd: argv, stdout: "pipe", stderr: "pipe" });
    if (!spawned.success) {
      throw new Error(
        `서비스 ${action === "install" ? "설치" : "제거"}에 실패했습니다: ${new TextDecoder().decode(spawned.stderr).trim()}`,
      );
    }
  }
  if (action === "uninstall") {
    await removeServiceDefinition(definition);
  }
  console.log(
    JSON.stringify({
      action,
      service: definition.label,
      unitPath: definition.path,
      logPath: definition.logPath,
    }),
  );
}

export {
  workerStatus,
  workerRestartServices,
  workerService,
};
