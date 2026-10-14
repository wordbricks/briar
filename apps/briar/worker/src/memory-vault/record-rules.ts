import { MemoryVaultError } from "./errors";
import { isCalendarDate } from "./records";

/**
 * Server-side checks for the records the README gives a shape to (spec §5.4),
 * so the rules hold even when a model drifts from them.
 */
const invalid = (message: string) => new MemoryVaultError("invalid_record", message);

export const PLAYBOOK_LIMIT = 4_000;
export const VOICE_LIMIT = 2_000;

const COUNT_DATE = String.raw`\((\d+)\s*(?:회|times?)\s*,\s*(\d{4}-\d{2}-\d{2})\)`;
const PLAYBOOK_LINE = new RegExp(String.raw`^- (\S.*?) → (\S.*?) ${COUNT_DATE} \[\[([a-z0-9][a-z0-9-]{0,62})\]\]$`, "u");
const VOICE_LINE = new RegExp(String.raw`^- (\S.*?) ${COUNT_DATE}$`, "u");
const USER_RULE_SUFFIX = /\(user, (\d{4}-\d{2}-\d{2})\)$/u;
const RETRACTION = /^Retracted (\d{4}-\d{2}-\d{2}): (\S.*)$/u;
/** A quoted span long enough to be someone's message rather than a word. */
const QUOTED_MESSAGE = /"[^"\n]{8,}"|“[^”\n]{8,}”|„[^“”\n]{8,}[“”]|「[^」\n]{4,}」|『[^』\n]{4,}』|«[^»\n]{8,}»/u;

const lines = (body: string) => body.replace(/\n$/u, "").split("\n");
const joined = (kept: readonly string[]) => (kept.length ? `${kept.join("\n")}\n` : "");

type RankedLine = { readonly text: string; readonly count: number; readonly date: string };

/**
 * Drops lines until the body fits: lowest count first, then oldest date; among
 * equals the later line goes first. Blank lines are kept. Returns the dropped
 * lines in the order they were dropped.
 */
function trimRanked(all: readonly string[], ranked: ReadonlyMap<number, RankedLine>, limit: number) {
  const kept = new Set(all.map((_, index) => index));
  const dropped: string[] = [];
  const size = () => joined(all.filter((_, index) => kept.has(index))).replace(/\n$/u, "").length;
  const order = [...ranked].sort(([leftIndex, left], [rightIndex, right]) =>
    left.count - right.count || left.date.localeCompare(right.date) || rightIndex - leftIndex);
  for (const [index, line] of order) {
    if (size() <= limit) break;
    kept.delete(index);
    dropped.push(line.text);
  }
  return { body: joined(all.filter((_, index) => kept.has(index))), dropped };
}

function rankedLines(body: string, pattern: RegExp, describe: string, countGroup: number, dateGroup: number) {
  const all = body.length ? lines(body) : [];
  const ranked = new Map<number, RankedLine>();
  all.forEach((text, index) => {
    if (!text.trim()) return;
    const match = pattern.exec(text);
    if (!match) throw invalid(`Every ${describe} line must read ${describe === "playbook"
      ? "\"- <when> → <do> (<n>회/times, <YYYY-MM-DD>) [[<lesson-id>]]\""
      : "\"- <trait> (<n>회/times, <YYYY-MM-DD>)\""}; this one does not: ${text.slice(0, 120)}`);
    const date = match[dateGroup];
    if (!isCalendarDate(date)) throw invalid(`Invalid date ${date} in the ${describe}`);
    ranked.set(index, { text, count: Number(match[countGroup]), date });
  });
  return { all, ranked };
}

export function applyPlaybookRules(body: string) {
  const { all, ranked } = rankedLines(body, PLAYBOOK_LINE, "playbook", 3, 4);
  return trimRanked(all, ranked, PLAYBOOK_LIMIT);
}

export function applyVoiceRules(body: string) {
  const { all, ranked } = rankedLines(body, VOICE_LINE, "voice", 2, 3);
  for (const line of ranked.values()) {
    if (QUOTED_MESSAGE.test(line.text)) {
      throw invalid("Voice lines describe a trait; they do not quote the person's messages");
    }
  }
  return trimRanked(all, ranked, VOICE_LIMIT);
}

/** `(user, …)` lines: rules the person stated. Kept verbatim unless the person changed them. */
export const voiceGuideUserLines = (body: string) =>
  (body.length ? lines(body) : []).filter((line) => USER_RULE_SUFFIX.test(line.trim())).map((line) => line.trim());

export function applyVoiceGuideRules(body: string, previous: string | null, userRequested: boolean) {
  for (const line of body.length ? lines(body) : []) {
    if (!line.trim()) continue;
    if (!/^- \S/u.test(line)) throw invalid("Every voice-guide line is a rule: \"- <rule>\"");
    const user = USER_RULE_SUFFIX.exec(line.trim());
    if (user && !isCalendarDate(user[1])) throw invalid(`Invalid date ${user[1]} in the voice guide`);
  }
  if (previous !== null && !userRequested) {
    const next = new Set(voiceGuideUserLines(body));
    const removed = voiceGuideUserLines(previous).filter((line) => !next.has(line));
    if (removed.length > 0) {
      throw new MemoryVaultError(
        "protected_record",
        "A rule the person stated (\"(user, …)\") changes only when they change or withdraw it; save with --user-requested on that turn",
      );
    }
  }
  return body;
}

export type LessonCheck = { readonly retraction: { readonly date: string; readonly why: string } | null };

const REQUIRED_LESSON_SECTIONS = ["situation", "what was done", "next time", "evidence", "confirmed"] as const;
const DATE_IN_TEXT = /\b\d{4}-\d{2}-\d{2}\b/gu;

export function checkLesson(body: string): LessonCheck {
  const all = body.length ? lines(body) : [];
  const first = all.find((line) => line.trim())?.trim() ?? "";
  const retraction = RETRACTION.exec(first);
  if (retraction) {
    if (!isCalendarDate(retraction[1])) throw invalid(`Invalid retraction date ${retraction[1]}`);
    return { retraction: { date: retraction[1], why: retraction[2].trim() } };
  }
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of all) {
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/u.exec(line);
    if (heading) {
      current = [];
      sections.set(heading[1].trim().toLowerCase().replace(/[:：]$/u, ""), current);
    } else {
      current?.push(line);
    }
  }
  const missing = REQUIRED_LESSON_SECTIONS.filter((name) => !sections.has(name));
  if (missing.length > 0) {
    throw invalid(`A lesson has the headings Situation, What was done, Next time, Evidence and Confirmed; missing: ${missing.join(", ")}`);
  }
  const evidence = sections.get("evidence")!.filter((line) => {
    if (!line.match(DATE_IN_TEXT)?.some(isCalendarDate)) return false;
    // A task id: any token other than the date that carries a digit (AH-123, #1849, a UUID, a run id).
    return line.replace(DATE_IN_TEXT, " ").split(/[\s,;()[\]|]+/u)
      .some((token) => /\d/u.test(token) && token.replace(/^#/u, "").length >= 1 && /^[#A-Za-z0-9][A-Za-z0-9_.:#/-]*$/u.test(token));
  });
  if (evidence.length === 0) throw invalid("Evidence lists at least one task id with its YYYY-MM-DD date");
  const confirmed = sections.get("confirmed")!.join("\n");
  const confirmedDates = (confirmed.match(DATE_IN_TEXT) ?? []).filter(isCalendarDate);
  if (confirmedDates.length === 0 || !/\d+/u.test(confirmed.replace(DATE_IN_TEXT, " "))) {
    throw invalid("Confirmed gives the count and the last date");
  }
  return { retraction: null };
}

/** Removes every playbook line that links `[[lessonId]]`. */
export function removePlaybookLinks(playbook: string, lessonId: string) {
  const link = `[[${lessonId}]]`;
  const all = playbook.length ? lines(playbook) : [];
  const removed = all.filter((line) => line.includes(link));
  return { body: joined(all.filter((line) => !line.includes(link))), removed };
}
