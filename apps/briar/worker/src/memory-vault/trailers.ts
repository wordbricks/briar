/**
 * Commit message trailers (spec §5.3). D1 can rebuild revisions and
 * idempotency rows from them after a lost update, so every vault commit
 * carries them. One `Briar-Record`/`Briar-Path`/`Briar-Revision` triple per
 * record the commit wrote or removed, in order.
 */
export type VaultOperation = "init" | "save" | "journal" | "forget" | "migrate";

export type TrailerRecord = {
  readonly recordId: string;
  readonly path: string;
  /** Revision written; 0 for a removal. */
  readonly revision: number;
};

export type VaultTrailers = {
  readonly vaultId: string;
  readonly operation: VaultOperation;
  readonly requestId: string | null;
  readonly payloadHash: string | null;
  readonly actor: string;
  readonly claim: string | null;
  readonly records: readonly TrailerRecord[];
  /** The journal line a `journal` (or retraction) commit appended. */
  readonly journalLine: string | null;
  /** `<legacy document id>@<version>` of a commit the D1 memory migration wrote (spec §11). */
  readonly legacy?: string | null;
};

const single = (value: string) => value.replace(/[\r\n]+/gu, " ").trim();

export function vaultCommitMessage(subject: string, trailers: VaultTrailers) {
  const lines = [
    `Briar-Vault: ${trailers.vaultId}`,
    `Briar-Operation: ${trailers.operation}`,
    ...(trailers.requestId ? [`Briar-Request: ${single(trailers.requestId)}`] : []),
    ...(trailers.payloadHash ? [`Briar-Payload: ${trailers.payloadHash}`] : []),
    `Briar-Actor: ${single(trailers.actor)}`,
    ...(trailers.claim ? [`Briar-Claim: ${single(trailers.claim)}`] : []),
    ...trailers.records.flatMap((record) => [
      `Briar-Record: ${record.recordId}`,
      `Briar-Path: ${record.path}`,
      `Briar-Revision: ${record.revision}`,
    ]),
    ...(trailers.journalLine ? [`Briar-Journal: ${single(trailers.journalLine)}`] : []),
    ...(trailers.legacy ? [`Briar-Legacy: ${single(trailers.legacy)}`] : []),
  ];
  return `${single(subject)}\n\n${lines.join("\n")}\n`;
}

const OPERATIONS = new Set<VaultOperation>(["init", "save", "journal", "forget", "migrate"]);

export function parseVaultCommitMessage(message: string): VaultTrailers | null {
  const values = new Map<string, string>();
  const records: TrailerRecord[] = [];
  let pending: { recordId: string; path?: string } | null = null;
  let journalLine: string | null = null;
  for (const line of message.split("\n")) {
    const match = /^(Briar-[A-Za-z]+): (.*)$/u.exec(line);
    if (!match) continue;
    const [, key, value] = match;
    if (key === "Briar-Record") {
      pending = { recordId: value };
    } else if (key === "Briar-Path" && pending) {
      pending.path = value;
    } else if (key === "Briar-Revision" && pending?.path !== undefined) {
      const revision = Number(value);
      if (Number.isSafeInteger(revision) && revision >= 0) {
        records.push({ recordId: pending.recordId, path: pending.path, revision });
      }
      pending = null;
    } else if (key === "Briar-Journal") {
      journalLine = value;
    } else {
      values.set(key, value);
    }
  }
  const vaultId = values.get("Briar-Vault");
  const operation = values.get("Briar-Operation") as VaultOperation | undefined;
  const actor = values.get("Briar-Actor");
  if (!vaultId || !operation || !OPERATIONS.has(operation) || !actor) return null;
  const legacy = values.get("Briar-Legacy");
  return {
    vaultId,
    operation,
    requestId: values.get("Briar-Request") ?? null,
    payloadHash: values.get("Briar-Payload") ?? null,
    actor,
    claim: values.get("Briar-Claim") ?? null,
    records,
    journalLine,
    ...(legacy ? { legacy } : {}),
  };
}

/**
 * Removes every trace of the forgotten records from a commit message for the
 * purge rewrite: their trailer triples, and a subject that names them.
 */
export function scrubVaultCommitMessage(message: string, forgotten: ReadonlySet<string>, forgottenPaths: ReadonlySet<string>) {
  const lines = message.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const record = /^Briar-Record: (.*)$/u.exec(lines[index]);
    const path = /^Briar-Path: (.*)$/u.exec(lines[index + 1] ?? "");
    if (record && path && (forgotten.has(record[1]) || forgottenPaths.has(path[1]))) {
      index += /^Briar-Revision: /u.test(lines[index + 2] ?? "") ? 2 : 1;
      continue;
    }
    kept.push(lines[index]);
  }
  const subject = kept[0] ?? "";
  // Record ids are [a-z0-9-] only, so they need no escaping inside a pattern.
  if ([...forgotten].some((id) => new RegExp(`(^|[^a-z0-9-])${id}([^a-z0-9-]|$)`, "u").test(subject))) {
    kept[0] = "memory: update";
  }
  return kept.join("\n");
}
