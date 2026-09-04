import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * How deeply D1 lets a statement nest trigger programs, and how this file
 * measures it.
 *
 * workerd calls `sqlite3_limit(db, SQLITE_LIMIT_TRIGGER_DEPTH, 10)`. Current
 * SQLite enforces that limit while *compiling* a statement rather than while
 * running one: `codeRowTrigger()` in trigger.c walks the chain of enclosing
 * `Parse` objects and raises "triggers nested too deep" as soon as a trigger
 * sub-program would be coded eleven levels down. So the cost is static. A
 * statement that reaches an eleven-deep chain of trigger programs fails to
 * prepare even against an empty table, and `foreign key ... on delete cascade`
 * actions are compiled as trigger programs too, so they count.
 *
 * SQLite codes each trigger at most once per statement (`getRowTrigger()`
 * memoises on the `Trigger` pointer), so the depth that matters is the depth of
 * the *first* time a trigger is reached, walking the schema the way SQLite
 * does:
 *
 *   - every row trigger of the table is coded first, in `sqlite_schema` order
 *     reversed (`sqlite3FinishTrigger` prepends to `Table.pTrigger`), BEFORE
 *     and AFTER together, because `sqlite3TriggerColmask` codes them all to
 *     work out the OLD/NEW column masks;
 *   - then the foreign key actions of the tables that reference it, in
 *     `sqlite_schema` order reversed as well (`sqlite3FkReferences` walks a
 *     hash chain the schema loader prepends to);
 *   - `update of (…)` triggers are skipped when the statement's SET list does
 *     not overlap their column list (`checkColumnOverlap`).
 *
 * This test replays that walk over `migrations-snapshot/schema.sql` and asserts
 * the deepest statement stays within D1's limit. It is a regression guard for
 * one specific failure mode: a migration that rebuilds tables (every provider
 * migration does, because SQLite cannot alter a CHECK constraint) reshuffles
 * `sqlite_schema`, which reshuffles this walk, which can push a cascade that
 * used to fit over the edge with no source change at all.
 */
export const D1_TRIGGER_DEPTH_LIMIT = 10;

type Event = "insert" | "update" | "delete";

type ForeignKey = {
  readonly child: string;
  readonly childColumns: readonly string[];
  readonly parent: string;
  readonly onDelete: string;
  readonly onUpdate: string;
};

type Trigger = {
  readonly name: string;
  readonly table: string;
  readonly event: Event;
  readonly ofColumns: readonly string[] | null;
  readonly writes: readonly Write[];
};

/**
 * SQLite codes a trigger once per ON CONFLICT policy it is reached with
 * (`getRowTrigger()` keys on the trigger *and* `orconf`), and a policy is
 * inherited by everything below the statement that set it: a plain step keeps
 * the outer policy, `insert or ignore` replaces it for its whole subtree, and
 * DELETE resets it because `sqlite3DeleteFrom` always codes its triggers with
 * OE_Default. The same trigger can therefore be coded several times in one
 * statement, at a different depth each time.
 */
type Conflict = "default" | "abort" | "ignore" | "replace" | "fail" | "rollback";

type Write = {
  readonly table: string;
  readonly event: Event;
  readonly columns: readonly string[] | null;
  /** The step's own `or <policy>` clause; `default` when it has none. */
  readonly conflict: Conflict;
};

const unquote = (identifier: string) =>
  identifier.replace(/^["'`[]/u, "").replace(/["'`\]]$/u, "");

const IDENTIFIER = String.raw`(?:"[^"]+"|\[[^\]]+\]|` + "`[^`]+`" +
  String.raw`|[A-Za-z_][\w$]*)`;

/** Replace string literals and comments with blanks so scanning stays honest. */
const blankLiterals = (sql: string) => {
  let out = "";
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;
    if (char === "'") {
      out += "''";
      i += 1;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i += 1;
      }
      continue;
    }
    if (char === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i += 1;
      out += "\n";
      continue;
    }
    out += char;
  }
  return out;
};

/** Split on `;` that sit outside parentheses. */
const topLevelStatements = (body: string) => {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of body) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === ";" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
};

/** Columns named on the left of a top-level `set` assignment. */
const setColumns = (statement: string) => {
  const at = statement.search(/\bset\b/iu);
  if (at < 0) return [];
  const rest = statement.slice(at + 3);
  const columns: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < rest.length; i++) {
    const char = rest[i]!;
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (depth === 0 && /\s/u.test(char) && /\bwhere\s*$/iu.test(current + char)) {
      break;
    }
    if (depth === 0 && char === ",") {
      columns.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  columns.push(current);
  return columns
    .map((piece) => piece.match(new RegExp(String.raw`^\s*(${IDENTIFIER})\s*=`, "u")))
    .flatMap((match) => (match ? [unquote(match[1]!).toLowerCase()] : []));
};

/** The tables a trigger body writes, and how. */
const bodyWrites = (body: string, tables: ReadonlySet<string>) => {
  const writes: Write[] = [];
  for (const statement of topLevelStatements(blankLiterals(body))) {
    const insert = statement.match(
      new RegExp(
        String.raw`^(?:insert(?:\s+or\s+(\w+))?|(replace))\s+into\s+(${IDENTIFIER})`,
        "iu",
      ),
    );
    if (insert) {
      const table = unquote(insert[3]!).toLowerCase();
      if (!tables.has(table)) continue;
      const conflict = (insert[2]
        ? "replace"
        : (insert[1]?.toLowerCase() ?? "default")) as Conflict;
      writes.push({ table, event: "insert", columns: null, conflict });
      // `on conflict … do update set` also codes the table's UPDATE triggers,
      // and sqlite3UpsertDoUpdate() always codes them with OE_Abort.
      const upsert = statement.match(
        /\bon\s+conflict\b[\s\S]*?\bdo\s+update\b([\s\S]*)$/iu,
      );
      if (upsert) {
        writes.push({
          table,
          event: "update",
          columns: setColumns(upsert[1]!),
          conflict: "abort",
        });
      }
      continue;
    }
    const update = statement.match(
      new RegExp(String.raw`^update(?:\s+or\s+(\w+))?\s+(${IDENTIFIER})\b`, "iu"),
    );
    if (update) {
      const table = unquote(update[2]!).toLowerCase();
      if (tables.has(table)) {
        writes.push({
          table,
          event: "update",
          columns: setColumns(statement),
          conflict: (update[1]?.toLowerCase() ?? "default") as Conflict,
        });
      }
      continue;
    }
    const remove = statement.match(
      new RegExp(String.raw`^delete\s+from\s+(${IDENTIFIER})`, "iu"),
    );
    if (remove) {
      const table = unquote(remove[1]!).toLowerCase();
      if (tables.has(table)) {
        writes.push({
          table,
          event: "delete",
          columns: null,
          conflict: "default",
        });
      }
    }
  }
  return writes;
};

/** The pieces of a `create table` body, split on commas outside parentheses. */
const topLevelPieces = (inner: string) => {
  const pieces: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of inner) {
    if (char === "(") depth += 1;
    if (char === ")") depth -= 1;
    if (char === "," && depth === 0) {
      pieces.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  pieces.push(current);
  return pieces;
};

const RESERVED_PIECE = /^\s*(?:constraint|primary|unique|check|foreign)\b/iu;

const foreignKeyAction = (clauses: string, kind: "delete" | "update") => {
  const match = clauses.match(
    new RegExp(
      String.raw`on\s+${kind}\s+(cascade|restrict|set\s+null|set\s+default|no\s+action)`,
      "iu",
    ),
  );
  return match ? match[1]!.toLowerCase().replace(/\s+/gu, " ") : "no action";
};

/** Foreign keys declared by one `create table` statement. */
const tableForeignKeys = (table: string, inner: string) => {
  const keys: ForeignKey[] = [];
  for (const piece of topLevelPieces(inner)) {
    const at = piece.search(/\breferences\b/iu);
    if (at < 0) continue;
    const target = piece
      .slice(at)
      .match(new RegExp(String.raw`^references\s+(${IDENTIFIER})`, "iu"));
    if (!target) continue;
    const clauses = piece.slice(at + target[0].length);
    let childColumns: string[];
    const tableLevel = piece.match(
      /^\s*(?:constraint\s+\S+\s+)?foreign\s+key\s*\(([^)]*)\)/iu,
    );
    if (tableLevel) {
      childColumns = tableLevel[1]!
        .split(",")
        .map((column) => unquote(column.trim()).toLowerCase());
    } else {
      if (RESERVED_PIECE.test(piece)) continue;
      const column = piece.match(new RegExp(String.raw`^\s*(${IDENTIFIER})`, "u"));
      if (!column) continue;
      childColumns = [unquote(column[1]!).toLowerCase()];
    }
    keys.push({
      child: table,
      childColumns,
      parent: unquote(target[1]!).toLowerCase(),
      onDelete: foreignKeyAction(clauses, "delete"),
      onUpdate: foreignKeyAction(clauses, "update"),
    });
  }
  return keys;
};

type Schema = {
  readonly tables: readonly string[];
  readonly columns: ReadonlyMap<string, readonly string[]>;
  /** Per table, its triggers in the order SQLite codes them (schema order reversed). */
  readonly triggersOf: ReadonlyMap<string, readonly Trigger[]>;
  /** Per parent table, the foreign keys pointing at it, in the same reversed order. */
  readonly referencesTo: ReadonlyMap<string, readonly ForeignKey[]>;
};

export const parseSchema = (snapshot: string): Schema => {
  const statements = snapshot
    .split("-- @statement")
    .map((part) => part.trim())
    .filter(Boolean);
  const tables: string[] = [];
  // Views take writes too: an `instead of` trigger on one is coded exactly like
  // a table's row trigger, and several change-log triggers write through one.
  const views: string[] = [];
  const columns = new Map<string, string[]>();
  const foreignKeys: ForeignKey[] = [];
  const triggerStatements: { name: string; sql: string }[] = [];
  for (const statement of statements) {
    const table = statement.match(
      new RegExp(
        String.raw`^create\s+table\s+(?:if\s+not\s+exists\s+)?(${IDENTIFIER})\s*\(`,
        "iu",
      ),
    );
    if (table) {
      const name = unquote(table[1]!).toLowerCase();
      if (name.startsWith("sqlite_") || name.startsWith("d1_")) continue;
      tables.push(name);
      const inner = statement.slice(table[0].length, statement.lastIndexOf(")"));
      columns.set(
        name,
        topLevelColumns(blankLiterals(inner)),
      );
      foreignKeys.push(...tableForeignKeys(name, blankLiterals(inner)));
      continue;
    }
    const view = statement.match(
      new RegExp(String.raw`^create\s+view\s+(?:if\s+not\s+exists\s+)?(${IDENTIFIER})`, "iu"),
    );
    if (view) {
      views.push(unquote(view[1]!).toLowerCase());
      continue;
    }
    const trigger = statement.match(
      new RegExp(String.raw`^create\s+trigger\s+(${IDENTIFIER})`, "iu"),
    );
    if (trigger) {
      triggerStatements.push({
        name: unquote(trigger[1]!).toLowerCase(),
        sql: statement,
      });
    }
  }
  const writable = new Set([...tables, ...views]);
  const triggers: Trigger[] = [];
  for (const { name, sql } of triggerStatements) {
    const header = sql.match(
      new RegExp(
        String.raw`^create\s+trigger\s+${IDENTIFIER}\s+(?:before|after|instead\s+of)?\s*(insert|update|delete)\s*(?:\s+of\s+([\s\S]*?))?\s+on\s+(${IDENTIFIER})`,
        "iu",
      ),
    );
    if (!header) throw new Error(`Could not parse trigger header: ${name}`);
    const blanked = blankLiterals(sql);
    const beginAt = blanked.search(/\bbegin\b/iu);
    const endAt = blanked.toLowerCase().lastIndexOf("end");
    if (beginAt < 0 || endAt < beginAt) {
      throw new Error(`Could not find the body of trigger ${name}`);
    }
    triggers.push({
      name,
      table: unquote(header[3]!).toLowerCase(),
      event: header[1]!.toLowerCase() as Event,
      ofColumns: header[2]
        ? header[2].split(",").map((c) => unquote(c.trim()).toLowerCase())
        : null,
      writes: bodyWrites(blanked.slice(beginAt + 5, endAt), writable),
    });
  }
  // SQLite prepends as it loads, so both lists run newest object first.
  const triggersOf = new Map<string, Trigger[]>();
  for (const trigger of triggers) {
    const list = triggersOf.get(trigger.table) ?? [];
    list.unshift(trigger);
    triggersOf.set(trigger.table, list);
  }
  const referencesTo = new Map<string, ForeignKey[]>();
  for (const key of foreignKeys) {
    if (!writable.has(key.parent)) continue;
    const list = referencesTo.get(key.parent) ?? [];
    list.unshift(key);
    referencesTo.set(key.parent, list);
  }
  return { tables, columns, triggersOf, referencesTo };
};

/** Column names declared at the top level of a `create table` body. */
const topLevelColumns = (inner: string) =>
  topLevelPieces(inner).flatMap((piece) => {
    if (RESERVED_PIECE.test(piece)) return [];
    const match = piece.match(new RegExp(String.raw`^\s*(${IDENTIFIER})`, "u"));
    return match ? [unquote(match[1]!).toLowerCase()] : [];
  });

const overlaps = (
  ofColumns: readonly string[] | null,
  changed: readonly string[] | null,
) => {
  if (!ofColumns) return true;
  if (!changed) return true;
  return ofColumns.some((column) => changed.includes(column));
};

/**
 * The deepest trigger nesting SQLite reaches while compiling `event` on
 * `table`, counted the way `codeRowTrigger()` counts it: 0 for a trigger coded
 * straight from the statement, +1 for each further level. A statement is
 * rejected by D1 once this reaches `D1_TRIGGER_DEPTH_LIMIT`.
 */
export const compileDepth = (
  schema: Schema,
  table: string,
  event: Event,
  changed: readonly string[] | null,
) => {
  const coded = new Set<string>();
  let deepest = -1;
  const codeStatement = (
    target: string,
    targetEvent: Event,
    targetColumns: readonly string[] | null,
    depth: number,
    conflict: Conflict,
  ) => {
    // `sqlite3DeleteFrom` codes its row triggers with OE_Default whatever the
    // statement around it chose; INSERT and UPDATE pass their own policy down.
    const policy: Conflict = targetEvent === "delete" ? "default" : conflict;
    for (const trigger of schema.triggersOf.get(target) ?? []) {
      if (trigger.event !== targetEvent) continue;
      if (targetEvent === "update" && !overlaps(trigger.ofColumns, targetColumns)) {
        continue;
      }
      codeTrigger(`${trigger.name}|${policy}`, trigger.writes, depth, policy);
    }
    if (targetEvent === "insert") return;
    for (const key of schema.referencesTo.get(target) ?? []) {
      const action = targetEvent === "delete" ? key.onDelete : key.onUpdate;
      if (action !== "cascade" && action !== "set null" && action !== "set default") {
        continue;
      }
      // `sqlite3FkActions` codes the action trigger with OE_Abort.
      const writes: Write[] = action === "cascade"
        ? [{ table: key.child, event: "delete", columns: null, conflict: "default" }]
        : [{
          table: key.child,
          event: "update",
          columns: key.childColumns,
          conflict: "default",
        }];
      codeTrigger(
        `fk:${key.child}:${key.childColumns.join(",")}:${key.parent}:${targetEvent}`,
        writes,
        depth,
        "abort",
      );
    }
  };
  const codeTrigger = (
    id: string,
    writes: readonly Write[],
    depth: number,
    conflict: Conflict,
  ) => {
    if (coded.has(id)) return;
    coded.add(id);
    if (depth > deepest) deepest = depth;
    for (const write of writes) {
      // `codeTriggerProgram`: a step keeps the inherited policy unless the
      // statement around it was coded with OE_Default.
      const stepPolicy = conflict === "default" ? write.conflict : conflict;
      codeStatement(write.table, write.event, write.columns, depth + 1, stepPolicy);
    }
  };
  codeStatement(table, event, changed, 0, "default");
  return deepest + 1;
};

