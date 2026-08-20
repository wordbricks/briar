/**
 * Detached execution worker.
 *
 * `briar worker` runs on a machine that holds the repository, claims queued
 * issues from the Worker API, runs the agent locally, and reports progress
 * back. The desktop app only observes. The queue is the durable state, so a
 * worker that dies is recovered by the server-side reaper rather than by
 * keeping a socket alive.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir, hostname, platform } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { ModelEffort } from "../src/lib/agent-provider-contract";
import type { AgentProvider } from "../src/lib/agent-provider";

export type ClaimedIssue = {
  workType?:
    | "issue"
    | "issueReply"
    | "channelReply"
    | "projectAgentTask"
    | "mergeGroupValidation";
  workId?: string;
  /** Immutable identity of one run claim/execution attempt. */
  executionId?: string;
  runId: string;
  sourceKey: string;
  title: string;
  createdByUserId?: string | null;
  claimToken: string;
  leaseExpiresAt: string;
  claimAttempts?: number;
  execution?: {
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
  } | null;
  agent?: {
    id: string;
    name: string;
    provider: AgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    responsibility: string;
    skill: string;
  } | null;
};

export type WorkerClaimResult = {
  work: ClaimedIssue | null;
  /** Server-provided lower bound for the next empty-queue poll. */
  retryAfterMs?: number;
};

export type WorkerClaimOptions = {
  /** The caller's regular execution slots are full; prefer reply work only. */
  repliesOnly?: boolean;
};

export type WorkerLoopUpdateDirective = {
  id: string;
  targetVersion: string;
  status: "requested";
  requestedAt: string;
  handoffState?: "idle" | "draining" | "ready" | "failed";
};

export type WorkerExecutionCheckpoint = {
  conversationId?: string | null;
  workspacePath?: string | null;
};

export class WorkerUpdateDrainError extends Error {
  constructor() {
    super("Worker is draining for a planned update");
    this.name = "WorkerUpdateDrainError";
  }
}

export const isReplyWork = (
  issue: Pick<ClaimedIssue, "workType">,
): boolean => issue.workType === "issueReply" || issue.workType === "channelReply";

export type WorkerLoopDependencies = {
  /** Claim the next queued work item, or report an empty queue. */
  claim: (
    options?: WorkerClaimOptions,
  ) => Promise<ClaimedIssue | null | WorkerClaimResult>;
  /** Renew the lease of the run currently in flight. */
  renewLease: (issue: ClaimedIssue) => Promise<void>;
  heartbeat: (
    readinessState?: "ready" | "busy",
  ) => Promise<{
    acceptingWork?: boolean;
    maxConcurrentSessions?: number;
    updateDirective?: WorkerLoopUpdateDirective | null;
  } | void>;
  /** Run the agent for one claimed issue. */
  runIssue: (
    issue: ClaimedIssue,
    signal: AbortSignal,
    checkpoint: (value: WorkerExecutionCheckpoint) => void,
  ) => Promise<void>;
  /** Atomically release one claim to the next Worker after its provider stops. */
  handoff?: (
    issue: ClaimedIssue,
    requestId: string,
    checkpoint: WorkerExecutionCheckpoint,
  ) => Promise<void>;
  /**
   * Wait, returning early when `signal` aborts. The lease-renewal wait must be
   * interruptible: otherwise a finished issue still holds the loop for a full
   * renewal interval before the next claim.
   */
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  now: () => number;
  /** Injectable jitter source; production defaults to Math.random. */
  random?: () => number;
  log: (line: string) => void;
};

export type WorkerLoopOptions = {
  maxIssues?: number;
  maxConcurrentSessions?: number;
  once?: boolean;
  idleDelayMs?: number;
  maxIdleDelayMs?: number;
  heartbeatIntervalMs?: number;
  leaseRenewIntervalMs?: number;
  maxErrorDelayMs?: number;
};

export type WorkerLoopResult = {
  processed: number;
  failures: number;
  stoppedBecause: "maxIssues" | "once" | "emptyQueue" | "stopRequested";
};

export const DEFAULT_IDLE_DELAY_MS = 15_000;
export const DEFAULT_MAX_IDLE_DELAY_MS = 60_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;
/** A 15-minute server lease leaves ample recovery margin at this cadence. */
export const DEFAULT_LEASE_RENEW_INTERVAL_MS = 5 * 60_000;
export const DEFAULT_MAX_ERROR_DELAY_MS = 5 * 60_000;
export const DEFAULT_MAX_CONCURRENT_SESSIONS = 1;
export const MAX_CONCURRENT_SESSIONS = 16;

export function workerCliPath(
  home = homedir(),
  configured = process.env.BRIAR_CLI,
): string {
  const desktopAppBinary = configured?.replaceAll("\\", "/").match(
    /\/[^/]+\.app\/Contents\/MacOS\/briar$/u,
  );
  return configured && isAbsolute(configured) && !desktopAppBinary
    ? configured
    : join(home, ".local", "bin", "briar");
}

export function workerExecutionPath(
  environmentPath = process.env.PATH,
  home = homedir(),
): string {
  const localBin = join(home, ".local", "bin");
  const paths = (environmentPath ?? "")
    .split(delimiter)
    .filter((path) => path.length > 0 && path !== localBin);
  return [localBin, ...paths].join(delimiter);
}

/**
 * Issue executions must never share a runtime directory. Keep the execution
 * identity in the leaf name instead of nesting it below the legacy run-id
 * directory: a still-running older CLI may recursively remove that legacy
 * directory during cleanup.
 */
export function issueWorkerSessionDirectory(
  configDirectory: string,
  issue: Pick<ClaimedIssue, "runId" | "executionId"> & { claimAttempts: number },
): string {
  const executionIdentity = issue.executionId ??
    `claim-${issue.claimAttempts}`;
  return join(
    configDirectory,
    "worker-sessions",
    `${issue.runId}--${executionIdentity}`,
  );
}

/** Random, opaque identity persisted in Briar's 0600 local config. */
export function createWorkerDeviceIdentity(
  randomHex = () => randomBytes(32).toString("hex"),
): string {
  const identity = randomHex();
  if (!/^[0-9a-f]{64}$/u.test(identity)) {
    throw new Error("Worker device identity source must return 32 random bytes");
  }
  return `briar_device_${identity}`;
}

export function defaultWorkerLabel(host = hostname()): string {
  const trimmed = host.trim().replace(/\.local$/u, "");
  return (trimmed.length > 0 ? trimmed : "briar-worker").slice(0, 100);
}

/** Exponential backoff with a ceiling, so a broken API is retried politely. */
export function errorDelayMs(
  consecutiveFailures: number,
  maxDelayMs = DEFAULT_MAX_ERROR_DELAY_MS,
): number {
  const delay = 2_000 * 2 ** Math.max(0, consecutiveFailures - 1);
  return Math.min(delay, maxDelayMs);
}

/**
 * Empty queues back off separately from failures. A small jitter prevents a
 * fleet of workers that started together from polling in lockstep.
 */
export function idleDelayWithBackoffMs(
  consecutiveEmptyClaims: number,
  baseDelayMs = DEFAULT_IDLE_DELAY_MS,
  maxDelayMs = DEFAULT_MAX_IDLE_DELAY_MS,
  random = Math.random,
): number {
  const exponential = baseDelayMs * 2 ** Math.max(0, consecutiveEmptyClaims - 1);
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.max(1, Math.min(maxDelayMs, Math.round(exponential * jitter)));
}

export function leaseRenewDelayMs(
  intervalMs = DEFAULT_LEASE_RENEW_INTERVAL_MS,
  random = Math.random,
): number {
  const jitter = 0.9 + Math.min(1, Math.max(0, random())) * 0.2;
  return Math.max(1, Math.round(intervalMs * jitter));
}

/**
 * Claim-run-report loop. All I/O is injected so the state machine is testable
 * without a server, an agent, or real time.
 */
export async function runWorkerLoop(
  dependencies: WorkerLoopDependencies,
  options: WorkerLoopOptions = {},
): Promise<WorkerLoopResult> {
  const maxIssues = options.once ? 1 : (options.maxIssues ?? Number.POSITIVE_INFINITY);
  const idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
  const maxIdleDelayMs = options.maxIdleDelayMs ?? DEFAULT_MAX_IDLE_DELAY_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const leaseRenewIntervalMs =
    options.leaseRenewIntervalMs ?? DEFAULT_LEASE_RENEW_INTERVAL_MS;
  let maxConcurrentSessions = normalizeConcurrency(
    options.maxConcurrentSessions ?? DEFAULT_MAX_CONCURRENT_SESSIONS,
  );
  let acceptingWork = true;

  let processed = 0;
  let failures = 0;
  let consecutiveFailures = 0;
  let consecutiveEmptyClaims = 0;
  // Negative infinity so the first iteration always beats: a worker that has
  // not reported yet must not wait out a whole interval before appearing.
  let lastHeartbeatAt = Number.NEGATIVE_INFINITY;
  const active = new Map<
    string,
    Promise<{ issue: ClaimedIssue; error: unknown | null; handedOff: boolean }>
  >();
  const activeControllers = new Map<string, AbortController>();
  let activeSlotCount = 0;
  let updateDirective: WorkerLoopUpdateDirective | null = null;
  const serialTails = new Map<string, Promise<void>>();
  const executionKey = (issue: ClaimedIssue) =>
    issue.workId ?? issue.executionId ?? `${issue.runId}:${issue.claimToken}`;
  const serialKey = (issue: ClaimedIssue) =>
    !issue.workType || issue.workType === "issue" ? issue.runId : null;

  const applyHeartbeat = (
    heartbeat:
      | {
          acceptingWork?: boolean;
          maxConcurrentSessions?: number;
          updateDirective?: WorkerLoopUpdateDirective | null;
        }
      | void,
  ) => {
    if (heartbeat?.acceptingWork !== undefined) {
      acceptingWork = heartbeat.acceptingWork;
    }
    if (heartbeat?.maxConcurrentSessions !== undefined) {
      maxConcurrentSessions = normalizeConcurrency(
        heartbeat.maxConcurrentSessions,
      );
    }
    if (heartbeat?.updateDirective) {
      updateDirective = heartbeat.updateDirective;
      acceptingWork = false;
      for (const controller of activeControllers.values()) {
        if (!controller.signal.aborted) {
          controller.abort(new WorkerUpdateDrainError());
        }
      }
    }
  };
  const reportState = async () => {
    applyHeartbeat(
      await dependencies.heartbeat(activeSlotCount > 0 ? "busy" : "ready"),
    );
    lastHeartbeatAt = dependencies.now();
  };
  const beat = async () => {
    if (dependencies.now() - lastHeartbeatAt < heartbeatIntervalMs) return;
    await reportState();
  };

  const execute = async (issue: ClaimedIssue, waitForTurn: Promise<void>) => {
    const renewal = new AbortController();
    const execution = new AbortController();
    const key = executionKey(issue);
    activeControllers.set(key, execution);
    let checkpoint: WorkerExecutionCheckpoint = {};
    let leaseFailure: unknown = null;
    const renewalLoop = (async () => {
      while (!renewal.signal.aborted) {
        await dependencies.sleep(
          leaseRenewDelayMs(leaseRenewIntervalMs, dependencies.random),
          renewal.signal,
        );
        if (renewal.signal.aborted) break;
        try {
          await dependencies.renewLease(issue);
        } catch (error) {
          leaseFailure = error;
          dependencies.log(
            `lease renewal failed for ${issue.sourceKey}: ${describe(error)}`,
          );
          execution.abort(error);
          return;
        }
      }
    })();

    try {
      // Rework can make the same run claimable before its previous provider
      // process has exited. Renew the new claim above, but do not let two
      // agents edit the same issue worktree at the same time.
      if (updateDirective) {
        await Promise.race([
          waitForTurn,
          new Promise<void>((resolve) => {
            if (execution.signal.aborted) {
              resolve();
              return;
            }
            execution.signal.addEventListener("abort", () => resolve(), {
              once: true,
            });
          }),
        ]);
      } else {
        // Preserve the pre-update lease-failure behavior: a provider that is
        // already starting still receives the aborted signal and can stop
        // its child process, while an update arriving before its turn is
        // handled by the branch above on the next scheduling pass.
        await waitForTurn;
      }
      if (execution.signal.aborted && updateDirective) {
        throw execution.signal.reason ?? new WorkerUpdateDrainError();
      }
      if (leaseFailure) throw leaseFailure;
      await dependencies.runIssue(issue, execution.signal, (value) => {
        checkpoint = { ...checkpoint, ...value };
      });
      if (leaseFailure) throw leaseFailure;
      if (updateDirective && execution.signal.aborted) {
        if (!dependencies.handoff) {
          throw new Error("Worker update handoff is not configured");
        }
        await dependencies.handoff(issue, updateDirective.id, checkpoint);
        return { issue, error: null, handedOff: true };
      }
      return { issue, error: null, handedOff: false };
    } catch (error) {
      if (updateDirective && execution.signal.aborted) {
        try {
          if (!dependencies.handoff) {
            throw new Error("Worker update handoff is not configured");
          }
          await dependencies.handoff(issue, updateDirective.id, checkpoint);
          return { issue, error: null, handedOff: true };
        } catch (handoffError) {
          return { issue, error: handoffError, handedOff: false };
        }
      }
      return { issue, error, handedOff: false };
    } finally {
      renewal.abort();
      execution.abort();
      await renewalLoop;
      activeControllers.delete(key);
    }
  };

  const schedule = (issue: ClaimedIssue) => {
    const runKey = serialKey(issue);
    const previous = runKey
      ? (serialTails.get(runKey) ?? Promise.resolve())
      : Promise.resolve();
    let releaseTurn = () => {};
    let tail: Promise<void> | null = null;
    if (runKey) {
      const current = new Promise<void>((resolve) => {
        releaseTurn = resolve;
      });
      tail = previous.then(() => current);
      serialTails.set(runKey, tail);
    }
    const execution = execute(issue, previous).finally(() => {
      releaseTurn();
      if (runKey && tail && serialTails.get(runKey) === tail) {
        serialTails.delete(runKey);
      }
    });
    active.set(executionKey(issue), execution);
  };

  while (processed < maxIssues) {
    let queueWasEmpty = false;
    let emptyQueueDelayMs = idleDelayMs;
    try {
      await beat();
      while (
        acceptingWork &&
        processed + active.size < maxIssues
      ) {
        const repliesOnly = activeSlotCount >= maxConcurrentSessions;
        const claim = await dependencies.claim({ repliesOnly });
        const issue = isWorkerClaimResult(claim) ? claim.work : claim;
        if (!issue) {
          queueWasEmpty = true;
          consecutiveFailures = 0;
          consecutiveEmptyClaims += 1;
          const serverDelayMs = isWorkerClaimResult(claim) &&
              Number.isFinite(claim.retryAfterMs) &&
              (claim.retryAfterMs ?? 0) > 0
            ? claim.retryAfterMs!
            : idleDelayMs;
          emptyQueueDelayMs = Math.max(
            serverDelayMs,
            idleDelayWithBackoffMs(
              consecutiveEmptyClaims,
              Math.max(idleDelayMs, serverDelayMs),
              Math.max(maxIdleDelayMs, serverDelayMs),
              dependencies.random,
            ),
          );
          break;
        }
        if (repliesOnly && !isReplyWork(issue)) {
          throw new Error(
            "Worker claim returned slot-consuming work while reply-only polling",
          );
        }
        consecutiveEmptyClaims = 0;
        dependencies.log(`claimed ${issue.sourceKey} (${issue.runId})`);
        schedule(issue);
        if (!isReplyWork(issue)) activeSlotCount += 1;
        await reportState();
      }
      if (!acceptingWork && active.size === 0) {
        queueWasEmpty = true;
        consecutiveEmptyClaims += 1;
        emptyQueueDelayMs = idleDelayWithBackoffMs(
          consecutiveEmptyClaims,
          idleDelayMs,
          maxIdleDelayMs,
          dependencies.random,
        );
      }
    } catch (error) {
      failures += 1;
      consecutiveFailures += 1;
      dependencies.log(`worker iteration failed: ${describe(error)}`);
      if (options.once && active.size === 0) {
        return { processed, failures, stoppedBecause: "once" };
      }
      await dependencies.sleep(
        errorDelayMs(consecutiveFailures, options.maxErrorDelayMs),
      );
    }

    if (active.size === 0) {
      if (options.once) {
        return { processed, failures, stoppedBecause: "emptyQueue" };
      }
      if (queueWasEmpty) {
        const heartbeatDelayMs = Math.max(
          0,
          heartbeatIntervalMs - (dependencies.now() - lastHeartbeatAt),
        );
        await dependencies.sleep(Math.min(emptyQueueDelayMs, heartbeatDelayMs));
      }
      continue;
    }

    const executionFinished = Promise.race(active.values());
    const heartbeatDelayMs = Math.max(
      0,
      heartbeatIntervalMs - (dependencies.now() - lastHeartbeatAt),
    );
    const waitDelayMs =
      queueWasEmpty && activeSlotCount < maxConcurrentSessions
        ? Math.min(emptyQueueDelayMs, heartbeatDelayMs)
        : heartbeatDelayMs;
    // Wake for the next heartbeat even when every execution slot is occupied.
    // Otherwise a long-running issue makes the server report the live worker
    // as stale until that issue finishes.
    const wake = new AbortController();
    const outcome = await Promise.race([
      executionFinished,
      dependencies.sleep(waitDelayMs, wake.signal).then(() => null),
    ]);
    wake.abort();
    if (!outcome) continue;

    active.delete(executionKey(outcome.issue));
    if (!isReplyWork(outcome.issue)) activeSlotCount -= 1;
    if (outcome.error === null) {
      if (outcome.handedOff) {
        consecutiveFailures = 0;
        dependencies.log(
          `handed off ${outcome.issue.sourceKey} for planned Worker update`,
        );
      } else {
        processed += 1;
        consecutiveFailures = 0;
        dependencies.log(`finished ${outcome.issue.sourceKey}`);
      }
    } else {
      failures += 1;
      consecutiveFailures += 1;
      dependencies.log(`worker iteration failed: ${describe(outcome.error)}`);
      if (options.once) {
        await reportState();
        return { processed, failures, stoppedBecause: "once" };
      }
      await dependencies.sleep(
        errorDelayMs(consecutiveFailures, options.maxErrorDelayMs),
      );
    }
    await reportState();
  }

  return {
    processed,
    failures,
    stoppedBecause: options.once ? "once" : "maxIssues",
  };
}

const normalizeConcurrency = (value: number) =>
  Math.min(
    MAX_CONCURRENT_SESSIONS,
    Math.max(
      DEFAULT_MAX_CONCURRENT_SESSIONS,
      Number.isInteger(value) ? value : DEFAULT_MAX_CONCURRENT_SESSIONS,
    ),
  );

const isWorkerClaimResult = (
  claim: ClaimedIssue | WorkerClaimResult | null,
): claim is WorkerClaimResult => Boolean(claim && "work" in claim);

const describe = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Timer wait that resolves early when the signal aborts. */
export function interruptibleSleep(
  milliseconds: number,
  signal?: AbortSignal,
): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, milliseconds);
    function onAbort() {
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ── Service installation ────────────────────────────────────────────────
// Briar generates and registers the unit itself: the most likely operational
// failure is a worker that silently stops after a reboot.

export type ServiceDefinition = {
  label: string;
  path: string;
  contents: string;
  enableCommand: string[];
  disableCommand: string[];
  restartCommand: string[];
  logPath: string;
};

export type RestartServicesResult = {
  restarted: number;
  skipped: number;
};

export function restartInstalledServices(
  definitions: ServiceDefinition[],
  dependencies: {
    exists: (path: string) => boolean;
    run: (command: string[]) => { success: boolean; error?: string };
  },
): RestartServicesResult {
  let restarted = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const definition of definitions) {
    if (!dependencies.exists(definition.path)) {
      skipped += 1;
      continue;
    }
    const result = dependencies.run(definition.restartCommand);
    if (result.success) {
      restarted += 1;
    } else {
      failures.push(
        `${definition.label}: ${result.error?.trim() || "restart failed"}`,
      );
    }
  }
  if (failures.length > 0) {
    throw new Error(`Worker service restart failed: ${failures.join("; ")}`);
  }
  return { restarted, skipped };
}

type WorkerServiceCommand = {
  projectId: string;
  briarBinary: string;
  runtimeBinary?: string;
  cliScript?: string;
};

export function serviceLabel(projectId: string): string {
  return `dev.briar.worker.${projectId}`;
}

export function workerLogPath(projectId: string, home = homedir()): string {
  return join(home, ".local", "state", "briar", "worker", `${projectId}.log`);
}

export function launchdPlist(input: {
  projectId: string;
  briarBinary: string;
  runtimeBinary?: string;
  cliScript?: string;
  workingDirectory: string;
  logPath: string;
  environmentPath?: string;
  briarCli?: string;
}): string {
  const label = serviceLabel(input.projectId);
  const programArguments = workerServiceCommand(input)
    .map((argument) => `    <string>${plistText(argument)}</string>`)
    .join("\n");
  const environmentVariables = input.environmentPath || input.briarCli
    ? `  <key>EnvironmentVariables</key>
  <dict>
${input.briarCli ? `    <key>BRIAR_CLI</key>
    <string>${plistText(input.briarCli)}</string>
` : ""}${input.environmentPath ? `    <key>PATH</key>
    <string>${plistText(input.environmentPath)}</string>
` : ""}  </dict>
`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${plistText(label)}</string>
  <key>ProgramArguments</key>
  <array>
${programArguments}
  </array>
  <key>WorkingDirectory</key>
  <string>${plistText(input.workingDirectory)}</string>
${environmentVariables}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${plistText(input.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${plistText(input.logPath)}</string>
</dict>
</plist>
`;
}

export function systemdUnit(input: {
  projectId: string;
  briarBinary: string;
  runtimeBinary?: string;
  cliScript?: string;
  workingDirectory: string;
}): string {
  const command = workerServiceCommand(input).join(" ");
  return `[Unit]
Description=Briar execution worker (${input.projectId})
After=network-online.target

[Service]
Type=simple
ExecStart=${command}
WorkingDirectory=${input.workingDirectory}
Restart=always
RestartSec=10

[Install]
WantedBy=default.target
`;
}

/**
 * Describe the service for this platform. The agent token is never written into
 * the unit: it stays in ~/.config/briar/config.json, mode 0600.
 */
export function serviceDefinition(input: {
  projectId: string;
  briarBinary: string;
  runtimeBinary?: string;
  cliScript?: string;
  workingDirectory: string;
  home?: string;
  platform?: string;
  environmentPath?: string;
}): ServiceDefinition {
  const home = input.home ?? homedir();
  const currentPlatform = input.platform ?? platform();
  const label = serviceLabel(input.projectId);
  const logPath = workerLogPath(input.projectId, home);

  if (currentPlatform === "darwin") {
    const briarCli = workerCliPath(home);
    return {
      label,
      path: join(home, "Library", "LaunchAgents", `${label}.plist`),
      contents: launchdPlist({
        projectId: input.projectId,
        briarBinary: input.briarBinary,
        runtimeBinary: input.runtimeBinary,
        cliScript: input.cliScript,
        workingDirectory: input.workingDirectory,
        logPath,
        // launchd does not inherit the PATH used to bootstrap the service.
        // Persist it so user-installed CLIs and their shebang runtimes remain
        // available after the desktop configuration command exits.
        environmentPath: workerExecutionPath(
          input.environmentPath ?? process.env.PATH,
          home,
        ),
        briarCli,
      }),
      enableCommand: ["launchctl", "bootstrap", `gui/${process.getuid?.() ?? 501}`],
      disableCommand: ["launchctl", "bootout", `gui/${process.getuid?.() ?? 501}`],
      restartCommand: [
        "launchctl",
        "kickstart",
        "-k",
        `gui/${process.getuid?.() ?? 501}/${label}`,
      ],
      logPath,
    };
  }
  if (currentPlatform === "linux") {
    const unitName = `briar-worker@${input.projectId}.service`;
    return {
      label: unitName,
      path: join(home, ".config", "systemd", "user", unitName),
      contents: systemdUnit({
        projectId: input.projectId,
        briarBinary: input.briarBinary,
        runtimeBinary: input.runtimeBinary,
        cliScript: input.cliScript,
        workingDirectory: input.workingDirectory,
      }),
      enableCommand: ["systemctl", "--user", "enable", "--now", unitName],
      disableCommand: ["systemctl", "--user", "disable", "--now", unitName],
      restartCommand: ["systemctl", "--user", "restart", unitName],
      logPath,
    };
  }
  throw new Error(
    "이 운영체제에서는 워커 서비스 설치를 지원하지 않습니다. `briar worker --project <id>`를 직접 실행하세요.",
  );
}

const workerServiceCommand = (input: WorkerServiceCommand): string[] => {
  const hasRuntimeBinary = Boolean(input.runtimeBinary);
  const hasCliScript = Boolean(input.cliScript);
  if (hasRuntimeBinary !== hasCliScript) {
    throw new Error(
      "Worker runtime binary and CLI script must be configured together",
    );
  }
  return hasRuntimeBinary
    ? [
        input.runtimeBinary!,
        input.cliScript!,
        "worker",
        "--project",
        input.projectId,
      ]
    : [input.briarBinary, "worker", "--project", input.projectId];
};

const plistText = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** Write the unit file with restrictive permissions. Idempotent. */
export async function writeServiceDefinition(definition: ServiceDefinition) {
  const directory = definition.path.slice(0, definition.path.lastIndexOf("/"));
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await mkdir(workerLogDirectory(definition.logPath), {
    recursive: true,
    mode: 0o700,
  });
  await writeFile(definition.path, definition.contents, { mode: 0o600 });
  await chmod(definition.path, 0o600);
  return definition.path;
}

const workerLogDirectory = (logPath: string) =>
  logPath.slice(0, logPath.lastIndexOf("/"));
