import { type ChildProcess, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { createConnection } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import {
  type ComputerUseBrowserLoginStore,
  computerUseBrowserProfileDirectory,
  FileComputerUseBrowserLoginStore,
} from "./computer-use-browser-login-store";
import type {
  ComputerUseDesktopAssignment,
  ComputerUseWindowSupervisor,
} from "./computer-use-desktop-manager";

export {
  computerUseBrowserProfileDirectory,
  defaultComputerUseBrowserProfilesDirectory,
} from "./computer-use-browser-login-store";

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
  readonly browserLoginStore?: ComputerUseBrowserLoginStore;
}

export class SystemdComputerUseWindowSupervisor implements ComputerUseWindowSupervisor {
  private readonly commandRunner: ComputerUseSystemCommandRunner;
  private readonly portProbe: ComputerUsePortProbe;
  private readonly host: string;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly browserProfileCleaner: ComputerUseBrowserProfileCleaner;
  private readonly browserLoginStore: ComputerUseBrowserLoginStore;

  constructor(options: SystemdComputerUseWindowSupervisorOptions = {}) {
    this.commandRunner = options.commandRunner ?? defaultCommandRunner;
    this.portProbe = options.portProbe ?? defaultPortProbe;
    this.host = options.host ?? "127.0.0.1";
    this.startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.browserProfileCleaner = options.browserProfileCleaner
      ?? defaultBrowserProfileCleaner;
    this.browserLoginStore = options.browserLoginStore
      ?? new FileComputerUseBrowserLoginStore();
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
    // A no-op once the display profile exists, so a reconnect or a restored
    // assignment keeps the profile the running Chrome already holds open.
    await this.browserLoginStore.seed(assignment.displayIndex);
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
    await this.browserLoginStore.capture(assignment.displayIndex);
    await this.browserProfileCleaner.remove(assignment.displayIndex);
  }
}

export const defaultComputerUseWindowLauncher =
  "/opt/briar/bin/briar-computer-use-window";

export interface ProcessComputerUseWindowSupervisorOptions {
  readonly launcher?: string;
  readonly portProbe?: ComputerUsePortProbe;
  readonly host?: string;
  readonly startupTimeoutMs?: number;
  readonly pollIntervalMs?: number;
  readonly browserProfileCleaner?: ComputerUseBrowserProfileCleaner;
  readonly browserLoginStore?: ComputerUseBrowserLoginStore;
  readonly spawnWindow?: (launcher: string, displayIndex: number) => ChildProcess;
}

/**
 * Window supervisor for environments without systemd, such as the Docker
 * sandbox. Each display is a direct child process of the box service; the
 * container's PID 1 (`--init`) reaps anything the service leaves behind.
 */
export class ProcessComputerUseWindowSupervisor implements ComputerUseWindowSupervisor {
  private readonly launcher: string;
  private readonly portProbe: ComputerUsePortProbe;
  private readonly host: string;
  private readonly startupTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly browserProfileCleaner: ComputerUseBrowserProfileCleaner;
  private readonly browserLoginStore: ComputerUseBrowserLoginStore;
  private readonly spawnWindow: (launcher: string, displayIndex: number) => ChildProcess;
  private readonly windows = new Map<number, ChildProcess>();

  constructor(options: ProcessComputerUseWindowSupervisorOptions = {}) {
    this.launcher = options.launcher ?? defaultComputerUseWindowLauncher;
    this.portProbe = options.portProbe ?? defaultPortProbe;
    this.host = options.host ?? "127.0.0.1";
    this.startupTimeoutMs = options.startupTimeoutMs ?? 120_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 200;
    this.browserProfileCleaner = options.browserProfileCleaner
      ?? defaultBrowserProfileCleaner;
    this.browserLoginStore = options.browserLoginStore
      ?? new FileComputerUseBrowserLoginStore();
    this.spawnWindow = options.spawnWindow ?? ((launcher, displayIndex) =>
      spawn(launcher, [String(displayIndex)], {
        env: process.env,
        stdio: ["ignore", "inherit", "inherit"],
        detached: true,
      }));
  }

  private running(displayIndex: number): ChildProcess | undefined {
    const child = this.windows.get(displayIndex);
    if (child && child.exitCode === null && child.signalCode === null) return child;
    this.windows.delete(displayIndex);
    return undefined;
  }

  async ensureWindow(assignment: ComputerUseDesktopAssignment): Promise<void> {
    const port = computerUseRfbPort(assignment.displayIndex);
    if (!this.running(assignment.displayIndex)) {
      await this.browserLoginStore.seed(assignment.displayIndex);
      const child = this.spawnWindow(this.launcher, assignment.displayIndex);
      child.once("exit", () => {
        if (this.windows.get(assignment.displayIndex) === child) {
          this.windows.delete(assignment.displayIndex);
        }
      });
      this.windows.set(assignment.displayIndex, child);
    }
    const deadline = performance.now() + this.startupTimeoutMs;
    while (performance.now() < deadline) {
      if (await this.portProbe.isListening(this.host, port)) return;
      if (!this.running(assignment.displayIndex)) break;
      await delay(this.pollIntervalMs);
    }
    throw new Error(
      `Computer Use display :${assignment.displayIndex} did not become ready`,
    );
  }

  async stopWindow(assignment: ComputerUseDesktopAssignment): Promise<void> {
    const child = this.running(assignment.displayIndex);
    if (child) {
      const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
      // The window launcher runs in its own session; signal the whole group
      // so the X server, session bus, and desktop go down together.
      try {
        process.kill(-child.pid!, "SIGTERM");
      } catch {
        child.kill("SIGTERM");
      }
      await Promise.race([exited, delay(10_000)]);
      if (child.exitCode === null && child.signalCode === null) {
        try {
          process.kill(-child.pid!, "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
      }
      this.windows.delete(assignment.displayIndex);
    }
    await this.browserLoginStore.capture(assignment.displayIndex);
    await this.browserProfileCleaner.remove(assignment.displayIndex);
  }
}

/**
 * Pick the window supervisor for this host. Managed computers drive systemd
 * template units through sudo; the sandbox sets
 * `BRIAR_COMPUTER_USE_WINDOW_SUPERVISOR=process` and owns the displays as
 * child processes instead.
 */
export function computerUseWindowSupervisorFromEnvironment(
  environment: NodeJS.ProcessEnv = process.env,
): ComputerUseWindowSupervisor {
  const configured = environment.BRIAR_COMPUTER_USE_WINDOW_SUPERVISOR?.trim();
  if (configured === "process") return new ProcessComputerUseWindowSupervisor();
  if (configured && configured !== "systemd") {
    throw new Error("BRIAR_COMPUTER_USE_WINDOW_SUPERVISOR must be systemd or process");
  }
  return new SystemdComputerUseWindowSupervisor();
}
