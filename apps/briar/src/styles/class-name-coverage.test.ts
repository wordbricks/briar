import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
  Renaming a class in JSX without renaming its rule leaves the element unstyled
  and the rule dead — nothing in the type checker or the component tests notices.
  That is how the Organization → Workspace rename shipped a sidebar whose
  workspace logo rendered at its natural size over the whole top-left corner.

  The prefixes below are the surfaces whose rules and class names line up exactly
  today, so the invariant holds with no allowlist of dead rules to keep in sync.
  Other prefixes still carry selectors that predate this guard.
*/
const guardedPrefixes = ["sidebar-", "workspace-", "companion-workspace-"];

const stylesheets = [
  "src/styles.css",
  "src/styles/dark.css",
  "src/styles/globals.css",
  "src/styles/launch-intro.css",
  "src/components/TeamMergeActivity.css",
];

/* Markers carried in `className` for readability; they never had a rule. */
const unstyledMarkers = new Set(["sidebar-control", "workspace-list"]);

function isGuarded(name: string) {
  return guardedPrefixes.some((prefix) => name.startsWith(prefix));
}

function sourceFiles() {
  const paths: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/u.test(entry.name)) paths.push(path);
    }
  };
  walk(resolve("src"));
  return paths.map((path) => readFileSync(path, "utf8"));
}

const css = stylesheets.map((sheet) => readFileSync(resolve(sheet), "utf8")).join("\n");
const sources = sourceFiles();

describe("stylesheet class coverage", () => {
  it("keeps every sidebar and workspace rule reachable from the components", () => {
    const source = sources.join("\n");
    const styled = new Set(
      [...css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/gu)]
        .map(([, name]) => name)
        .filter(isGuarded),
    );

    expect(styled.size).toBeGreaterThan(20);
    expect([...styled].filter((name) => !source.includes(name)).sort()).toEqual([]);
  });

  it("keeps every sidebar and workspace class name backed by a rule", () => {
    const used = new Set<string>();
    for (const source of sources) {
      for (const [, value] of source.matchAll(/className\s*=\s*"([^"]+)"/gu)) {
        for (const name of value.split(/\s+/u)) {
          if (isGuarded(name) && !unstyledMarkers.has(name)) used.add(name);
        }
      }
    }

    expect(used.size).toBeGreaterThan(20);
    expect(
      [...used]
        .filter((name) => !new RegExp(`\\.${name}\\b`, "u").test(css))
        .sort(),
    ).toEqual([]);
  });
});
