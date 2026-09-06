import { randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, dirname } from "node:path";
import * as DateTime from "effect/DateTime";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { IsoDateTimeUtc } from "../src/lib/date-time-schema";

export const COMPUTER_USE_PRIMARY_DISPLAY_INDEX = 1;
export const COMPUTER_USE_FIRST_AGENT_DISPLAY_INDEX = 2;
export const COMPUTER_USE_DEFAULT_MAX_DISPLAY_INDEX = 100;
export const defaultComputerUseAssignmentPath =
  "/var/lib/briar-computer-use/window-assignments.json";
export const computerUseOwnerTokenPattern = /^[A-Za-z0-9_-]+$/u;
/** Worker capability canaries borrow a display for one screenshot; their windows never persist. */
export const COMPUTER_USE_CANARY_AGENT_ID = "briar-capability-canary";
/** An Agent display that idles this long between turns is torn down. */
export const COMPUTER_USE_DEFAULT_IDLE_DISPLAY_TTL_MS = 72 * 60 * 60 * 1000;

const rejectExcessProperties = { onExcessProperty: "error" } as const;
const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: rejectExcessProperties });

const PersistedDesktopAssignment = strict(Schema.Struct({
  agentId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  displayIndex: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(COMPUTER_USE_FIRST_AGENT_DISPLAY_INDEX),
  ),
  ownerToken: Schema.NullOr(Schema.String.check(
    Schema.isPattern(computerUseOwnerTokenPattern),
    Schema.isMaxLength(128),
  )),
  updatedAt: IsoDateTimeUtc,
}));

const PersistedDesktopAssignments = strict(Schema.Struct({
  version: Schema.Literal(1),
  assignments: Schema.Array(PersistedDesktopAssignment),
})).check(Schema.makeFilter((input) => {
  const agentIds = new Set<string>();
  const displayIndices = new Set<number>();
  const issues: Array<Schema.FilterIssue> = [];
  for (const [index, assignment] of input.assignments.entries()) {
    if (agentIds.has(assignment.agentId)) {
      issues.push({
        path: ["assignments", index, "agentId"],
        issue: "Agent has more than one desktop assignment",
      });
    }
    if (displayIndices.has(assignment.displayIndex)) {
      issues.push({
        path: ["assignments", index, "displayIndex"],
        issue: "Display is assigned to more than one agent",
      });
    }
    agentIds.add(assignment.agentId);
    displayIndices.add(assignment.displayIndex);
  }
  return issues;
}));

const decodePersistedAssignments = Schema.decodeUnknownSync(PersistedDesktopAssignments);

/**
 * A display stays assigned to its Agent across turns. `ownerToken` is the
 * lease of the turn currently driving it and is null while the display idles
 * with its windows still open; `updatedAt` is the last lease change, which
 * the idle TTL counts from.
 */
export interface ComputerUseDesktopAssignment {
  readonly agentId: string;
  readonly displayIndex: number;
  readonly ownerToken: string | null;
  readonly updatedAt: string;
}

/** An assignment whose display is leased to a running turn. */
export type ComputerUseDesktopLease = ComputerUseDesktopAssignment & {
  readonly ownerToken: string;
};

export interface ComputerUseAssignmentStore {
  load(): Promise<readonly ComputerUseDesktopAssignment[]>;
  save(assignments: readonly ComputerUseDesktopAssignment[]): Promise<void>;
}

export interface ComputerUseWindowSupervisor {
  ensureWindow(assignment: ComputerUseDesktopAssignment): Promise<void>;
  stopWindow(assignment: ComputerUseDesktopAssignment): Promise<void>;
  /** Fold the display's browser logins into the shared store while its window keeps running. */
  captureWindowLogins?(assignment: ComputerUseDesktopAssignment): Promise<void>;
}

export class ComputerUseAssignmentStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ComputerUseAssignmentStoreError";
  }
}

export class ComputerUseDesktopUnavailableError extends Error {
  constructor() {
    super("No Computer Use desktop is available");
    this.name = "ComputerUseDesktopUnavailableError";
  }
}

export class ComputerUseDesktopOwnershipError extends Error {
  constructor() {
    super("Computer Use desktop ownership does not match");
    this.name = "ComputerUseDesktopOwnershipError";
  }
}

/** `BRIAR_COMPUTER_USE_IDLE_DISPLAY_TTL_HOURS` overrides how long idle displays are kept. */
export const configuredComputerUseIdleDisplayTtlMs = (
  environment: NodeJS.ProcessEnv = process.env,
): number => {
  const raw = environment.BRIAR_COMPUTER_USE_IDLE_DISPLAY_TTL_HOURS?.trim();
  if (!raw) return COMPUTER_USE_DEFAULT_IDLE_DISPLAY_TTL_MS;
  const hours = Number(raw);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new ComputerUseAssignmentStoreError(
      "BRIAR_COMPUTER_USE_IDLE_DISPLAY_TTL_HOURS must be a positive number of hours",
    );
  }
  return hours * 60 * 60 * 1000;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const configuredComputerUseAssignmentPath = (
  environment: NodeJS.ProcessEnv = process.env,
): string => {
  const path = environment.BRIAR_COMPUTER_USE_ASSIGNMENTS_FILE?.trim()
    || defaultComputerUseAssignmentPath;
  if (!isAbsolute(path)) {
    throw new ComputerUseAssignmentStoreError(
      "BRIAR_COMPUTER_USE_ASSIGNMENTS_FILE must be an absolute path",
    );
  }
  return path;
};

export class FileComputerUseAssignmentStore implements ComputerUseAssignmentStore {
  constructor(
    readonly path = configuredComputerUseAssignmentPath(),
  ) {
    if (!isAbsolute(path)) {
      throw new ComputerUseAssignmentStoreError(
        "Computer Use assignment path must be absolute",
      );
    }
  }

  async load(): Promise<readonly ComputerUseDesktopAssignment[]> {
    try {
      const metadata = await lstat(this.path);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new ComputerUseAssignmentStoreError(
          "Computer Use assignments must be a regular file",
        );
      }
      if ((metadata.mode & 0o077) !== 0) {
        throw new ComputerUseAssignmentStoreError(
          "Computer Use assignments must only be accessible to the service account",
        );
      }
      const parsed: unknown = JSON.parse(await readFile(this.path, "utf8"));
      return decodePersistedAssignments(parsed).assignments;
    } catch (error) {
      if (Predicate.hasProperty(error, "code") && error.code === "ENOENT") return [];
      if (error instanceof ComputerUseAssignmentStoreError) throw error;
      throw new ComputerUseAssignmentStoreError(
        "Computer Use assignments could not be loaded",
        { cause: error },
      );
    }
  }

  async save(assignments: readonly ComputerUseDesktopAssignment[]): Promise<void> {
    const value = decodePersistedAssignments({ version: 1, assignments });
    const directory = dirname(this.path);
    const temporaryPath = `${this.path}.${process.pid}.${randomUUID()}.tmp`;
    await mkdir(directory, { recursive: true, mode: 0o700 });
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(value)}\n`,
        { encoding: "utf8", flag: "wx", mode: 0o600 },
      );
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      throw new ComputerUseAssignmentStoreError(
        "Computer Use assignments could not be saved",
        { cause: error },
      );
    }
  }
}

export interface ComputerUseDesktopManagerOptions {
  readonly maxDisplayIndex?: number;
  readonly now?: () => string;
  readonly mintOwnerToken?: () => string;
  /** How long a display may idle between turns before it is torn down. */
  readonly idleTtlMs?: number;
  /** Agents whose displays are torn down on release instead of kept idle. */
  readonly transientAgentIds?: ReadonlySet<string>;
  readonly log?: (message: string) => void;
}

export class ComputerUseDesktopManager {
  private readonly assignments = new Map<string, ComputerUseDesktopAssignment>();
  private readonly displaysTearingDown = new Set<number>();
  private loaded = false;
  private mutation = Promise.resolve();
  private readonly maxDisplayIndex: number;
  private readonly now: () => string;
  private readonly mintOwnerToken: () => string;
  private readonly idleTtlMs: number;
  private readonly transientAgentIds: ReadonlySet<string>;
  private readonly log: (message: string) => void;

  constructor(
    private readonly store: ComputerUseAssignmentStore,
    private readonly supervisor: ComputerUseWindowSupervisor,
    options: ComputerUseDesktopManagerOptions = {},
  ) {
    this.maxDisplayIndex = options.maxDisplayIndex
      ?? COMPUTER_USE_DEFAULT_MAX_DISPLAY_INDEX;
    if (
      !Number.isInteger(this.maxDisplayIndex)
      || this.maxDisplayIndex < COMPUTER_USE_FIRST_AGENT_DISPLAY_INDEX
    ) {
      throw new ComputerUseDesktopUnavailableError();
    }
    this.now = options.now ?? (() => DateTime.formatIso(DateTime.nowUnsafe()));
    this.mintOwnerToken = options.mintOwnerToken ?? randomUUID;
    this.idleTtlMs = options.idleTtlMs ?? COMPUTER_USE_DEFAULT_IDLE_DISPLAY_TTL_MS;
    if (!Number.isFinite(this.idleTtlMs) || this.idleTtlMs <= 0) {
      throw new ComputerUseAssignmentStoreError("Computer Use idle display TTL must be positive");
    }
    this.transientAgentIds = options.transientAgentIds
      ?? new Set([COMPUTER_USE_CANARY_AGENT_ID]);
    this.log = options.log ?? (() => undefined);
  }

  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutation.then(operation, operation);
    this.mutation = result.then(() => undefined, () => undefined);
    return result;
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const persisted = await this.store.load();
    for (const assignment of persisted) {
      if (assignment.displayIndex > this.maxDisplayIndex) {
        throw new ComputerUseAssignmentStoreError(
          `Persisted display ${assignment.displayIndex} exceeds the configured maximum`,
        );
      }
      this.assignments.set(assignment.agentId, assignment);
    }
    this.loaded = true;
  }

  private save(): Promise<void> {
    return this.store.save(
      [...this.assignments.values()].sort((left, right) =>
        left.agentId.localeCompare(right.agentId)),
    );
  }

  private freeDisplayIndex(): number | undefined {
    const used = new Set(
      [...this.assignments.values()].map(({ displayIndex }) => displayIndex),
    );
    for (
      let displayIndex = COMPUTER_USE_FIRST_AGENT_DISPLAY_INDEX;
      displayIndex <= this.maxDisplayIndex;
      displayIndex += 1
    ) {
      if (!used.has(displayIndex) && !this.displaysTearingDown.has(displayIndex)) {
        return displayIndex;
      }
    }
    return undefined;
  }

  /**
   * Lease the Agent's display for a turn. A display the Agent already holds
   * is reused: a running lease is shared as is, an idle one gets a fresh
   * token. A new Agent takes a free display, or the longest-idle one when
   * every display is taken.
   */
  ensureAssignment(agentId: string): Promise<ComputerUseDesktopLease> {
    return this.runExclusive(async () => {
      await this.load();
      const normalizedAgentId = agentId.trim();
      if (normalizedAgentId.length === 0 || normalizedAgentId.length > 256) {
        throw new ComputerUseAssignmentStoreError("Computer Use agent ID is invalid");
      }
      const existing = this.assignments.get(normalizedAgentId);
      if (existing !== undefined) {
        if (existing.ownerToken !== null) {
          await this.supervisor.ensureWindow(existing);
          return { ...existing, ownerToken: existing.ownerToken };
        }
        const renewed = this.lease(existing);
        this.assignments.set(normalizedAgentId, renewed);
        await this.save();
        try {
          await this.supervisor.ensureWindow(renewed);
          return renewed;
        } catch (error) {
          this.assignments.set(normalizedAgentId, existing);
          await this.save();
          throw error;
        }
      }
      let displayIndex = this.freeDisplayIndex();
      if (displayIndex === undefined) {
        const evictable = this.longestIdle();
        if (evictable === undefined) throw new ComputerUseDesktopUnavailableError();
        await this.teardown(evictable);
        this.log(`display :${evictable.displayIndex} of ${evictable.agentId} was evicted for ${normalizedAgentId}`);
        displayIndex = this.freeDisplayIndex();
        if (displayIndex === undefined) throw new ComputerUseDesktopUnavailableError();
      }
      const assignment = this.lease({
        agentId: normalizedAgentId,
        displayIndex,
        ownerToken: null,
        updatedAt: this.now(),
      });
      this.assignments.set(normalizedAgentId, assignment);
      await this.save();
      try {
        await this.supervisor.ensureWindow(assignment);
        return assignment;
      } catch (error) {
        this.assignments.delete(normalizedAgentId);
        await this.save();
        throw error;
      }
    });
  }

  /** Recreate the windows of every kept assignment; expired idle ones are dropped instead. */
  restoreAssignments(): Promise<readonly ComputerUseDesktopAssignment[]> {
    return this.runExclusive(async () => {
      await this.load();
      await this.reapExpired();
      const assignments = [...this.assignments.values()];
      for (const assignment of assignments) {
        await this.supervisor.ensureWindow(assignment);
      }
      return assignments;
    });
  }

  /** Tear down displays that idled past the TTL. Returns what was torn down. */
  reapIdleAssignments(): Promise<readonly ComputerUseDesktopAssignment[]> {
    return this.runExclusive(async () => {
      await this.load();
      return this.reapExpired();
    });
  }

  private nowMs(): number {
    const parsed = Date.parse(this.now());
    return Number.isNaN(parsed) ? Date.now() : parsed;
  }

  private isExpired(assignment: ComputerUseDesktopAssignment, nowMs: number): boolean {
    return assignment.ownerToken === null
      && nowMs - Date.parse(assignment.updatedAt) >= this.idleTtlMs;
  }

  private longestIdle(): ComputerUseDesktopAssignment | undefined {
    let candidate: ComputerUseDesktopAssignment | undefined;
    for (const assignment of this.assignments.values()) {
      if (assignment.ownerToken !== null) continue;
      if (candidate === undefined || assignment.updatedAt < candidate.updatedAt) {
        candidate = assignment;
      }
    }
    return candidate;
  }

  private lease(assignment: ComputerUseDesktopAssignment): ComputerUseDesktopLease {
    const ownerToken = this.mintOwnerToken();
    if (!computerUseOwnerTokenPattern.test(ownerToken)) {
      throw new ComputerUseAssignmentStoreError("Computer Use owner token is invalid");
    }
    return { ...assignment, ownerToken, updatedAt: this.now() };
  }

  private async teardown(assignment: ComputerUseDesktopAssignment): Promise<void> {
    this.displaysTearingDown.add(assignment.displayIndex);
    try {
      await this.supervisor.stopWindow(assignment);
      this.assignments.delete(assignment.agentId);
      await this.save();
    } finally {
      this.displaysTearingDown.delete(assignment.displayIndex);
    }
  }

  /** A failed teardown keeps the assignment so the next sweep retries it. */
  private async reapExpired(): Promise<ComputerUseDesktopAssignment[]> {
    const nowMs = this.nowMs();
    const reaped: ComputerUseDesktopAssignment[] = [];
    for (const assignment of [...this.assignments.values()]) {
      if (!this.isExpired(assignment, nowMs)) continue;
      try {
        await this.teardown(assignment);
        reaped.push(assignment);
        this.log(`display :${assignment.displayIndex} of ${assignment.agentId} idled past the TTL and was torn down`);
      } catch (error) {
        this.log(`display :${assignment.displayIndex} teardown failed: ${describeError(error)}`);
      }
    }
    return reaped;
  }

  /**
   * End a turn's lease. The window and the browser on it stay up for the next
   * turn and for the owner's screen; only transient agents (the capability
   * canary) give the display back. A display that is already idle has
   * nothing to release, whatever token the late caller still holds.
   */
  private release(
    agentId: string,
    ownerToken?: string,
  ): Promise<void> {
    return this.runExclusive(async () => {
      await this.load();
      const assignment = this.assignments.get(agentId);
      if (assignment === undefined || assignment.ownerToken === null) return;
      if (ownerToken !== undefined && assignment.ownerToken !== ownerToken) {
        throw new ComputerUseDesktopOwnershipError();
      }
      if (this.transientAgentIds.has(agentId)) {
        await this.teardown(assignment);
        return;
      }
      try {
        await this.supervisor.captureWindowLogins?.(assignment);
      } catch (error) {
        this.log(`display :${assignment.displayIndex} login capture failed: ${describeError(error)}`);
      }
      this.assignments.set(agentId, {
        ...assignment,
        ownerToken: null,
        updatedAt: this.now(),
      });
      await this.save();
    });
  }

  releaseAssignment(agentId: string): Promise<void> {
    return this.release(agentId);
  }

  releaseOwnedAssignment(agentId: string, ownerToken: string): Promise<void> {
    return this.release(agentId, ownerToken);
  }

  assertOwnership(
    displayIndex: number,
    ownerToken: string,
  ): Promise<ComputerUseDesktopAssignment> {
    return this.runExclusive(async () => {
      await this.load();
      const assignment = [...this.assignments.values()].find(
        (candidate) => candidate.displayIndex === displayIndex,
      );
      if (assignment === undefined || assignment.ownerToken !== ownerToken) {
        throw new ComputerUseDesktopOwnershipError();
      }
      return assignment;
    });
  }

  snapshot(): Promise<readonly ComputerUseDesktopAssignment[]> {
    return this.runExclusive(async () => {
      await this.load();
      return [...this.assignments.values()];
    });
  }
}
