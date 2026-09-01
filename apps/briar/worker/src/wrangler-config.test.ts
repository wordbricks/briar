import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Wrangler asset routing", () => {
  const readConfigSource = async () => {
    const path = fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url));
    return readFile(path, "utf8");
  };

  const readRunWorkerFirst = async () => {
    const source = await readConfigSource();
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

  it("enables evaluated DM memory recall without automatic learning", async () => {
    const source = await readConfigSource();

    expect(source).toContain('"DM_MEMORY_INDEX_ENABLED": "true"');
    expect(source).toContain('"DM_MEMORY_RETRIEVAL_ENABLED": "true"');
    expect(source).toContain('"DM_MEMORY_MINIMUM_SCORE": "0.5"');
    expect(source).toContain('"DM_MEMORY_LEARNING_ENABLED": "false"');
    expect(source).toContain('"DM_MEMORY_LEARNING_POLICIES": "{}"');
  });
});
