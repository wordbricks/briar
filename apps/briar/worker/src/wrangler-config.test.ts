import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Wrangler asset routing", () => {
  const readRunWorkerFirst = async () => {
    const path = fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url));
    const source = await readFile(path, "utf8");
    return source.match(
      /"run_worker_first"\s*:\s*\[([\s\S]*?)\]/u,
    )?.[1];
  };

  it("sends merge batch claims to the API Worker", async () => {
    const runWorkerFirst = await readRunWorkerFirst();

    expect(runWorkerFirst).toContain('"/merge-batch-claims*"');
  });

  it("sends hierarchy API routes to the API Worker", async () => {
    const runWorkerFirst = await readRunWorkerFirst();

    expect(runWorkerFirst).toContain('"/workspaces*"');
    expect(runWorkerFirst).toContain('"/teams*"');
  });
});
