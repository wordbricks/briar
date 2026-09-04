import { agentProviders } from "../apps/briar/src/lib/agent-provider";

/**
 * D1 stores a provider as text guarded by a `check (… in (…))` list, so the
 * persisted provider catalog is spread across every constrained column. These
 * helpers read those lists back out of SQL, which is what lets the migration
 * generator and the drift test work from the schema instead of a hand-copied
 * provider list.
 */
export type AgentProviderConstraint = {
  readonly table: string;
  readonly column: string;
  readonly providers: readonly string[];
  /** The `'codex', 'claude', …` text between the parentheses, verbatim. */
  readonly listText: string;
};

const tablePattern = /\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-z0-9_]+)"?/giu;
const constraintPattern =
  /\b([a-z0-9_]*provider)\s+in\s*\(\s*('[a-z][a-z0-9_-]*'(?:\s*,\s*'[a-z][a-z0-9_-]*')*)\s*\)/giu;

const catalogProviders = new Set<string>(agentProviders);

/**
 * Every agent-provider `in (…)` list in `sql`, in file order, attributed to the
 * table it was declared in. Lists that share no value with the platform catalog
 * belong to another column and are skipped.
 */
export function agentProviderConstraints(
  sql: string,
): AgentProviderConstraint[] {
  const tables: Array<{ index: number; name: string }> = [];
  for (const match of sql.matchAll(tablePattern)) {
    const name = match[1];
    if (name !== undefined) tables.push({ index: match.index, name });
  }

  const constraints: AgentProviderConstraint[] = [];
  for (const match of sql.matchAll(constraintPattern)) {
    const column = match[1];
    const list = match[2];
    if (column === undefined || list === undefined) continue;
    const providers = list
      .split(",")
      .map((value) => value.trim().slice(1, -1));
    if (!providers.some((provider) => catalogProviders.has(provider))) continue;
    // The worker tsconfig targets a lib without `Array.prototype.findLast`.
    let table: { index: number; name: string } | undefined;
    for (const candidate of tables) {
      if (candidate.index < match.index) table = candidate;
      else break;
    }
    constraints.push({
      table: table?.name ?? "(unknown table)",
      column,
      providers,
      listText: list,
    });
  }
  return constraints;
}

/**
 * The provider list a new provider must be appended to, taken from the schema
 * so its ordering matches the SQL text exactly. Throws when the schema and the
 * platform catalog disagree, which is the drift the generator must not paper
 * over.
 */
export function currentSqlProviderList(
  sql: string,
  expected: readonly string[],
): readonly string[] {
  const wanted = new Set(expected);
  const match = agentProviderConstraints(sql).find(({ providers }) =>
    providers.length === wanted.size &&
    providers.every((provider) => wanted.has(provider))
  );
  if (!match) {
    throw new Error(
      `No provider constraint lists exactly ${[...wanted].sort().join(", ")}.`,
    );
  }
  return match.providers;
}
