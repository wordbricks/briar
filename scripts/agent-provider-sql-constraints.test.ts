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

describe("persisted agent provider constraints", () => {
  test("the snapshot actually constrains provider columns", () => {
    expect(constraints.length).toBeGreaterThan(10);
  });

  test("every constraint lists exactly the wire providers", () => {
    const drifted = constraints
      .filter(({ providers }) =>
        [...providers].sort().join(",") !== catalog.join(",")
      )
      .map(({ table, column, providers }) =>
        `${table}.${column}: ${providers.join(", ")}`
      );
    expect(drifted).toEqual([]);
  });

  test("the generator finds the list a new provider is appended to", () => {
    expect(currentSqlProviderList(schema, agentProviders).length).toBe(
      agentProviders.length,
    );
  });
});
