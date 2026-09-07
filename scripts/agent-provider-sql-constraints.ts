import { agentProviders } from "../apps/briar/src/lib/agent-provider";

/**
 * D1 stores the provider catalog as rows in `briar_agent_providers`, and every
 * provider column is a foreign key into it. These helpers read that catalog
 * back out of SQL, and find the `check (… in (…))` lists it replaced, so the
 * migration generator and the drift test work from the schema instead of a
 * hand-copied provider list.
 *
 * A surviving CHECK list is drift, not a second source of truth: it would
 * reject a provider the catalog already advertises, and no row inserted into
 * the lookup table could widen it.
 */
export type AgentProviderConstraint = {
  readonly table: string;
  readonly column: string;
  readonly providers: readonly string[];
  /** The `'codex', 'claude', …` text between the parentheses, verbatim. */
  readonly listText: string;
  /**
   * Where `listText` starts in the SQL it was read from. Two columns of one
   * table often spell the same list, so a caller that has to edit the clause
   * around a constraint cannot find it by searching for the text again.
   */
  readonly listIndex: number;
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
      listIndex: match.index + match[0].indexOf(list),
    });
  }
  return constraints;
}

const seedPattern =
  /\binsert\s+into\s+"?briar_agent_providers"?\s*\([^)]*\)\s*values\s*\(\s*'([a-z][a-z0-9_-]*)'/giu;

/**
 * The providers `sql` seeds into `briar_agent_providers`, in file order. Reads
 * migrations and the schema snapshot alike, since both spell the seed as one
 * `insert into … values (…)` per provider.
 */
export function seededAgentProviders(sql: string): string[] {
  return [...sql.matchAll(seedPattern)].map((match) => match[1]!);
}
