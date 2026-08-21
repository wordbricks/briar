import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const localModulePattern = /\bfrom\s+["'](\.\/[^"']+)["']/gu;
const reexportPattern = /export(?:\s+type)?\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];/gu;

const databaseModuleGraph = async () => {
  const facade = new URL("./db.ts", import.meta.url);
  const pending = [facade];
  const sources = new Map<string, string>();

  while (pending.length > 0) {
    const moduleUrl = pending.pop()!;
    if (sources.has(moduleUrl.href)) continue;
    const source = await readFile(moduleUrl, "utf8");
    sources.set(moduleUrl.href, source);
    for (const match of source.matchAll(localModulePattern)) {
      pending.push(new URL(`${match[1]}.ts`, moduleUrl));
    }
  }

  return { facade, sources };
};

describe("database module boundaries", () => {
  it("keeps db.ts as a re-export-only compatibility facade", async () => {
    const source = await readFile(new URL("./db.ts", import.meta.url), "utf8");
    expect(source.replaceAll(reexportPattern, "").trim()).toBe("");
  });

  it("keeps implementations independent from the db.ts facade", async () => {
    const { facade, sources } = await databaseModuleGraph();
    for (const [moduleUrl, source] of sources) {
      if (moduleUrl === facade.href) continue;
      expect(source, moduleUrl).not.toMatch(/\bfrom\s+["']\.\/db["']/u);
    }
  });
});
