import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { agentProviders } from "../apps/briar/src/lib/agent-provider";
import {
  agentProviderConstraints,
  seededAgentProviders,
} from "./agent-provider-sql-constraints";

const schema = readFileSync(
  resolve(import.meta.dirname, "../apps/briar/migrations-snapshot/schema.sql"),
  "utf8",
);
const catalog = [...agentProviders].sort();

describe("the persisted agent provider catalog", () => {
  test("is the lookup table, seeded with exactly the wire providers", () => {
    expect([...seededAgentProviders(schema)].sort()).toEqual(catalog);
  });

  test("no column spells the provider list out again", () => {
    // A CHECK list is not a second copy of the catalog, it is a column that
    // will reject the next provider: adding one is a row in the lookup table,
    // and no row can widen a CHECK. Give the column a foreign key into
    // briar_agent_providers instead.
    const spelledOut = agentProviderConstraints(schema)
      .map(({ table, column, providers }) =>
        `${table}.${column}: ${providers.join(", ")}`
      );
    expect(spelledOut).toEqual([]);
  });

  test("every provider column is a key into the lookup table", () => {
    const references = schema.match(
      /foreign key \("[a-z0-9_]*provider"\) references briar_agent_providers \(provider\)/gu,
    ) ?? [];
    expect(references.length).toBeGreaterThan(10);
  });
});
