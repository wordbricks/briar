import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { agentProviders } from "../apps/briar/src/lib/agent-provider";
import {
  agentProviderConstraints,
  currentSqlProviderList,
} from "./agent-provider-sql-constraints";

const schema = readFileSync(
  resolve(import.meta.dirname, "../apps/briar/migrations-snapshot/schema.sql"),
  "utf8",
);
const constraints = agentProviderConstraints(schema);
const catalog = [...agentProviders].sort();

/**
 * `briar_issue_agent_reply_jobs` was rebuilt by
 * `0116_issue_project_agent_replies.sql`, which sorts after
 * `0116_agent_provider_openrouter.sql` and restored the pre-OpenRouter list.
 * These two columns therefore still reject `openrouter` in production. Repair
 * needs its own migration; until then they are pinned so the list cannot grow
 * and so the pin fails loudly once the drift is fixed.
 */
const knownStaleConstraints = [
  { table: "briar_issue_agent_reply_jobs", column: "preferred_provider" },
  { table: "briar_issue_agent_reply_jobs", column: "agent_provider" },
] as const;

const isKnownStale = (table: string, column: string) =>
  knownStaleConstraints.some((stale) =>
    stale.table === table && stale.column === column
  );

describe("persisted agent provider constraints", () => {
  test("the snapshot actually constrains provider columns", () => {
    expect(constraints.length).toBeGreaterThan(10);
  });

  test("every current constraint lists exactly the wire providers", () => {
    const drifted = constraints
      .filter(({ table, column }) => !isKnownStale(table, column))
      .filter(({ providers }) =>
        [...providers].sort().join(",") !== catalog.join(",")
      )
      .map(({ table, column, providers }) =>
        `${table}.${column}: ${providers.join(", ")}`
      );
    expect(drifted).toEqual([]);
  });

  test("the known-stale constraints stay exactly as recorded", () => {
    const stale = constraints
      .filter(({ table, column }) => isKnownStale(table, column))
      .map(({ table, column, providers }) =>
        `${table}.${column}: ${[...providers].sort().join(", ")}`
      );
    const expected = catalog.filter((provider) => provider !== "openrouter")
      .join(", ");
    expect(stale).toEqual(
      knownStaleConstraints.map((constraint) =>
        `${constraint.table}.${constraint.column}: ${expected}`
      ),
    );
  });

  test("the generator finds the list a new provider is appended to", () => {
    expect(currentSqlProviderList(schema, agentProviders).length).toBe(
      agentProviders.length,
    );
  });
});
