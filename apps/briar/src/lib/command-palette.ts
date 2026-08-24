export type CommandPaletteScope =
  | "actions"
  | "channels"
  | "direct-messages"
  | "issues"
  | "navigation"
  | "projects"
  | "sessions";

export type CommandPaletteSearchItem = {
  id: string;
  description?: string;
  keywords?: readonly string[];
  label: string;
  priority?: number;
  scope: CommandPaletteScope;
  section: string;
  sectionLabel: string;
};

export type CommandPaletteSearchGroup<
  Item extends CommandPaletteSearchItem = CommandPaletteSearchItem,
> = {
  items: Item[];
  section: string;
  sectionLabel: string;
};

type RankedItem<Item extends CommandPaletteSearchItem> = {
  index: number;
  item: Item;
  score: number;
};

const scopePrefixes: Partial<Record<string, CommandPaletteScope>> = {
  a: "actions",
  c: "channels",
  d: "direct-messages",
  i: "issues",
  n: "navigation",
  p: "projects",
  s: "sessions",
};

export const commandPaletteRecentsStorageKey =
  "briar.command-palette.recents.v1";
export const commandPaletteRecentLimit = 8;

export function normalizeCommandPaletteText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase()
    .trim();
}

export function parseCommandPaletteQuery(query: string): {
  query: string;
  scope: CommandPaletteScope | null;
} {
  const normalizedWithSeparator = query
    .normalize("NFKD")
    .replace(/\p{Mark}+/gu, "")
    .toLocaleLowerCase()
    .trimStart();
  const match = normalizedWithSeparator.match(
    /^([acdinps]):(.*)$/u,
  );
  if (!match) {
    return { query: normalizeCommandPaletteText(query), scope: null };
  }
  return {
    query: match[2]?.trim() ?? "",
    scope: scopePrefixes[match[1]!] ?? null,
  };
}

function subsequenceScore(candidate: string, token: string): number | null {
  if (token.length < 2) return null;
  let tokenIndex = 0;
  let firstMatch = -1;
  let lastMatch = -1;

  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== token[tokenIndex]) continue;
    if (firstMatch < 0) firstMatch = index;
    lastMatch = index;
    tokenIndex += 1;
    if (tokenIndex === token.length) break;
  }

  if (tokenIndex !== token.length) return null;
  const spread = lastMatch - firstMatch + 1;
  return Math.max(25, 180 - firstMatch * 2 - (spread - token.length) * 4);
}

function tokenScore(candidate: string, token: string): number | null {
  if (!candidate || !token) return null;
  if (candidate === token) return 1_200;
  if (candidate.startsWith(token)) return 900 - Math.min(candidate.length, 100);

  const wordIndex = candidate.search(
    new RegExp(`(^|[\\s/_-])${escapeRegExp(token)}`, "u"),
  );
  if (wordIndex >= 0) return 700 - Math.min(wordIndex, 100);

  const substringIndex = candidate.indexOf(token);
  if (substringIndex >= 0) return 500 - Math.min(substringIndex, 100);
  return subsequenceScore(candidate, token);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function scoreItem(
  item: CommandPaletteSearchItem,
  query: string,
): number | null {
  if (!query) return item.priority ?? 0;

  const label = normalizeCommandPaletteText(item.label);
  const candidates = [
    label,
    item.description,
    ...(item.keywords ?? []),
  ]
    .filter((value): value is string => Boolean(value))
    .map(normalizeCommandPaletteText);
  const tokens = query.split(/\s+/u).filter(Boolean);
  let score = label === query ? 2_000 : label.startsWith(query) ? 1_000 : 0;

  for (const token of tokens) {
    let best: number | null = null;
    for (const candidate of candidates) {
      const candidateScore = tokenScore(candidate, token);
      if (candidateScore !== null && (best === null || candidateScore > best)) {
        best = candidateScore;
      }
    }
    if (best === null) return null;
    score += best;
  }

  return score + (item.priority ?? 0);
}

export function groupCommandPaletteItems<
  Item extends CommandPaletteSearchItem,
>(items: readonly Item[], rawQuery: string): CommandPaletteSearchGroup<Item>[] {
  const parsed = parseCommandPaletteQuery(rawQuery);
  const ranked = items.flatMap<RankedItem<Item>>((item, index) => {
    if (parsed.scope && item.scope !== parsed.scope) return [];
    const score = scoreItem(item, parsed.query);
    return score === null ? [] : [{ index, item, score }];
  });
  const groups = new Map<
    string,
    {
      bestScore: number;
      firstIndex: number;
      items: RankedItem<Item>[];
      sectionLabel: string;
    }
  >();

  for (const entry of ranked) {
    const current = groups.get(entry.item.section);
    if (current) {
      current.items.push(entry);
      current.bestScore = Math.max(current.bestScore, entry.score);
      continue;
    }
    groups.set(entry.item.section, {
      bestScore: entry.score,
      firstIndex: entry.index,
      items: [entry],
      sectionLabel: entry.item.sectionLabel,
    });
  }

  return [...groups.entries()]
    .sort(([, left], [, right]) =>
      parsed.query
        ? right.bestScore - left.bestScore || left.firstIndex - right.firstIndex
        : left.firstIndex - right.firstIndex
    )
    .map(([section, group]) => ({
      items: group.items
        .sort((left, right) =>
          right.score - left.score || left.index - right.index
        )
        .map(({ item }) => item),
      section,
      sectionLabel: group.sectionLabel,
    }));
}

export function loadCommandPaletteRecents(): string[] {
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(commandPaletteRecentsStorageKey) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return [...new Set(
      parsed.filter((value): value is string => typeof value === "string"),
    )].slice(0, commandPaletteRecentLimit);
  } catch {
    return [];
  }
}

export function rememberCommandPaletteItem(itemId: string): string[] {
  const next = [
    itemId,
    ...loadCommandPaletteRecents().filter((candidate) => candidate !== itemId),
  ].slice(0, commandPaletteRecentLimit);
  try {
    window.localStorage.setItem(
      commandPaletteRecentsStorageKey,
      JSON.stringify(next),
    );
  } catch {
    // Keep command execution working when local persistence is unavailable.
  }
  return next;
}
