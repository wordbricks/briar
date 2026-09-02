import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  ComputerUseDesktopAssignment,
  ComputerUseWindowSupervisor,
} from "./computer-use-desktop-manager";

export const computerUseWindowUnit = (displayIndex: number): string => {
  if (!Number.isInteger(displayIndex) || displayIndex < 2 || displayIndex > 100) {
    throw new Error("Computer Use display index must be between 2 and 100");
  }
  return `briar-computer-use-window@${displayIndex}.service`;
};

export const computerUseRfbPort = (displayIndex: number): number => {
  computerUseWindowUnit(displayIndex);
  return 5_900 + displayIndex;
};

export const defaultComputerUseBrowserProfilesDirectory =
  "/var/lib/briar-computer-use/profiles";

export const computerUseBrowserProfileDirectory = (
  displayIndex: number,
  profilesDirectory = defaultComputerUseBrowserProfilesDirectory,
): string => {
  computerUseWindowUnit(displayIndex);
  return join(profilesDirectory, `display-${displayIndex}`);
};

export interface ComputerUseSystemCommandRunner {
  run(binary: string, args: readonly string[]): Promise<void>;
}

export interface ComputerUsePortProbe {
  isListening(host: string, port: number): Promise<boolean>;
}

export interface ComputerUseBrowserProfileCleaner {
  remove(displayIndex: number): Promise<void>;
}

const defaultCommandRunner: ComputerUseSystemCommandRunner = {
  run: (binary, args) => new Promise((resolve, reject) => {
    const child = spawn(binary, [...args], {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 16_384) stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(
        `Computer Use system command exited ${code ?? signal ?? "unknown"}${
          stderr.trim() === "" ? "" : `: ${stderr.trim()}`
        }`,
      ));
    });
  }),
};

const defaultPortProbe: ComputerUsePortProbe = {
  isListening: (host, port) => new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (listening: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(500, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  }),
};

const defaultBrowserProfileCleaner: ComputerUseBrowserProfileCleaner = {
  remove: (displayIndex) => rm(
    computerUseBrowserProfileDirectory(displayIndex),
    { recursive: true, force: true },
  ),
};

export interface SystemdComputerUseWindowSupervisorOptions {
  readonly commandRunner?: ComputerUseSystemCommandRunner;
  readonly portProbe?: ComputerUsePortProbe;
  readonly host?: string;
  readonly startupTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly browserProfileCleaner?: ComputerUseBrowserProfileCleaner;
}

export class SystemdComputerUseWindowSupervisor implements ComputerUseWindowSupervisor {
  private readonly commandRunner: ComputerUseSystemCommandRunner;
  private readonly portProbe: ComputerUsePortProbe;
  private readonly host: string;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly browserProfileCleaner: ComputerUseBrowserProfileCleaner;

  constructor(options: SystemdComputerUseWindowSupervisorOptions = {}) {
    this.commandRunner = options.commandRunner ?? defaultCommandRunner;
    this.portProbe = options.portProbe ?? defaultPortProbe;
    this.host = options.host ?? "127.0.0.1";
    this.startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.browserProfileCleaner = options.browserProfileCleaner
      ?? defaultBrowserProfileCleaner;
  }

  private systemctl(action: "start" | "stop", displayIndex: number): Promise<void> {
    return this.commandRunner.run("/usr/bin/sudo", [
      "-n",
      "/usr/bin/systemctl",
      action,
      computerUseWindowUnit(displayIndex),
    ]);
  }

  async ensureWindow(assignment: ComputerUseDesktopAssignment): Promise<void> {
    await this.systemctl("start", assignment.displayIndex);
    const port = computerUseRfbPort(assignment.displayIndex);
    const deadline = performance.now() + this.startupTimeoutMs;
    while (performance.now() < deadline) {
      if (await this.portProbe.isListening(this.host, port)) return;
      await delay(this.pollIntervalMs);
    }
    throw new Error(
      `Computer Use display :${assignment.displayIndex} did not become ready`,
    );
  }

  async stopWindow(assignment: ComputerUseDesktopAssignment): Promise<void> {
    await this.systemctl("stop", assignment.displayIndex);
    await this.browserProfileCleaner.remove(assignment.displayIndex);
  }
}
