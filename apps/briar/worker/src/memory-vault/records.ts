import { MemoryVaultError } from "./errors";

/**
 * Record types and their paths (spec §5.1). Mirrored by the
 * `briar_memory_record_types` lookup table; a test keeps the two equal.
 */
export const RECORD_TYPES = {
  person: "entities/people/{id}.md",
  org: "entities/orgs/{id}.md",
  tool: "entities/tools/{id}.md",
  project: "entities/projects/{id}.md",
  infrastructure: "entities/infrastructure/{id}.md",
  comms: "comms/{id}.md",
  workstream: "workstreams/{id}.md",
  fact: "knowledge/facts/{id}.md",
  procedure: "knowledge/procedures/{id}.md",
  preference: "knowledge/preferences/{id}.md",
  decision: "knowledge/decisions/{id}.md",
  lesson: "knowledge/lessons/{id}.md",
  playbook: "playbook.md",
  "timeline-weekly": "timeline/weekly/{id}.md",
  "timeline-monthly": "timeline/monthly/{id}.md",
  "browser-guidance": "browser-guidance/attempts/{id}.md",
  "timeline-daily": "timeline/daily/{id}.md",
} as const;

export type RecordType = keyof typeof RECORD_TYPES;

export const WORKSTREAM_STATUSES = ["active", "completed", "someday"] as const;
export type WorkstreamStatus = (typeof WORKSTREAM_STATUSES)[number];

/** Legacy layout: listed, read and searched; saving moves the record to `workstreams/<id>.md`. */
export const LEGACY_WORKSTREAM_DIRECTORIES = ["active", "completed"] as const;

export const README_PATH = "README.md";
export const PLAYBOOK_ID = "playbook";
export const VOICE_ID = "voice";
export const VOICE_GUIDE_ID = "voice-guide";
export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_ALIASES = 10;
export const MAX_ALIAS_LENGTH = 60;

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

export const isRecordType = (value: string): value is RecordType =>
  Object.hasOwn(RECORD_TYPES, value);

export const isWorkstreamStatus = (value: string): value is WorkstreamStatus =>
  (WORKSTREAM_STATUSES as readonly string[]).includes(value);

const invalid = (message: string) => new MemoryVaultError("invalid_record", message);

export function isCalendarDate(value: string) {
  const match = DATE_PATTERN.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** ISO week ids such as `2026-w42`, checked against the year's real week count. */
function isIsoWeekId(value: string) {
  const match = /^(\d{4})-w(\d{2})$/u.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const week = Number(match[2]);
  // December 28th is always in the year's last ISO week.
  const dec28 = new Date(Date.UTC(year, 11, 28));
  const day = (dec28.getUTCDay() + 6) % 7;
  const thursday = new Date(dec28.getTime() + (3 - day) * 86_400_000);
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  const weekOneMonday = firstThursday.getTime() - firstDay * 86_400_000;
  const weeks = Math.round((thursday.getTime() - weekOneMonday) / (7 * 86_400_000)) + 1;
  return week >= 1 && week <= weeks;
}

export const isValidRecordId = (value: string) => ID_PATTERN.test(value);

/** Throws `invalid_record` unless `id` is valid for `type`. */
export function assertRecordId(type: RecordType, id: string) {
  if (!ID_PATTERN.test(id)) {
    throw invalid("Record ids are 1-63 lowercase letters, digits and hyphens, starting with a letter or digit");
  }
  if (id === "readme") throw new MemoryVaultError("readme_read_only", "README.md belongs to the application");
  if (type === "playbook" && id !== PLAYBOOK_ID) throw invalid("The playbook id is `playbook`");
  if (type !== "playbook" && id === PLAYBOOK_ID) throw invalid("The id `playbook` belongs to the playbook");
  if (type === "timeline-weekly" && !isIsoWeekId(id)) throw invalid("Weekly summary ids are ISO weeks such as 2026-w42");
  if (type === "timeline-monthly" && !/^\d{4}-(0[1-9]|1[0-2])$/u.test(id)) {
    throw invalid("Monthly summary ids are yyyy-mm");
  }
  if (type === "timeline-daily" && !isCalendarDate(id)) throw invalid("Daily ids are yyyy-mm-dd dates");
}

export const recordPath = (type: RecordType, id: string) => RECORD_TYPES[type].replace("{id}", id);

export type ParsedRecordPath = {
  readonly type: RecordType;
  readonly id: string;
  /** Set for `workstreams/active/<id>.md` and `workstreams/completed/<id>.md`. */
  readonly legacyStatus: WorkstreamStatus | null;
};

const PATH_PATTERNS: readonly { type: RecordType; pattern: RegExp }[] = Object.entries(RECORD_TYPES)
  .map(([type, template]) => {
    const escaped = template.replace(/[.*+?^$()|[\]\\]/gu, "\\$&").replace("{id}", "([a-z0-9][a-z0-9-]{0,62})");
    return { type: type as RecordType, pattern: new RegExp(`^${escaped}$`, "u") };
  });

/** The record a repository path belongs to, or null for paths outside the layout. */
export function parseRecordPath(path: string): ParsedRecordPath | null {
  if (path === "playbook.md") return { type: "playbook", id: PLAYBOOK_ID, legacyStatus: null };
  const legacy = /^workstreams\/(active|completed)\/([a-z0-9][a-z0-9-]{0,62})\.md$/u.exec(path);
  if (legacy) return { type: "workstream", id: legacy[2], legacyStatus: legacy[1] as WorkstreamStatus };
  for (const { type, pattern } of PATH_PATTERNS) {
    if (type === "playbook") continue;
    const match = pattern.exec(path);
    if (match) return { type, id: match[1], legacyStatus: null };
  }
  return null;
}

export const legacyWorkstreamPaths = (id: string) =>
  LEGACY_WORKSTREAM_DIRECTORIES.map((directory) => `workstreams/${directory}/${id}.md`);

export type RecordFrontmatter = {
  readonly id: string;
  readonly type: RecordType;
  readonly status: WorkstreamStatus | null;
  readonly aliases: readonly string[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};

/** `2026-10-13T12:40:50Z`: whole seconds, UTC. */
export const frontmatterTime = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/u, "Z");

export function renderRecordFile(frontmatter: RecordFrontmatter, body: string) {
  const lines = [
    "---",
    `id: ${frontmatter.id}`,
    `type: ${frontmatter.type}`,
    ...(frontmatter.status ? [`status: ${frontmatter.status}`] : []),
    ...(frontmatter.aliases.length ? [`aliases: [${frontmatter.aliases.join(", ")}]`] : []),
    `revision: ${frontmatter.revision}`,
    `created_at: ${frontmatter.createdAt}`,
    `updated_at: ${frontmatter.updatedAt}`,
    "---",
  ];
  return `${lines.join("\n")}\n${body}`;
}

export type ParsedRecordFile = {
  readonly frontmatter: RecordFrontmatter | null;
  readonly body: string;
  /** 1-based file line of the body's first line. */
  readonly bodyStartLine: number;
};

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n/u;

/**
 * Splits a repository file into generated frontmatter and body. A file without
 * valid generated frontmatter (a legacy or hand-made file) is all body; its
 * identity then comes from the path.
 */
export function parseRecordFile(path: string, content: string): ParsedRecordFile {
  const located = parseRecordPath(path);
  const match = FRONTMATTER_PATTERN.exec(content);
  if (!match || !located) return { frontmatter: null, body: content, bodyStartLine: 1 };
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const field = /^([a-z_]+):\s?(.*)$/u.exec(line);
    if (field) fields.set(field[1], field[2].trim());
  }
  const revision = Number(fields.get("revision"));
  const type = fields.get("type") ?? "";
  const status = fields.get("status") ?? null;
  const aliasText = fields.get("aliases");
  const aliases = aliasText && /^\[.*\]$/u.test(aliasText)
    ? aliasText.slice(1, -1).split(",").map((alias) => alias.trim()).filter(Boolean)
    : [];
  const createdAt = fields.get("created_at") ?? "";
  const updatedAt = fields.get("updated_at") ?? "";
  if (
    fields.get("id") !== located.id || !isRecordType(type) || type !== located.type ||
    !Number.isSafeInteger(revision) || revision < 1 || !createdAt || !updatedAt ||
    (status !== null && !isWorkstreamStatus(status))
  ) {
    return { frontmatter: null, body: content, bodyStartLine: 1 };
  }
  return {
    frontmatter: { id: located.id, type, status, aliases, revision, createdAt, updatedAt },
    body: content.slice(match[0].length),
    bodyStartLine: match[0].split("\n").length,
  };
}

/** Identity of a repository file, from frontmatter or (legacy) the path alone. */
export function describeRecordFile(path: string, content: string) {
  const located = parseRecordPath(path);
  if (!located) return null;
  const parsed = parseRecordFile(path, content);
  return {
    ...located,
    path,
    revision: parsed.frontmatter?.revision ?? 1,
    status: parsed.frontmatter?.status ?? located.legacyStatus,
    aliases: parsed.frontmatter?.aliases ?? [],
    createdAt: parsed.frontmatter?.createdAt ?? null,
    updatedAt: parsed.frontmatter?.updatedAt ?? null,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    bodyStartLine: parsed.bodyStartLine,
  };
}

export type RecordFileDescription = NonNullable<ReturnType<typeof describeRecordFile>>;

/** Normalizes an agent-supplied body and enforces the format-level rules (§5.2). */
export function normalizeRecordBody(content: string) {
  const body = content.replace(/\r\n?/gu, "\n");
  if (/^﻿?[ \t]*---[ \t]*\n/u.test(body)) {
    throw new MemoryVaultError(
      "frontmatter_not_allowed",
      "Supply only the body; the tool generates the frontmatter",
    );
  }
  const normalized = body.length === 0 || body.endsWith("\n") ? body : `${body}\n`;
  if (new TextEncoder().encode(normalized).byteLength > MAX_BODY_BYTES) {
    throw invalid("A record body is at most 64 KiB");
  }
  return normalized;
}

export function normalizeAliases(id: string, aliases: readonly string[]) {
  const unique = [...new Set(aliases.map((alias) => alias.trim()).filter(Boolean))];
  if (unique.length > MAX_ALIASES) throw invalid(`At most ${MAX_ALIASES} aliases`);
  for (const alias of unique) {
    // Aliases are the other names a record goes by ("커피", "Bay Area move"),
    // so any language is allowed; only what would break the generated
    // `aliases: [a, b]` line is refused.
    if (alias.length > MAX_ALIAS_LENGTH || /[,[\]\p{Cc}]/u.test(alias)) {
      throw invalid(`An alias is up to ${MAX_ALIAS_LENGTH} characters without commas, brackets or line breaks`);
    }
    if (alias.toLowerCase() === id) throw invalid("An alias cannot repeat the id");
  }
  return unique;
}

/** Whole-record checks that need no repository state. */
export function assertSavableRecord(input: {
  readonly type: RecordType;
  readonly id: string;
  readonly status: string | null;
}) {
  if (input.type === "timeline-daily") {
    throw invalid("Daily timeline files are written by `memory journal`, not `memory save`");
  }
  assertRecordId(input.type, input.id);
  if (input.type === "workstream") {
    if (!input.status || !isWorkstreamStatus(input.status)) {
      throw invalid("Workstreams need --status active, completed or someday");
    }
  } else if (input.status !== null) {
    throw invalid("Only workstreams have a status");
  }
}
