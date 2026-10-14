import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/*
  Wrangler bundles a non-JavaScript import (Text/Data module) only when one of
  the `rules` globs in wrangler.jsonc matches the import *specifier* as written
  (`build.onResolve({ filter: globToRegExp(glob) })`), not the resolved file
  path. The Workers Vitest pool matches resolved paths instead, so a specifier
  that no glob matches passes every test and then fails `wrangler deploy` with
  "No loader is configured for .md files". The memory vault README import, under
  a glob naming the memory-vault directory, did exactly that (found by the 2026-10-14 memory vault e2e run).
*/

const appRoot = join(import.meta.dirname, "../apps/briar");

/** `glob-to-regexp` with its default options, as wrangler calls it. */
export function wranglerGlobToRegExp(glob: string) {
  let source = "";
  for (const character of glob) {
    if ("/$^+.()=!|[]{},?".includes(character)) source += `\\${character}`;
    else if (character === "*") source += ".*";
    else source += character;
  }
  return new RegExp(`^${source}$`);
}

type Rule = { type: string; globs: string[] };

/** wrangler.jsonc without its `//` comments and trailing commas (strings kept intact). */
function parseJsonc(text: string): unknown {
  let out = "";
  let inString = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (inString) {
      out += character;
      if (character === "\\") out += text[++index] ?? "";
      else if (character === '"') inString = false;
    } else if (character === '"') {
      inString = true;
      out += character;
    } else if (character === "/" && text[index + 1] === "/") {
      while (index < text.length && text[index] !== "\n") index += 1;
      out += "\n";
    } else out += character;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/gu, "$1"));
}

const rules = (): Rule[] =>
  (parseJsonc(readFileSync(join(appRoot, "wrangler.jsonc"), "utf8")) as { rules?: Rule[] }).rules ?? [];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(path);
    return /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) ? [path] : [];
  });
}

const nonJavaScriptImport = /\bimport\s+[\w{}\s,*]+\s+from\s+"([^"]+\.(?:md|svg|png|txt|html|wasm|bin))"/gu;

describe("Worker module rules", () => {
  it("matches specifiers the way wrangler does", () => {
    expect(wranglerGlobToRegExp("**/memory-vault-readme.md").test("./memory-vault-readme.md")).toBe(true);
    // A directory in the glob must appear in the specifier, which a sibling import does not name.
    expect(wranglerGlobToRegExp("**/memory-vault/*.md").test("./memory-vault-readme.md")).toBe(false);
  });

  it("covers every non-JavaScript import in the API Worker", () => {
    const configured = rules().filter((rule) => rule.type === "Text" || rule.type === "Data");
    const unmatched: string[] = [];
    let imports = 0;
    for (const file of sourceFiles(join(appRoot, "worker/src"))) {
      for (const match of readFileSync(file, "utf8").matchAll(nonJavaScriptImport)) {
        imports += 1;
        const specifier = match[1]!;
        if (!configured.some((rule) => rule.globs.some((glob) => wranglerGlobToRegExp(glob).test(specifier)))) {
          unmatched.push(`${relative(appRoot, file)}: "${specifier}"`);
        }
      }
    }
    expect(imports).toBeGreaterThan(0);
    expect(unmatched).toEqual([]);
  });
});
