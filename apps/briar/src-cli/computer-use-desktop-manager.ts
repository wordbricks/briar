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

const rejectExcessProperties = { onExcessProperty: "error" } as const;
const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: rejectExcessProperties });

const PersistedDesktopAssignment = strict(Schema.Struct({
  agentId: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
  displayIndex: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(COMPUTER_USE_FIRST_AGENT_DISPLAY_INDEX),
  ),
  ownerToken: Schema.String.check(
    Schema.isPattern(computerUseOwnerTokenPattern),
    Schema.isMaxLength(128),
  ),
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

export interface ComputerUseDesktopAssignment {
  readonly agentId: string;
  readonly displayIndex: number;
  readonly ownerToken: string;
  readonly updatedAt: string;
}

export interface ComputerUseAssignmentStore {
  load(): Promise<readonly ComputerUseDesktopAssignment[]>;
  save(assignments: readonly ComputerUseDesktopAssignment[]): Promise<void>;
}

export interface ComputerUseWindowSupervisor {
  ensureWindow(assignment: ComputerUseDesktopAssignment): Promise<void>;
  stopWindow(assignment: ComputerUseDesktopAssignment): Promise<void>;
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
}

export class ComputerUseDesktopManager {
  private readonly assignments = new Map<string, ComputerUseDesktopAssignment>();
  private readonly displaysTearingDown = new Set<number>();
  private loaded = false;
  private mutation = Promise.resolve();
  private readonly maxDisplayIndex: number;
  private readonly now: () => string;
  private readonly mintOwnerToken: () => string;

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

  ensureAssignment(agentId: string): Promise<ComputerUseDesktopAssignment> {
    return this.runExclusive(async () => {
      await this.load();
      const normalizedAgentId = agentId.trim();
      if (normalizedAgentId.length === 0 || normalizedAgentId.length > 256) {
        throw new ComputerUseAssignmentStoreError("Computer Use agent ID is invalid");
      }
      const existing = this.assignments.get(normalizedAgentId);
      if (existing !== undefined) {
        await this.supervisor.ensureWindow(existing);
        return existing;
      }
      const displayIndex = this.freeDisplayIndex();
      if (displayIndex === undefined) throw new ComputerUseDesktopUnavailableError();
      const assignment: ComputerUseDesktopAssignment = {
        agentId: normalizedAgentId,
        displayIndex,
        ownerToken: this.mintOwnerToken(),
        updatedAt: this.now(),
      };
      if (!computerUseOwnerTokenPattern.test(assignment.ownerToken)) {
        throw new ComputerUseAssignmentStoreError("Computer Use owner token is invalid");
      }
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

  restoreAssignments(): Promise<readonly ComputerUseDesktopAssignment[]> {
    return this.runExclusive(async () => {
      await this.load();
      const assignments = [...this.assignments.values()];
      for (const assignment of assignments) {
        await this.supervisor.ensureWindow(assignment);
      }
      return assignments;
    });
  }

  private release(
    agentId: string,
    ownerToken?: string,
  ): Promise<void> {
    return this.runExclusive(async () => {
      await this.load();
      const assignment = this.assignments.get(agentId);
      if (assignment === undefined) return;
      if (ownerToken !== undefined && assignment.ownerToken !== ownerToken) {
        throw new ComputerUseDesktopOwnershipError();
      }
      this.displaysTearingDown.add(assignment.displayIndex);
      try {
        await this.supervisor.stopWindow(assignment);
        this.assignments.delete(agentId);
        await this.save();
      } finally {
        this.displaysTearingDown.delete(assignment.displayIndex);
      }
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
