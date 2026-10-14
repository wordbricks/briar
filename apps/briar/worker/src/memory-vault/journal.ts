import { MemoryVaultError } from "./errors";
import { isValidRecordId } from "./records";

/**
 * Daily journal lines (spec §6): `- HH:MM | <text>` in UTC with ` [[id]]`
 * reference suffixes, filed under the UTC day the event occurred, kept in time
 * order without rewriting any existing line.
 */
export const JOURNAL_TEXT_LIMIT = 500;
export const JOURNAL_REFERENCE_LIMIT = 20;
export const JOURNAL_FUTURE_TOLERANCE_MS = 5 * 60_000;

const invalidRequest = (message: string) => new MemoryVaultError("invalid_request", message);

const OCCURRED_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/u;
const JOURNAL_TIME = /^- (\d{2}):(\d{2}) \|/u;

/** The event time: server now by default; an explicit time must carry its UTC offset. */
export function journalTime(occurredAt: string | undefined, now: Date): Date {
  if (occurredAt === undefined || occurredAt.trim() === "") return now;
  const value = occurredAt.trim();
  if (!OCCURRED_AT.test(value)) {
    throw invalidRequest("--occurred-at is an ISO 8601 time with its offset, e.g. 2026-10-13T21:40:00+09:00");
  }
  const time = new Date(value);
  if (Number.isNaN(time.getTime())) throw invalidRequest("--occurred-at is not a real time");
  if (time.getTime() - now.getTime() > JOURNAL_FUTURE_TOLERANCE_MS) {
    throw invalidRequest("--occurred-at is in the future; journal events after they happen");
  }
  return time;
}

export function normalizeJournalText(text: string) {
  const value = text.trim();
  if (!value) throw new MemoryVaultError("invalid_record", "Journal text is empty");
  if (/[\r\n]/u.test(value)) throw new MemoryVaultError("invalid_record", "A journal entry is a single line");
  if ([...value].length > JOURNAL_TEXT_LIMIT) {
    throw new MemoryVaultError("invalid_record", `A journal entry is at most ${JOURNAL_TEXT_LIMIT} characters`);
  }
  return value;
}

export function normalizeJournalReferences(references: readonly string[]) {
  const unique = [...new Set(references.map((reference) => reference.trim()).filter(Boolean))];
  if (unique.length > JOURNAL_REFERENCE_LIMIT) {
    throw new MemoryVaultError("invalid_record", `At most ${JOURNAL_REFERENCE_LIMIT} references`);
  }
  for (const reference of unique) {
    if (!isValidRecordId(reference) && reference !== "playbook") {
      throw new MemoryVaultError("invalid_record", `Reference ${reference.slice(0, 80)} is not a record id`);
    }
  }
  return unique;
}

export const journalDay = (time: Date) => time.toISOString().slice(0, 10);

export function journalLine(time: Date, text: string, references: readonly string[]) {
  const clock = time.toISOString().slice(11, 16);
  return `- ${clock} | ${text}${references.map((reference) => ` [[${reference}]]`).join("")}`;
}

/**
 * Inserts `line` after the last entry at or before its minute. Lines that are
 * not entries stay where they are; existing lines are never modified. Returns
 * `duplicate` when the identical line is already present.
 */
export function insertJournalLine(body: string, line: string) {
  const all = body.length ? body.replace(/\n$/u, "").split("\n") : [];
  if (all.includes(line)) return { body, duplicate: true as const };
  const minute = JOURNAL_TIME.exec(line)!;
  const key = `${minute[1]}:${minute[2]}`;
  let insertAt = all.length;
  for (let index = 0; index < all.length; index += 1) {
    const entry = JOURNAL_TIME.exec(all[index]);
    if (entry && `${entry[1]}:${entry[2]}` > key) {
      insertAt = index;
      break;
    }
  }
  const next = [...all.slice(0, insertAt), line, ...all.slice(insertAt)];
  return { body: `${next.join("\n")}\n`, duplicate: false as const };
}
