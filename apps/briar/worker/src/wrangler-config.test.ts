import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Wrangler asset routing", () => {
  it("routes Connect and raw upload APIs before static assets", async () => {
    const path = fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url));
    const source = await readFile(path, "utf8");
    const runWorkerFirst = source.match(
      /"run_worker_first"\s*:\s*\[([\s\S]*?)\]/u,
    )?.[1];

    expect(runWorkerFirst).toContain('"/briar.app.v1.*"');
    expect(runWorkerFirst).toContain('"/briar.worker.v1.*"');
    expect(runWorkerFirst).toContain('"/uploads*"');
  });
});
