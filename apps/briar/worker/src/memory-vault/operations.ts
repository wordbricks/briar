import { sha256 } from "../crypto-digest";
import { MemoryVaultError } from "./errors";
import {
  VaultCommitNotFoundError,
  VaultRepoNotFoundError,
  VaultStoreUnavailableError,
  type VaultGitStore,
  type VaultSnapshot,
  type VaultWritePlan,
} from "./git-store";
import {
  insertJournalLine,
  journalDay,
  journalLine,
  journalTime,
  normalizeJournalReferences,
  normalizeJournalText,
} from "./journal";
import { MEMORY_VAULT_README } from "./readme";
import {
  applyPlaybookRules,
  applyVoiceGuideRules,
  applyVoiceRules,
  checkLesson,
  removePlaybookLinks,
} from "./record-rules";
import {
  PLAYBOOK_ID,
  README_PATH,
  VOICE_GUIDE_ID,
  VOICE_ID,
  assertSavableRecord,
  describeRecordFile,
  frontmatterTime,
  isRecordType,
  isWorkstreamStatus,
  legacyWorkstreamPaths,
  normalizeAliases,
  normalizeRecordBody,
  parseRecordPath,
  recordPath,
  renderRecordFile,
  type RecordFileDescription,
  type RecordType,
  type WorkstreamStatus,
} from "./records";
import {
  assertReadable,
  assertWritable,
  memoryVaultEnabled,
  resolveMemoryVaultScope,
  vaultAccess,
  vaultStatusLine,
  type MemoryVaultClaim,
  type MemoryVaultEnv,
  type MemoryVaultWorker,
  type ResolvedVaultScope,
  type VaultAccess,
} from "./scope";
import { assertNoSecrets } from "./secret-detector";
import { vaultCommitMessage, type TrailerRecord, type VaultOperation } from "./trailers";
import {
  ensureVaultRow,
  findRequest,
  findVault,
  getVault,
  reconcileVault,
  recordVaultCommit,
  storeRequestResult,
  type RecordUpsert,
  type RevisionInsert,
  type VaultKey,
  type VaultRecordRow,
  type VaultRow,
  type VaultScopeKind,
} from "./vault-repository";

export type MemoryVaultDeps = {
  readonly db: D1Database;
  readonly env: MemoryVaultEnv;
  /** Null when this deployment has no Artifacts binding. */
  readonly store: VaultGitStore | null;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly random?: () => number;
};

export type MemoryVaultCaller = {
  readonly claim: MemoryVaultClaim;
  readonly worker: MemoryVaultWorker;
};

export const MAX_WRITE_ATTEMPTS = 5;
const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;

const clock = (deps: Pick<MemoryVaultDeps, "now">) => deps.now?.() ?? new Date();
const isoNow = (deps: Pick<MemoryVaultDeps, "now">) => () => clock(deps).toISOString();
const unavailable = () =>
  new MemoryVaultError("memory_unavailable", "Memory storage is unavailable; continue without memory");

/** Maps Git host failures to `memory_unavailable` and logs them without credentials. */
export async function withStore<T>(context: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof VaultStoreUnavailableError || error instanceof VaultRepoNotFoundError) {
      console.error(JSON.stringify({ message: "memory vault storage failed", context, error: error.message }));
      throw unavailable();
    }
    throw error;
  }
}

export const requireStore = (deps: Pick<MemoryVaultDeps, "store">) => {
  if (!deps.store) throw unavailable();
  return deps.store;
};

type OpenedScope = { readonly scope: ResolvedVaultScope; readonly access: VaultAccess };

async function openScope(deps: MemoryVaultDeps, caller: MemoryVaultCaller): Promise<OpenedScope> {
  const scope = await resolveMemoryVaultScope(deps.db, {
    claim: caller.claim,
    worker: caller.worker,
    observedAt: clock(deps).toISOString(),
  });
  if (!memoryVaultEnabled(deps.env)) {
    throw new MemoryVaultError("memory_disabled", "Memory is not available in this deployment");
  }
  if (!scope) throw new MemoryVaultError("memory_disabled", "This run has no Agent, so it has no memory");
  return { scope, access: vaultAccess(deps.env, scope) };
}

/** The existing vault, synced with its repository, or null before the first write. */
async function readableVault(deps: MemoryVaultDeps, scope: ResolvedVaultScope) {
  const vault = await findVault(deps.db, scope.key);
  if (!vault) return null;
  const store = requireStore(deps);
  return withStore("sync", () => reconcileVault(deps.db, store, vault, isoNow(deps)));
}

function systemTrailers(vaultId: string, operation: VaultOperation) {
  return { vaultId, operation, requestId: null, payloadHash: null, actor: "system", claim: null, records: [], journalLine: null };
}

/** Creates the vault row and repository on first write, then syncs D1 with it. */
const writableVault = (deps: MemoryVaultDeps, scope: ResolvedVaultScope): Promise<VaultRow> =>
  openVaultForWrite(deps, {
    ...scope.key,
    ownerUserId: scope.dmSpace?.ownerUserId ?? null,
    dmSpaceId: scope.dmSpace?.id ?? null,
  });

/**
 * The vault for `key`, created (row, repository and its `README.md` commit) if
 * missing and synced with its repository. Also the entry point for writers
 * without a claim: the owner in the app and the legacy migration.
 */
export async function openVaultForWrite(
  deps: Pick<MemoryVaultDeps, "db" | "store" | "now">,
  key: VaultKey & { readonly ownerUserId: string | null; readonly dmSpaceId: string | null },
): Promise<VaultRow> {
  const store = requireStore(deps);
  const vault = await ensureVaultRow(deps.db, key, clock(deps).toISOString());
  if (vault.state === "purging") throw busy();
  return withStore("open", async () => {
    if (vault.head_commit === null) {
      await store.createRepo(vault.repo_name);
      // Never leave a repository without `main`; whoever loses this race just reads the winner's commit.
      await store.write(vault.repo_name, async (head) => head.commit
        ? { kind: "skip", value: null }
        : {
            kind: "commit",
            files: new Map([[README_PATH, MEMORY_VAULT_README]]),
            message: vaultCommitMessage("memory: initialize vault", systemTrailers(vault.id, "init")),
            timestamp: Math.floor(clock(deps).getTime() / 1000),
            value: null,
          });
    }
    const synced = await reconcileVault(deps.db, store, vault, isoNow(deps));
    if (synced.state === "purging") throw busy();
    return synced;
  });
}

export const busy = () => new MemoryVaultError("busy", "Memory is busy; retry shortly");

export type CommitPlanValue<T> = {
  readonly result: T;
  readonly records: readonly Omit<RecordUpsert, "commit">[];
  readonly revisions: readonly Omit<RevisionInsert, "commit">[];
};

type PlanOutcome<T> =
  | { readonly kind: "committed"; readonly base: string | null; readonly commit: string; readonly value: CommitPlanValue<T> }
  | { readonly kind: "skipped"; readonly head: string | null; readonly value: CommitPlanValue<T> };

/**
 * Runs `plan` against a fresh view of the head and pushes without force; a
 * non-fast-forward means another execution advanced `main`, so the whole check
 * re-runs on the new head (spec §5.3). Never writes from a stale clone.
 */
export async function commitWithRetry<T>(
  deps: Pick<MemoryVaultDeps, "store" | "sleep" | "random">,
  vault: VaultRow,
  plan: (head: VaultSnapshot) => Promise<VaultWritePlan<CommitPlanValue<T>>>,
): Promise<PlanOutcome<T>> {
  const store = requireStore(deps);
  const sleep = deps.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const random = deps.random ?? Math.random;
  for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
    let base: string | null = null;
    const outcome = await withStore("write", () => store.write(vault.repo_name, async (head) => {
      base = head.commit;
      return plan(head);
    }));
    if (outcome.kind === "committed") return { kind: "committed", base, commit: outcome.commit, value: outcome.value };
    if (outcome.kind === "skipped") return { kind: "skipped", head: outcome.head, value: outcome.value };
    if (attempt < MAX_WRITE_ATTEMPTS) await sleep(Math.round((50 + random() * 200) * attempt));
  }
  throw busy();
}

/** Applies a committed write to D1; on a lost race, replays the repository instead. */
export async function recordCommitted<T>(deps: Pick<MemoryVaultDeps, "db" | "store" | "now">, vault: VaultRow, outcome: Extract<PlanOutcome<T>, { kind: "committed" }>,
  request: { requestId: string; payloadHash: string; result: unknown }) {
  const now = clock(deps).toISOString();
  const withCommit = <R extends object>(row: R) => ({ ...row, commit: outcome.commit });
  const requestRow = { ...request, commit: outcome.commit, createdAt: now };
  const recorded = await recordVaultCommit(deps.db, vault, {
    base: outcome.base,
    commit: outcome.commit,
    now,
    changes: {
      records: outcome.value.records.map(withCommit),
      deletedRecords: [],
      revisions: outcome.value.revisions.map(withCommit),
      requests: [requestRow],
    },
  });
  if (recorded) return;
  await storeRequestResult(deps.db, vault.id, requestRow);
  const current = await getVault(deps.db, vault.id);
  if (current) await withStore("sync", () => reconcileVault(deps.db, requireStore(deps), current, isoNow(deps)));
}

/** Returns the stored result for a repeated request id, or throws on a different payload. */
export async function replayedResult<T>(deps: Pick<MemoryVaultDeps, "db">, vaultId: string, requestId: string, payloadHash: string): Promise<T | null> {
  const existing = await findRequest(deps.db, vaultId, requestId);
  if (!existing) return null;
  if (existing.payload_hash !== payloadHash) {
    throw new MemoryVaultError("idempotency_conflict", "This request id was already used for a different memory change");
  }
  return { ...JSON.parse(existing.result_json), replayed: true } as T;
}

const validRequestId = (requestId: string) => {
  if (!REQUEST_ID.test(requestId)) throw new MemoryVaultError("invalid_request", "A request id is required");
  return requestId;
};

/** User-requested DM writes turn recall on, as the first explicit save always has. */
async function noteUserRequestedWrite(deps: MemoryVaultDeps, scope: ResolvedVaultScope, userRequested: boolean) {
  if (!userRequested || !scope.dmSpace) return;
  await deps.db.prepare(`update briar_dm_memory_spaces
    set use_enabled = case when ever_saved = 0 then 1 else use_enabled end, ever_saved = 1, updated_at = ?
    where id = ? and status = 'active'`)
    .bind(clock(deps).toISOString(), scope.dmSpace.id).run();
}

/** Finds a record in a head tree by id: its canonical path first, then legacy workstream paths. */
export function locateRecord(files: ReadonlyMap<string, string>, id: string): RecordFileDescription | null {
  const candidates: RecordFileDescription[] = [];
  for (const [path, content] of files) {
    const located = parseRecordPath(path);
    if (located?.id !== id) continue;
    const described = describeRecordFile(path, content);
    if (described) candidates.push(described);
  }
  candidates.sort((left, right) => Number(left.legacyStatus !== null) - Number(right.legacyStatus !== null));
  return candidates[0] ?? null;
}

const actorOf = (scope: ResolvedVaultScope) => `agent:${scope.agentId}`;

// ---------------------------------------------------------------------------
// save

export type MemoryVaultSaveInput = {
  readonly requestId: string;
  readonly id: string;
  readonly type: string;
  readonly status: string | null;
  readonly aliases: readonly string[];
  readonly expectedRevision: number | null;
  readonly userRequested: boolean;
  readonly content: string;
};

export type MemoryVaultSaveResult = {
  readonly operation: "save";
  readonly id: string;
  readonly type: RecordType;
  readonly path: string;
  readonly revision: number;
  readonly commit: string;
  readonly droppedLines: readonly string[];
  readonly replayed: boolean;
};

export async function memoryVaultSave(deps: MemoryVaultDeps, caller: MemoryVaultCaller, input: MemoryVaultSaveInput): Promise<MemoryVaultSaveResult> {
  const requestId = validRequestId(input.requestId);
  if (/^readme(\.md)?$/iu.test(input.id) || input.id === README_PATH) {
    throw new MemoryVaultError("readme_read_only", "README.md belongs to the application");
  }
  if (!isRecordType(input.type)) throw new MemoryVaultError("invalid_record", `Unknown record type ${input.type.slice(0, 40)}`);
  const type = input.type;
  assertSavableRecord({ type, id: input.id, status: input.status });
  if (input.expectedRevision !== null && (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0)) {
    throw new MemoryVaultError("invalid_request", "--expected-revision is a revision number");
  }
  const aliases = normalizeAliases(input.id, input.aliases);
  const body = normalizeRecordBody(input.content);
  assertNoSecrets(body);
  const special = type === "playbook" ? "playbook"
    : type === "preference" && input.id === VOICE_ID ? "voice"
    : type === "preference" && input.id === VOICE_GUIDE_ID ? "voice-guide"
    : null;
  if (!special && !body.trim()) throw new MemoryVaultError("invalid_record", "The record body is empty");
  const lesson = type === "lesson" ? checkLesson(body) : null;
  const ruled = special === "playbook" ? applyPlaybookRules(body)
    : special === "voice" ? applyVoiceRules(body)
    : { body, dropped: [] as string[] };
  const status = input.status as WorkstreamStatus | null;
  const payloadHash = await sha256(JSON.stringify({
    operation: "save", id: input.id, type, status, aliases, expectedRevision: input.expectedRevision,
    userRequested: input.userRequested, body,
  }));

  const { scope, access } = await openScope(deps, caller);
  assertWritable(access, input.userRequested);
  if (scope.key.scopeKind !== "dm" && type === "person") {
    throw new MemoryVaultError("invalid_record", "Group and project memory keep the group's work, not personal profiles");
  }
  const vault = await writableVault(deps, scope);
  const replayed = await replayedResult<MemoryVaultSaveResult>(deps, vault.id, requestId, payloadHash);
  if (replayed) return replayed;
  const known = await deps.db.prepare(`select protected_by_user from briar_memory_vault_records
    where vault_id = ? and record_id = ? and deleted_at is null`)
    .bind(vault.id, input.id).first<{ protected_by_user: number }>();
  if (known?.protected_by_user === 1 && !input.userRequested) {
    throw new MemoryVaultError("protected_record", "The person wrote this record; change it only when they ask, with --user-requested");
  }
  const actor = actorOf(scope);

  const outcome = await commitWithRetry<MemoryVaultSaveResult>(deps, vault, async (head) => {
    const now = clock(deps);
    const timestamp = frontmatterTime(now);
    const files = new Map(head.files);
    const current = locateRecord(head.files, input.id);
    if (current && current.type !== type) {
      throw new MemoryVaultError("type_mismatch", `Record ${input.id} is a ${current.type}, not a ${type}`, {
        recordId: input.id, currentRevision: current.revision,
      });
    }
    const currentRevision = current?.revision ?? 0;
    if (current && input.expectedRevision === null) {
      throw new MemoryVaultError("expected_revision_required",
        `Record ${input.id} exists at revision ${currentRevision}; read it and pass --expected-revision`,
        { recordId: input.id, currentRevision });
    }
    if ((input.expectedRevision ?? 0) !== currentRevision) {
      throw new MemoryVaultError("revision_conflict",
        `Record ${input.id} is at revision ${currentRevision}; read it, merge, and save again`,
        { recordId: input.id, currentRevision, expectedRevision: input.expectedRevision ?? 0 });
    }
    const finalBody = special === "voice-guide"
      ? applyVoiceGuideRules(ruled.body, current?.body ?? null, input.userRequested)
      : ruled.body;
    const revision = currentRevision + 1;
    const path = recordPath(type, input.id);
    if (current && current.path !== path) files.delete(current.path);
    if (type === "workstream") for (const legacy of legacyWorkstreamPaths(input.id)) files.delete(legacy);
    const createdAt = current?.createdAt ?? timestamp;
    files.set(path, renderRecordFile({ id: input.id, type, status, aliases, revision, createdAt, updatedAt: timestamp }, finalBody));
    const trailerRecords: TrailerRecord[] = [{ recordId: input.id, path, revision }];
    const records: Omit<RecordUpsert, "commit">[] = [{
      recordId: input.id, type, path, status, aliases, revision, createdAt, updatedAt: timestamp, protectedByUser: null,
    }];
    const revisions: Omit<RevisionInsert, "commit">[] = [{ recordId: input.id, revision, path, actor, createdAt: timestamp }];
    let journal: string | null = null;
    if (lesson?.retraction) {
      // Retraction side effects land in the same commit (spec §5.4).
      const playbookPath = recordPath("playbook", PLAYBOOK_ID);
      const playbookContent = files.get(playbookPath);
      const playbook = playbookContent === undefined ? null : describeRecordFile(playbookPath, playbookContent);
      if (playbook) {
        const pruned = removePlaybookLinks(playbook.body, input.id);
        if (pruned.removed.length > 0) {
          const playbookRevision = playbook.revision + 1;
          const playbookCreated = playbook.createdAt ?? timestamp;
          files.set(playbookPath, renderRecordFile({ id: PLAYBOOK_ID, type: "playbook", status: null, aliases: playbook.aliases,
            revision: playbookRevision, createdAt: playbookCreated, updatedAt: timestamp }, pruned.body));
          trailerRecords.push({ recordId: PLAYBOOK_ID, path: playbookPath, revision: playbookRevision });
          records.push({ recordId: PLAYBOOK_ID, type: "playbook", path: playbookPath, status: null, aliases: playbook.aliases,
            revision: playbookRevision, createdAt: playbookCreated, updatedAt: timestamp, protectedByUser: null });
          revisions.push({ recordId: PLAYBOOK_ID, revision: playbookRevision, path: playbookPath, actor, createdAt: timestamp });
        }
      }
      const day = journalDay(now);
      const dailyPath = recordPath("timeline-daily", day);
      const dailyContent = files.get(dailyPath);
      const daily = dailyContent === undefined ? null : describeRecordFile(dailyPath, dailyContent);
      const line = journalLine(now, `Retracted lesson: ${lesson.retraction.why.replace(/\s+/gu, " ").slice(0, 400)}`, [input.id]);
      const inserted = insertJournalLine(daily?.body ?? "", line);
      if (!inserted.duplicate) {
        const dailyRevision = (daily?.revision ?? 0) + 1;
        const dailyCreated = daily?.createdAt ?? timestamp;
        files.set(dailyPath, renderRecordFile({ id: day, type: "timeline-daily", status: null, aliases: [],
          revision: dailyRevision, createdAt: dailyCreated, updatedAt: timestamp }, inserted.body));
        trailerRecords.push({ recordId: day, path: dailyPath, revision: dailyRevision });
        records.push({ recordId: day, type: "timeline-daily", path: dailyPath, status: null, aliases: [],
          revision: dailyRevision, createdAt: dailyCreated, updatedAt: timestamp, protectedByUser: null });
        revisions.push({ recordId: day, revision: dailyRevision, path: dailyPath, actor, createdAt: timestamp });
        journal = line;
      }
    }
    if (files.get(README_PATH) !== MEMORY_VAULT_README) files.set(README_PATH, MEMORY_VAULT_README);
    return {
      kind: "commit",
      files,
      message: vaultCommitMessage(`memory: save ${input.id} r${revision}`, {
        vaultId: vault.id, operation: "save", requestId, payloadHash, actor, claim: scope.workId,
        records: trailerRecords, journalLine: journal,
      }),
      timestamp: Math.floor(now.getTime() / 1000),
      value: {
        result: { operation: "save", id: input.id, type, path, revision, commit: "", droppedLines: ruled.dropped, replayed: false },
        records,
        revisions,
      },
    };
  });
  if (outcome.kind !== "committed") throw new Error("A save always commits");
  const result = { ...outcome.value.result, commit: outcome.commit };
  await recordCommitted(deps, vault, outcome, { requestId, payloadHash, result });
  await noteUserRequestedWrite(deps, scope, input.userRequested);
  return result;
}

// ---------------------------------------------------------------------------
// journal

export type MemoryVaultJournalInput = {
  readonly requestId: string;
  readonly text: string;
  readonly occurredAt: string | null;
  readonly references: readonly string[];
  readonly userRequested: boolean;
};

export type MemoryVaultJournalResult = {
  readonly operation: "journal";
  readonly id: string;
  readonly path: string;
  readonly line: string;
  readonly revision: number;
  readonly commit: string;
  readonly deduplicated: boolean;
  readonly replayed: boolean;
};

export async function memoryVaultJournal(deps: MemoryVaultDeps, caller: MemoryVaultCaller, input: MemoryVaultJournalInput): Promise<MemoryVaultJournalResult> {
  const requestId = validRequestId(input.requestId);
  const text = normalizeJournalText(input.text);
  const references = normalizeJournalReferences(input.references);
  assertNoSecrets(text);
  const time = journalTime(input.occurredAt ?? undefined, clock(deps));
  const line = journalLine(time, text, references);
  const day = journalDay(time);
  const path = recordPath("timeline-daily", day);
  // The request's own fields, not the server-timed line: a transport retry
  // without --occurred-at must hash the same as the original call.
  const payloadHash = await sha256(JSON.stringify({
    operation: "journal", text, occurredAt: input.occurredAt?.trim() || null, references,
    userRequested: input.userRequested,
  }));

  const { scope, access } = await openScope(deps, caller);
  assertWritable(access, input.userRequested);
  const vault = await writableVault(deps, scope);
  const replayed = await replayedResult<MemoryVaultJournalResult>(deps, vault.id, requestId, payloadHash);
  if (replayed) return replayed;
  const actor = actorOf(scope);

  const outcome = await commitWithRetry<MemoryVaultJournalResult>(deps, vault, async (head) => {
    const now = clock(deps);
    const timestamp = frontmatterTime(now);
    const content = head.files.get(path);
    const current = content === undefined ? null : describeRecordFile(path, content);
    const inserted = insertJournalLine(current?.body ?? "", line);
    const base = { operation: "journal" as const, id: day, path, line, replayed: false };
    if (inserted.duplicate) {
      return {
        kind: "skip",
        value: {
          result: { ...base, revision: current?.revision ?? 0, commit: head.commit ?? "", deduplicated: true },
          records: [],
          revisions: [],
        },
      };
    }
    const revision = (current?.revision ?? 0) + 1;
    const createdAt = current?.createdAt ?? timestamp;
    const files = new Map(head.files);
    files.set(path, renderRecordFile({ id: day, type: "timeline-daily", status: null, aliases: [], revision,
      createdAt, updatedAt: timestamp }, inserted.body));
    if (files.get(README_PATH) !== MEMORY_VAULT_README) files.set(README_PATH, MEMORY_VAULT_README);
    return {
      kind: "commit",
      files,
      message: vaultCommitMessage(`memory: journal ${day}`, {
        vaultId: vault.id, operation: "journal", requestId, payloadHash, actor, claim: scope.workId,
        records: [{ recordId: day, path, revision }], journalLine: line,
      }),
      timestamp: Math.floor(now.getTime() / 1000),
      value: {
        result: { ...base, revision, commit: "", deduplicated: false },
        records: [{ recordId: day, type: "timeline-daily", path, status: null, aliases: [], revision, createdAt,
          updatedAt: timestamp, protectedByUser: null }],
        revisions: [{ recordId: day, revision, path, actor, createdAt: timestamp }],
      },
    };
  });
  if (outcome.kind === "skipped") {
    const result = outcome.value.result;
    await storeRequestResult(deps.db, vault.id, { requestId, payloadHash, commit: outcome.head, result, createdAt: clock(deps).toISOString() });
    await noteUserRequestedWrite(deps, scope, input.userRequested);
    return result;
  }
  const result = { ...outcome.value.result, commit: outcome.commit };
  await recordCommitted(deps, vault, outcome, { requestId, payloadHash, result });
  await noteUserRequestedWrite(deps, scope, input.userRequested);
  return result;
}

// ---------------------------------------------------------------------------
// read

export type MemoryVaultRecordSummary = {
  readonly id: string;
  readonly type: RecordType | "readme";
  readonly path: string;
  readonly status: string | null;
  readonly aliases: readonly string[];
  readonly revision: number;
  readonly updatedAt: string | null;
  readonly protectedByUser: boolean;
};

export type MemoryVaultReadResult = MemoryVaultRecordSummary & {
  readonly createdAt: string | null;
  readonly body: string;
  readonly latest: boolean;
  readonly commit: string | null;
};

const README_SUMMARY: MemoryVaultRecordSummary = {
  id: "readme", type: "readme", path: README_PATH, status: null, aliases: [], revision: 0, updatedAt: null, protectedByUser: true,
};

const isReadmeTarget = (target: string) => /^readme(\.md)?$/iu.test(target.trim());

const summaryOf = (row: VaultRecordRow): MemoryVaultRecordSummary => ({
  id: row.record_id,
  type: row.record_type,
  path: row.path,
  status: row.status,
  aliases: JSON.parse(row.aliases_json) as string[],
  revision: row.revision,
  updatedAt: row.updated_at,
  protectedByUser: row.protected_by_user === 1,
});

export async function memoryVaultRead(deps: MemoryVaultDeps, caller: MemoryVaultCaller, input: {
  readonly target: string;
  readonly revision: number | null;
}): Promise<MemoryVaultReadResult> {
  const { scope, access } = await openScope(deps, caller);
  if (isReadmeTarget(input.target)) {
    // The README is always available to a run that has a vault, recall or not.
    return { ...README_SUMMARY, createdAt: null, body: MEMORY_VAULT_README, latest: true, commit: null };
  }
  assertReadable(access);
  if (input.revision !== null && (!Number.isSafeInteger(input.revision) || input.revision < 1)) {
    throw new MemoryVaultError("invalid_request", "--revision is a positive revision number");
  }
  const target = input.target.trim();
  const vault = await readableVault(deps, scope);
  const notFound = () => new MemoryVaultError("not_found", `No memory record ${target.slice(0, 120)}`);
  if (!vault?.head_commit) throw notFound();
  const byPath = target.includes("/") || target.endsWith(".md");
  const row = await deps.db.prepare(`select * from briar_memory_vault_records
    where vault_id = ? and deleted_at is null and ${byPath ? "path" : "record_id"} = ?`)
    .bind(vault.id, target).first<VaultRecordRow>();
  if (!row) throw notFound();
  let commit = vault.head_commit;
  let path = row.path;
  const revision = input.revision ?? row.revision;
  if (revision !== row.revision) {
    const old = await deps.db.prepare(`select commit_sha, path from briar_memory_vault_revisions
      where vault_id = ? and record_id = ? and revision = ?`)
      .bind(vault.id, row.record_id, revision).first<{ commit_sha: string; path: string }>();
    if (!old) throw new MemoryVaultError("not_found", `Record ${row.record_id} has no revision ${revision}`);
    commit = old.commit_sha;
    path = old.path;
  }
  const store = requireStore(deps);
  const content = await withStore("read", async () => {
    try {
      return await store.readFile(vault.repo_name, commit, path);
    } catch (error) {
      if (error instanceof VaultCommitNotFoundError) return null;
      throw error;
    }
  });
  if (content === null) throw notFound();
  const described = describeRecordFile(path, content);
  if (!described) throw notFound();
  await deps.db.prepare(`insert into briar_memory_vault_claim_reads
      (claim_token_hash, vault_id, record_id, revision, work_id, read_at)
    values (?, ?, ?, ?, ?, ?) on conflict do nothing`)
    .bind(scope.claimTokenHash, vault.id, row.record_id, revision, scope.workId, clock(deps).toISOString())
    .run();
  return {
    id: row.record_id,
    type: described.type,
    path,
    status: described.status,
    aliases: described.aliases,
    revision,
    createdAt: described.createdAt,
    updatedAt: described.updatedAt,
    protectedByUser: row.protected_by_user === 1,
    body: described.body,
    latest: revision === row.revision,
    commit,
  };
}

// ---------------------------------------------------------------------------
// list

const encodeCursor = (value: unknown) =>
  btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");

function decodeCursor<T>(cursor: string, valid: (value: unknown) => value is T): T {
  try {
    const padded = cursor.replaceAll("-", "+").replaceAll("_", "/");
    const value: unknown = JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4)));
    if (valid(value)) return value;
  } catch {
    // Fall through to the error below.
  }
  throw new MemoryVaultError("invalid_request", "The cursor is not valid for this request");
}

const limitOf = (limit: number | null, fallback: number, maximum: number) => {
  if (limit === null) return fallback;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximum) {
    throw new MemoryVaultError("invalid_request", `--limit is between 1 and ${maximum}`);
  }
  return limit;
};

const filterType = (type: string | null) => {
  if (type === null) return null;
  if (!isRecordType(type) && type !== "readme") throw new MemoryVaultError("invalid_request", `Unknown record type ${type.slice(0, 40)}`);
  return type;
};

export type MemoryVaultListResult = {
  readonly records: readonly MemoryVaultRecordSummary[];
  readonly nextCursor: string | null;
};

export async function memoryVaultList(deps: MemoryVaultDeps, caller: MemoryVaultCaller, input: {
  readonly type: string | null;
  readonly prefix: string | null;
  readonly status: string | null;
  readonly cursor: string | null;
  readonly limit: number | null;
}): Promise<MemoryVaultListResult> {
  const { scope, access } = await openScope(deps, caller);
  assertReadable(access);
  const limit = limitOf(input.limit, 50, 200);
  const type = filterType(input.type);
  if (input.status !== null && !isWorkstreamStatus(input.status)) {
    throw new MemoryVaultError("invalid_request", "--status is active, completed or someday");
  }
  const prefix = input.prefix ?? "";
  if (prefix.length > 200) throw new MemoryVaultError("invalid_request", "--prefix is too long");
  type ListCursor = { u: string; i: string };
  const cursor = input.cursor === null ? null : decodeCursor<ListCursor>(input.cursor, (value): value is ListCursor =>
    typeof value === "object" && value !== null && "u" in value && "i" in value &&
    typeof value.u === "string" && typeof value.i === "string");
  const readme = !cursor && (type === null || type === "readme") && input.status === null && README_PATH.startsWith(prefix)
    ? [README_SUMMARY]
    : [];
  const vault = await readableVault(deps, scope);
  if (!vault || type === "readme") return { records: readme, nextCursor: null };
  const rows = (await deps.db.prepare(`select * from briar_memory_vault_records
    where vault_id = ? and deleted_at is null
      and (? is null or record_type = ?) and (? is null or status = ?)
      and substr(path, 1, length(?)) = ?
      and (? is null or updated_at < ? or (updated_at = ? and record_id < ?))
    order by updated_at desc, record_id desc limit ?`)
    .bind(vault.id, type, type, input.status, input.status, prefix, prefix,
      cursor?.u ?? null, cursor?.u ?? null, cursor?.u ?? null, cursor?.i ?? null, limit + 1)
    .all<VaultRecordRow>()).results;
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    records: [...readme, ...page.map(summaryOf)],
    nextCursor: rows.length > limit && last ? encodeCursor({ u: last.updated_at, i: last.record_id }) : null,
  };
}

// ---------------------------------------------------------------------------
// search

export type MemoryVaultSearchHit = {
  readonly id: string;
  readonly type: RecordType;
  readonly path: string;
  readonly revision: number;
  readonly line: number;
  readonly snippet: string;
};

export type MemoryVaultSearchResult = {
  readonly hits: readonly MemoryVaultSearchHit[];
  readonly nextCursor: string | null;
  readonly commit: string | null;
};

const SNIPPET_LIMIT = 240;

function snippetOf(line: string, index: number) {
  const trimmed = line.trim();
  if (trimmed.length <= SNIPPET_LIMIT) return trimmed;
  const start = Math.max(0, Math.min(index - 80, line.length - SNIPPET_LIMIT));
  const end = start + SNIPPET_LIMIT;
  return `${start > 0 ? "…" : ""}${line.slice(start, end)}${end < line.length ? "…" : ""}`;
}

export async function memoryVaultSearch(deps: MemoryVaultDeps, caller: MemoryVaultCaller, input: {
  readonly text: string;
  readonly type: string | null;
  readonly prefix: string | null;
  readonly cursor: string | null;
  readonly limit: number | null;
}): Promise<MemoryVaultSearchResult> {
  const { scope, access } = await openScope(deps, caller);
  assertReadable(access);
  const text = input.text.trim();
  if (!text || text.length > 200) throw new MemoryVaultError("invalid_request", "Search text is 1-200 characters");
  const limit = limitOf(input.limit, 10, 50);
  const type = filterType(input.type);
  const prefix = input.prefix ?? "";
  const queryHash = (await sha256(JSON.stringify({ text, type, prefix }))).slice(0, 16);
  type SearchCursor = { c: string; o: number; h: string };
  const cursor = input.cursor === null ? null : decodeCursor<SearchCursor>(input.cursor, (value): value is SearchCursor =>
    typeof value === "object" && value !== null && "c" in value && "o" in value && "h" in value &&
    typeof value.c === "string" && /^[0-9a-f]{40}$/u.test(value.c) && Number.isSafeInteger(value.o) &&
    (value.o as number) >= 0 && value.h === queryHash);
  const vault = await readableVault(deps, scope);
  if (!vault?.head_commit || type === "readme") return { hits: [], nextCursor: null, commit: vault?.head_commit ?? null };
  const commit = cursor?.c ?? vault.head_commit;
  const store = requireStore(deps);
  const snapshot = await withStore("search", async () => {
    try {
      return await store.snapshot(vault.repo_name, commit);
    } catch (error) {
      if (error instanceof VaultCommitNotFoundError) {
        throw new MemoryVaultError("invalid_request", "The search cursor expired; search again");
      }
      throw error;
    }
  });
  const needle = text.toLowerCase();
  const hits: MemoryVaultSearchHit[] = [];
  for (const path of [...snapshot.files.keys()].sort()) {
    if (path === README_PATH || !path.endsWith(".md") || !path.startsWith(prefix)) continue;
    const content = snapshot.files.get(path)!;
    const described = describeRecordFile(path, content);
    if (!described || (type !== null && described.type !== type)) continue;
    // A record is also found by its aliases, the other names it goes by.
    const aliasAt = described.aliases.findIndex((alias) => alias.toLowerCase().includes(needle));
    if (aliasAt >= 0) {
      const aliasLine = content.split("\n").findIndex((line) => line.startsWith("aliases: ["));
      hits.push({
        id: described.id,
        type: described.type,
        path,
        revision: described.revision,
        line: aliasLine + 1,
        snippet: snippetOf(`aliases: [${described.aliases.join(", ")}]`, 0),
      });
    }
    described.body.replace(/\n$/u, "").split("\n").forEach((line, index) => {
      const at = line.toLowerCase().indexOf(needle);
      if (at < 0) return;
      hits.push({
        id: described.id,
        type: described.type,
        path,
        revision: described.revision,
        line: described.bodyStartLine + index,
        snippet: snippetOf(line, at),
      });
    });
  }
  const offset = cursor?.o ?? 0;
  const page = hits.slice(offset, offset + limit);
  const next = offset + limit < hits.length ? encodeCursor({ c: commit, o: offset + limit, h: queryHash }) : null;
  return { hits: page, nextCursor: next, commit };
}

// ---------------------------------------------------------------------------
// context (spec §7)

export type MemoryVaultContextResult =
  | { readonly kind: "none" }
  | { readonly kind: "unchanged"; readonly contextKey: string }
  | {
      readonly kind: "context";
      readonly contextKey: string;
      readonly head: string | null;
      readonly scopeKind: VaultScopeKind;
      readonly readme: string;
      readonly status: string;
      readonly voice: string;
      readonly voiceGuide: string;
      readonly playbook: string;
      readonly readable: boolean;
      readonly writable: boolean;
      readonly userRequestedWritable: boolean;
    };

const contextKeyOf = (head: string | null, scopeKind: VaultScopeKind, access: VaultAccess) =>
  `${head ?? "empty"}:${scopeKind}:${access.readable ? "r" : "-"}${access.writable ? "w" : "-"}${access.userRequestedWritable ? "u" : "-"}`;

/**
 * What the Worker CLI injects before each provider turn. An unchanged head and
 * unchanged permissions answer `unchanged` from D1 alone, with no Artifacts
 * read. The key covers permissions as well as the head, so turning recall off
 * takes effect on the next turn even though the repository did not change.
 */
export async function getMemoryVaultContext(deps: MemoryVaultDeps, caller: MemoryVaultCaller, input: {
  readonly knownContextKey: string | null;
}): Promise<MemoryVaultContextResult> {
  const scope = await resolveMemoryVaultScope(deps.db, {
    claim: caller.claim,
    worker: caller.worker,
    observedAt: clock(deps).toISOString(),
  });
  if (!scope || !memoryVaultEnabled(deps.env)) return { kind: "none" };
  const access = vaultAccess(deps.env, scope);
  let vault = await findVault(deps.db, scope.key);
  const known = contextKeyOf(vault?.head_commit ?? null, scope.key.scopeKind, access);
  if (input.knownContextKey === known) return { kind: "unchanged", contextKey: known };
  const bodies = { voice: "", voiceGuide: "", playbook: "" };
  if (vault && access.readable && deps.store) {
    const store = deps.store;
    const synced = vault;
    vault = await withStore("context", async () => {
      const current = await reconcileVault(deps.db, store, synced, isoNow(deps));
      if (!current.head_commit) return current;
      const head = current.head_commit;
      const read = async (type: RecordType, id: string) => {
        const content = await store.readFile(current.repo_name, head, recordPath(type, id));
        return content === null ? "" : describeRecordFile(recordPath(type, id), content)?.body ?? "";
      };
      const rows = (await deps.db.prepare(`select record_id from briar_memory_vault_records
        where vault_id = ? and deleted_at is null and record_id in (?, ?, ?)`)
        .bind(current.id, VOICE_ID, VOICE_GUIDE_ID, PLAYBOOK_ID).all<{ record_id: string }>()).results;
      const present = new Set(rows.map((row) => row.record_id));
      if (present.has(VOICE_ID)) bodies.voice = await read("preference", VOICE_ID);
      if (present.has(VOICE_GUIDE_ID)) bodies.voiceGuide = await read("preference", VOICE_GUIDE_ID);
      if (present.has(PLAYBOOK_ID)) bodies.playbook = await read("playbook", PLAYBOOK_ID);
      return current;
    });
  }
  const head = vault?.head_commit ?? null;
  return {
    kind: "context",
    contextKey: contextKeyOf(head, scope.key.scopeKind, access),
    head,
    scopeKind: scope.key.scopeKind,
    readme: MEMORY_VAULT_README,
    status: vaultStatusLine(scope.key.scopeKind, access),
    ...bodies,
    readable: access.readable,
    writable: access.writable,
    userRequestedWritable: access.userRequestedWritable,
  };
}

// ---------------------------------------------------------------------------
// citations (spec §8)

export type MemoryVaultCitation = { readonly documentId: string; readonly version: number };

/**
 * Splits a completion's memory citations into those this claim read at the
 * record's current, undeleted revision and the rest. Completion keeps only
 * `accepted`.
 */
export async function validateMemoryVaultCitations(db: D1Database, input: {
  readonly claimTokenHash: string;
  readonly citations: readonly MemoryVaultCitation[];
}) {
  const accepted: MemoryVaultCitation[] = [];
  const rejected: MemoryVaultCitation[] = [];
  for (const citation of input.citations) {
    const valid = await db.prepare(`select 1 from briar_memory_vault_claim_reads claim_read
      join briar_memory_vault_records record on record.vault_id = claim_read.vault_id
        and record.record_id = claim_read.record_id
      where claim_read.claim_token_hash = ? and claim_read.record_id = ? and claim_read.revision = ?
        and record.revision = claim_read.revision and record.deleted_at is null`)
      .bind(input.claimTokenHash, citation.documentId, citation.version).first();
    (valid ? accepted : rejected).push(citation);
  }
  return { accepted, rejected };
}
