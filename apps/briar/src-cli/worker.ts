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
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir, hostname, platform } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";
import type { ModelEffort } from "../src/lib/agent-provider-contract";
import type { AgentProvider } from "../src/lib/agent-provider";
import type { WorkerWakeReason } from "../src/lib/worker-wake-protocol";
import type { WorkerWakeSource } from "./worker-wake-client";
import { channelReplySnapshotChannelKind } from "./channel-reply-workspace";

export type ClaimedIssue = {
  workType?:
    | "issue"
    | "issueReply"
    | "channelReply"
    | "projectAgentTask"
    | "dmMemory"
    | "mergeBatch";
  workId?: string;
  session?: { id: string } | null;
  routing?: { action: string } | null;
  /**
   * The claim's untrusted prompt snapshot. The loop reads nothing out of it but
   * the channel kind, which decides how often a reply renews its lease.
   */
  snapshot?: unknown;
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
  } | null;
};

export type WorkerClaimResult<Issue extends ClaimedIssue = ClaimedIssue> = {
  work: Issue | null;
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

export function createWorkerLoopHeartbeat(input: {
  acceptingWork: boolean;
  maxConcurrentSessions?: number;
  updateDirective?: WorkerLoopUpdateDirective | null;
}) {
  return {
    acceptingWork: input.acceptingWork,
    maxConcurrentSessions: input.maxConcurrentSessions,
    updateDirective: input.updateDirective ?? null,
  };
}

export type WorkerExecutionCheckpoint = {
  conversationId?: string | null;
  workspacePath?: string | null;
};

interface LeaseRenewalFailure {
  error: unknown;
}

interface LeaseRenewalState {
  failure: LeaseRenewalFailure | null;
}

export class WorkerUpdateDrainError extends Error {
  constructor() {
    super("Worker is draining for a planned update");
    this.name = "WorkerUpdateDrainError";
  }
}

class WorkerHeartbeatError extends Error {
  constructor(readonly cause: unknown) {
    super(`Worker heartbeat failed: ${describe(cause)}`);
    this.name = "WorkerHeartbeatError";
  }
}

export const isReplyWork = (
  issue: Pick<ClaimedIssue, "workType">,
): boolean => issue.workType === "issueReply" || issue.workType === "channelReply";

export type WorkerLoopDependencies<Issue extends ClaimedIssue = ClaimedIssue> = {
  /** Claim the next queued work item, or report an empty queue. */
  claim: (
    options?: WorkerClaimOptions,
  ) => Promise<Issue | null | WorkerClaimResult<Issue>>;
  /** Renew the lease of the run currently in flight. */
  renewLease: (issue: Issue) => Promise<void>;
  heartbeat: (
    readinessState?: "ready" | "busy",
  ) => Promise<{
    acceptingWork?: boolean;
    maxConcurrentSessions?: number;
    updateDirective?: WorkerLoopUpdateDirective | null;
  } | void>;
  /**
   * Whether a channel reply's first provider turn has started. Before it has,
   * a lease conflict is almost always the steer the reply's own setup is about
   * to fold into the same claim, so the renewal defers to it instead of
   * throwing a claim away that is still perfectly usable. Absent means the old
   * behaviour: every conflict aborts.
   */
  replyTurnStarted?: (issue: Issue) => boolean;
  /** Run the agent for one claimed issue. */
  runIssue: (
    issue: Issue,
    signal: AbortSignal,
    checkpoint: (value: WorkerExecutionCheckpoint) => void,
  ) => Promise<void | { steered: true }>;
  /** Atomically release one claim to the next Worker after its provider stops. */
  handoff?: (
    issue: Issue,
    requestId: string,
    checkpoint: WorkerExecutionCheckpoint,
  ) => Promise<void>;
  drained?: (requestId: string) => Promise<void>;
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
  /**
   * Server push that cuts an idle wait short. Optional: without it the loop
   * behaves exactly as it did when polling was the only signal.
   */
  wake?: WorkerWakeSource;
};

export type WorkerLoopOptions = {
  maxIssues?: number;
  maxConcurrentSessions?: number;
  once?: boolean;
  idleDelayMs?: number;
  maxIdleDelayMs?: number;
  heartbeatIntervalMs?: number;
  drainHeartbeatIntervalMs?: number;
  maxHeartbeatErrorDelayMs?: number;
  leaseRenewIntervalMs?: number;
  maxErrorDelayMs?: number;
};

/** The idle wait a claim attempt followed, as `claim latency:` reports it. */
type WorkerIdleWait = {
  waitedMs: number;
  /** The wake that cut the wait short, or what the wait was there for. */
  wake: WorkerWakeReason | "poll" | "heartbeat";
};

export type WorkerLoopResult = {
  processed: number;
  failures: number;
  stoppedBecause: "maxIssues" | "once" | "emptyQueue" | "stopRequested";
};

export const DEFAULT_IDLE_DELAY_MS = 15_000;
export const DEFAULT_MAX_IDLE_DELAY_MS = 60_000;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 30_000;
export const DEFAULT_DRAIN_HEARTBEAT_INTERVAL_MS = 10_000;
export const DEFAULT_MAX_HEARTBEAT_ERROR_DELAY_MS = 30_000;
/** A 15-minute server lease leaves ample recovery margin at this cadence. */
export const DEFAULT_LEASE_RENEW_INTERVAL_MS = 5 * 60_000;
/**
 * How often a direct-message reply renews while it runs.
 *
 * The renewal is the only thing that asks the server whether the person has
 * said something else, and a plain DM used to ask every five minutes: a second
 * message sent seconds after the first was noticed only when the finished
 * answer was refused. Five seconds is what a routing reply already used.
 */
export const DM_REPLY_STEER_POLL_MS = 5_000;

/** Whether a claim is a direct-message reply, which is steered mid-turn. */
const isDirectMessageReply = (issue: ClaimedIssue) =>
  issue.workType === "channelReply" &&
  channelReplySnapshotChannelKind(issue.snapshot) === "dm";
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

/** Issue executions must never share a runtime directory. */
export function issueWorkerSessionDirectory(
  configDirectory: string,
  issue: Pick<ClaimedIssue, "runId"> & { executionId: string },
): string {
  return join(
    configDirectory,
    "worker-sessions",
    `${issue.runId}--${issue.executionId}`,
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

export function heartbeatErrorDelayMs(
  consecutiveFailures: number,
  maxDelayMs = DEFAULT_MAX_HEARTBEAT_ERROR_DELAY_MS,
  random = Math.random,
): number {
  const delay = errorDelayMs(consecutiveFailures, maxDelayMs);
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return Math.max(1, Math.min(maxDelayMs, Math.round(delay * jitter)));
}

export function heartbeatDelayMs(
  intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
  random = Math.random,
): number {
  const jitter = 0.9 + Math.min(1, Math.max(0, random())) * 0.2;
  return Math.max(1, Math.round(intervalMs * jitter));
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

/**
 * How long to wait after an empty claim.
 *
 * A server delay shorter than the base idle delay is a deliberate "come back
 * soon" hint from the server and is honored exactly: stretching it to the poll
 * interval would strand work the server knows is about to be claimable.
 * Anything else keeps the historical behaviour, where the server delay is only
 * ever a floor under the backoff.
 */
export function emptyClaimDelayMs(input: {
  serverDelayMs: number | null;
  consecutiveEmptyClaims: number;
  idleDelayMs?: number;
  maxIdleDelayMs?: number;
  random?: () => number;
}): number {
  const idleDelayMs = input.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
  const maxIdleDelayMs = input.maxIdleDelayMs ?? DEFAULT_MAX_IDLE_DELAY_MS;
  const serverDelayMs = input.serverDelayMs;
  if (serverDelayMs !== null && serverDelayMs < idleDelayMs) {
    return serverDelayMs;
  }
  const floor = serverDelayMs ?? idleDelayMs;
  return Math.max(
    floor,
    idleDelayWithBackoffMs(
      input.consecutiveEmptyClaims,
      Math.max(idleDelayMs, floor),
      Math.max(maxIdleDelayMs, floor),
      input.random,
    ),
  );
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
export async function runWorkerLoop<Issue extends ClaimedIssue>(
  dependencies: WorkerLoopDependencies<Issue>,
  options: WorkerLoopOptions = {},
): Promise<WorkerLoopResult> {
  const maxIssues = options.once ? 1 : (options.maxIssues ?? Number.POSITIVE_INFINITY);
  const idleDelayMs = options.idleDelayMs ?? DEFAULT_IDLE_DELAY_MS;
  const maxIdleDelayMs = options.maxIdleDelayMs ?? DEFAULT_MAX_IDLE_DELAY_MS;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  const drainHeartbeatIntervalMs =
    options.drainHeartbeatIntervalMs ?? DEFAULT_DRAIN_HEARTBEAT_INTERVAL_MS;
  const maxHeartbeatErrorDelayMs =
    options.maxHeartbeatErrorDelayMs ?? DEFAULT_MAX_HEARTBEAT_ERROR_DELAY_MS;
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
  let consecutiveHeartbeatFailures = 0;
  // Negative infinity makes the first iteration report immediately. Later
  // deadlines are jittered so a fleet does not write to D1 in lockstep.
  let nextHeartbeatAt = Number.NEGATIVE_INFINITY;
  const active = new Map<
    string,
    Promise<{ issue: Issue; error: unknown | null; handedOff: boolean; steered?: boolean }>
  >();
  const activeControllers = new Map<string, AbortController>();
  const atomicLearningControllers = new Set<AbortController>();
  let activeSlotCount = 0;
  let updateDirective: WorkerLoopUpdateDirective | null = null;
  const serialTails = new Map<string, Promise<void>>();
  const executionKey = (issue: Issue) => issue.workType === "mergeBatch" || issue.workType === "channelReply"
    ? `${issue.runId}:${issue.claimToken}`
    : issue.workId ?? issue.executionId ?? `${issue.runId}:${issue.claimToken}`;
  const serialKey = (issue: Issue) =>
    !issue.workType || issue.workType === "issue" ||
        issue.workType === "mergeBatch"
      ? issue.runId
      : issue.workType === "channelReply" && issue.session
        ? `channel-session:${issue.session.id}`
        : null;

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
    if (heartbeat && heartbeat.updateDirective !== undefined) {
      updateDirective = heartbeat.updateDirective;
    }
    if (updateDirective?.handoffState === "idle") updateDirective = null;
    if (updateDirective) {
      acceptingWork = false;
      for (const controller of activeControllers.values()) {
        // Memory learning commits a budgeted proposer/verifier transaction. It has
        // no resumable provider conversation; finish this bounded system job instead
        // of replaying a charged call. The updater cancels if draining exceeds 120s.
        if (atomicLearningControllers.has(controller)) continue;
        if (!controller.signal.aborted) {
          controller.abort(new WorkerUpdateDrainError());
        }
      }
    }
  };
  /*
    What the claim about to be attempted waited on, so `claim latency:` can say
    whether a slow reply lost its seconds to the poll interval, to the
    heartbeat, or to the claim RPC itself.
  */
  let heartbeatBlockedMs = 0;
  let idleWait: WorkerIdleWait = { waitedMs: 0, wake: "poll" };
  const reportState = async () => {
    const startedAt = dependencies.now();
    try {
      applyHeartbeat(
        await dependencies.heartbeat(activeSlotCount > 0 ? "busy" : "ready"),
      );
      consecutiveHeartbeatFailures = 0;
      nextHeartbeatAt = dependencies.now() + heartbeatDelayMs(
        updateDirective ? drainHeartbeatIntervalMs : heartbeatIntervalMs,
        dependencies.random,
      );
    } catch (error) {
      consecutiveHeartbeatFailures += 1;
      throw new WorkerHeartbeatError(error);
    } finally {
      heartbeatBlockedMs = Math.max(0, dependencies.now() - startedAt);
    }
  };
  const beat = async () => {
    if (dependencies.now() < nextHeartbeatAt) {
      heartbeatBlockedMs = 0;
      return;
    }
    await reportState();
  };

  // Server pushes abort whichever idle wait is in flight. A wake that lands
  // while the loop is between waits sets `wakePending` so the next wait is
  // skipped instead of lost.
  const idleWaits = new Set<AbortController>();
  const leaseWaits = new Set<AbortController>();
  let leaseWakeVersion = 0;
  let wakePending = false;
  /** The reason of the most recent server wake, and how many have arrived. */
  let lastWakeReason: WorkerWakeReason | null = null;
  let wakeCount = 0;
  const unsubscribeWake = dependencies.wake?.subscribe((reason) => {
    wakePending = true;
    lastWakeReason = reason;
    wakeCount += 1;
    // Work exists now, so the empty-queue backoff must start over rather than
    // keep the fleet at its 60s ceiling.
    consecutiveEmptyClaims = 0;
    dependencies.log(`worker woken by server (${reason})`);
    for (const controller of idleWaits) controller.abort();
    idleWaits.clear();
    // A settled reply can revoke a running claim. Wake only the authority
    // check; the server decides which execution (if any) must abort.
    if (reason === "channel_reply_completed" || reason === "channel_reply_enqueued") {
      leaseWakeVersion += 1;
      for (const controller of leaseWaits) controller.abort();
    }
  });
  const finish = (result: WorkerLoopResult) => {
    unsubscribeWake?.();
    return result;
  };
  const waitWhileIdle = async (
    milliseconds: number,
    controller?: AbortController,
  ) => {
    if (!dependencies.wake) {
      if (controller) {
        await dependencies.sleep(milliseconds, controller.signal);
        return;
      }
      await dependencies.sleep(milliseconds);
      return;
    }
    if (wakePending) {
      wakePending = false;
      return;
    }
    const wait = controller ?? new AbortController();
    idleWaits.add(wait);
    try {
      await dependencies.sleep(milliseconds, wait.signal);
    } finally {
      idleWaits.delete(wait);
      wakePending = false;
    }
  };
  /**
   * The idle wait, accounted for the next claim. `waiting` is what the wait was
   * for — the empty-queue poll or the next heartbeat — and a wake that lands
   * during it (or one already pending when it starts) replaces that with its
   * own reason.
   */
  const idleSleep = async (
    milliseconds: number,
    waiting: "poll" | "heartbeat",
    controller?: AbortController,
  ) => {
    const startedAt = dependencies.now();
    const pendingWakeReason = wakePending ? lastWakeReason : null;
    const wakesBefore = wakeCount;
    try {
      await waitWhileIdle(milliseconds, controller);
    } finally {
      const wokenBy = wakeCount > wakesBefore ? lastWakeReason : pendingWakeReason;
      idleWait = {
        waitedMs: Math.max(0, dependencies.now() - startedAt),
        wake: wokenBy === null ? waiting : wokenBy,
      };
    }
  };

  const execute = async (
    issue: Issue,
    waitForTurn: Promise<void>,
    claimedAtWakeVersion: number,
  ) => {
    const renewal = new AbortController();
    const execution = new AbortController();
    const key = executionKey(issue);
    activeControllers.set(key, execution);
    if (issue.workType === "dmMemory") atomicLearningControllers.add(execution);
    let checkpoint: WorkerExecutionCheckpoint = {};
    const leaseRenewal: LeaseRenewalState = { failure: null };
    const renewalLoop = (async () => {
      /*
        The version from before the claim RPC, not from here: a wake that landed
        while the claim was in flight is exactly the one that matters — the
        server sends it when a message is folded into the job being handed out —
        and reading the counter here would swallow it and then wait a whole
        interval before asking again.
      */
      let observedWakeVersion = claimedAtWakeVersion;
      while (!renewal.signal.aborted) {
        const leaseWait = new AbortController();
        const stopWait = () => leaseWait.abort();
        renewal.signal.addEventListener("abort", stopWait, { once: true });
        leaseWaits.add(leaseWait);
        try {
          if (observedWakeVersion === leaseWakeVersion) {
            await dependencies.sleep(
              leaseRenewDelayMs(
                issue.workType === "channelReply" &&
                    (issue.routing !== null && issue.routing !== undefined ||
                      isDirectMessageReply(issue))
                  ? Math.min(leaseRenewIntervalMs, DM_REPLY_STEER_POLL_MS)
                  : leaseRenewIntervalMs,
                dependencies.random,
              ),
              leaseWait.signal,
            );
          }
          observedWakeVersion = leaseWakeVersion;
        } finally {
          leaseWaits.delete(leaseWait);
          renewal.signal.removeEventListener("abort", stopWait);
        }
        if (renewal.signal.aborted) break;
        try {
          await dependencies.renewLease(issue);
          dependencies.log(
            `lease renewed for ${issue.sourceKey} (${issue.runId})`,
          );
        } catch (error) {
          /*
            A steer makes the server refuse the renewal, and before the first
            provider turn that is not a reason to throw the claim away: the
            reply's own setup asks for the folded claim right before it runs the
            provider, inside this same claim. Keep renewing until it does. Only
            a direct message is ever steered, so any other channel reply keeps
            aborting at once: its conflict is a real claim loss. A routing reply
            is excluded too: its classification turn owns the decision the
            server is waiting on, and it still aborts as it always has.
          */
          if (
            isDirectMessageReply(issue) && !issue.routing &&
            dependencies.replyTurnStarted?.(issue) === false
          ) {
            dependencies.log(
              `lease renewal deferred to the steer fold for ${issue.sourceKey}: ${
                describe(error)
              }`,
            );
            continue;
          }
          leaseRenewal.failure = { error };
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
      if (leaseRenewal.failure?.error) throw leaseRenewal.failure.error;
      dependencies.log(
        `execution started for ${issue.sourceKey} (${issue.runId}) attempt ${issue.claimAttempts ?? "unknown"}`,
      );
      const executionResult = await dependencies.runIssue(issue, execution.signal, (value) => {
        checkpoint = { ...checkpoint, ...value };
      });
      if (executionResult?.steered) {
        return { issue, error: null, handedOff: false, steered: true };
      }
      dependencies.log(
        `execution returned for ${issue.sourceKey} (${issue.runId})`,
      );
      if (leaseRenewal.failure?.error) throw leaseRenewal.failure.error;
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
      atomicLearningControllers.delete(execution);
    }
  };

  const schedule = (issue: Issue, claimedAtWakeVersion: number) => {
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
    const execution = execute(issue, previous, claimedAtWakeVersion)
      .finally(() => {
        releaseTurn();
        if (runKey && tail && serialTails.get(runKey) === tail) {
          serialTails.delete(runKey);
        }
      });
    active.set(executionKey(issue), execution);
  };

  const acknowledgeDrained = async () => {
    if (updateDirective && updateDirective.handoffState !== "failed") {
      await dependencies.drained?.(updateDirective.id);
    }
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
        const claimedAtWakeVersion = leaseWakeVersion;
        const claimStartedAt = dependencies.now();
        const claim = await dependencies.claim({ repliesOnly });
        const claimRpcMs = Math.max(0, dependencies.now() - claimStartedAt);
        const claimWait = idleWait;
        // The next claim in this burst waited on nothing but this one.
        idleWait = { waitedMs: 0, wake: "poll" };
        const issue = isWorkerClaimResult(claim) ? claim.work : claim;
        if (!issue) {
          queueWasEmpty = true;
          consecutiveFailures = 0;
          consecutiveEmptyClaims += 1;
          const serverDelayMs = isWorkerClaimResult(claim) &&
              Number.isFinite(claim.retryAfterMs) &&
              (claim.retryAfterMs ?? 0) > 0
            ? claim.retryAfterMs!
            : null;
          emptyQueueDelayMs = emptyClaimDelayMs({
            serverDelayMs,
            consecutiveEmptyClaims,
            idleDelayMs,
            maxIdleDelayMs,
            random: dependencies.random,
          });
          break;
        }
        if (repliesOnly && !isReplyWork(issue)) {
          throw new Error(
            "Worker claim returned slot-consuming work while reply-only polling",
          );
        }
        consecutiveEmptyClaims = 0;
        dependencies.log(`claimed ${issue.sourceKey} (${issue.runId})`);
        /*
          Where the seconds before this claim went. `waitedMs` is the idle wait
          the loop was in, `wake` says what ended it — a server push names
          itself — `rpcMs` is the claim call and `heartbeatMs` is what the
          heartbeat right before it cost. A reply that reaches the Worker late
          is one of these four and this line says which.
        */
        dependencies.log(`claim latency: ${JSON.stringify({
          workId: issue.workId ?? null,
          rpcMs: Math.round(claimRpcMs),
          waitedMs: Math.round(claimWait.waitedMs),
          wake: claimWait.wake,
          heartbeatMs: Math.round(heartbeatBlockedMs),
        })}`);
        schedule(issue, claimedAtWakeVersion);
        if (!isReplyWork(issue)) activeSlotCount += 1;
        await reportState();
      }
      if (!acceptingWork && active.size === 0) {
        await acknowledgeDrained();
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
      const heartbeatFailed = error instanceof WorkerHeartbeatError;
      failures += 1;
      if (!heartbeatFailed) consecutiveFailures += 1;
      dependencies.log(`worker iteration failed: ${describe(error)}`);
      if (options.once && active.size === 0) {
        return finish({ processed, failures, stoppedBecause: "once" });
      }
      await dependencies.sleep(
        heartbeatFailed
          ? heartbeatErrorDelayMs(
            consecutiveHeartbeatFailures,
            maxHeartbeatErrorDelayMs,
            dependencies.random,
          )
          : errorDelayMs(consecutiveFailures, options.maxErrorDelayMs),
      );
    }

    if (active.size === 0) {
      if (options.once) {
        return finish({ processed, failures, stoppedBecause: "emptyQueue" });
      }
      if (queueWasEmpty) {
        const heartbeatDelayMs = Math.max(
          0,
          nextHeartbeatAt - dependencies.now(),
        );
        await idleSleep(
          Math.min(emptyQueueDelayMs, heartbeatDelayMs),
          heartbeatDelayMs < emptyQueueDelayMs ? "heartbeat" : "poll",
        );
      }
      continue;
    }

    const executionFinished = Promise.race(active.values());
    const heartbeatDelayMs = Math.max(
      0,
      nextHeartbeatAt - dependencies.now(),
    );
    const pollingWhileActive = queueWasEmpty &&
      activeSlotCount < maxConcurrentSessions;
    const waitDelayMs = pollingWhileActive
      ? Math.min(emptyQueueDelayMs, heartbeatDelayMs)
      : heartbeatDelayMs;
    // Wake for the next heartbeat even when every execution slot is occupied.
    // Otherwise a long-running issue makes the server report the live worker
    // as stale until that issue finishes. A server wake ends this wait too, so
    // a reply that arrives mid-execution is claimed without a poll.
    const waitController = new AbortController();
    const outcome = await Promise.race([
      executionFinished,
      idleSleep(
        waitDelayMs,
        pollingWhileActive && emptyQueueDelayMs <= heartbeatDelayMs
          ? "poll"
          : "heartbeat",
        waitController,
      ).then(() => null),
    ]);
    waitController.abort();
    if (!outcome) continue;

    active.delete(executionKey(outcome.issue));
    if (!isReplyWork(outcome.issue)) activeSlotCount -= 1;
    if (outcome.error === null) {
      if (outcome.steered) {
        consecutiveFailures = 0;
        dependencies.log(`resuming ${outcome.issue.sourceKey} with followup input`);
      } else if (outcome.handedOff) {
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
        return finish({ processed, failures, stoppedBecause: "once" });
      }
      await dependencies.sleep(
        errorDelayMs(consecutiveFailures, options.maxErrorDelayMs),
      );
    }
    await reportState();
  }

  return finish({
    processed,
    failures,
    stoppedBecause: options.once ? "once" : "maxIssues",
  });
}

const normalizeConcurrency = (value: number) =>
  Math.min(
    MAX_CONCURRENT_SESSIONS,
    Math.max(
      DEFAULT_MAX_CONCURRENT_SESSIONS,
      Number.isInteger(value) ? value : DEFAULT_MAX_CONCURRENT_SESSIONS,
    ),
  );

const isWorkerClaimResult = <Issue extends ClaimedIssue>(
  claim: Issue | WorkerClaimResult<Issue> | null,
): claim is WorkerClaimResult<Issue> => Boolean(claim && "work" in claim);

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

export function launchdServiceTarget(
  definition: Pick<ServiceDefinition, "label" | "disableCommand">,
): string | null {
  if (definition.disableCommand[0] !== "launchctl") return null;
  const domain = definition.disableCommand[2];
  return domain ? `${domain}/${definition.label}` : null;
}

export function isLaunchdServiceNotFound(output: string): boolean {
  const normalized = output.toLowerCase();
  return normalized.includes("could not find service") ||
    normalized.includes("service not found");
}

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
        "--team",
        input.projectId,
      ]
    : [input.briarBinary, "worker", "--team", input.projectId];
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

/** Remove the unit after the service manager has stopped and disabled it. */
export async function removeServiceDefinition(definition: ServiceDefinition) {
  await rm(definition.path, { force: true });
}

const workerLogDirectory = (logPath: string) =>
  logPath.slice(0, logPath.lastIndexOf("/"));
