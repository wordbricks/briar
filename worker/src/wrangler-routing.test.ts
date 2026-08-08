import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
) as {
  assets?: { run_worker_first?: string[] };
  triggers?: { crons?: string[] };
};

describe("Cloudflare Worker routing", () => {
  it("runs every top-level background execution endpoint before static assets", () => {
    expect(config.assets?.run_worker_first).toEqual(
      expect.arrayContaining([
        "/transcripts",
        "/issue-reply-claims*",
        "/agent-task-claims*",
        "/queue*",
        "/run-events",
        "/github/*",
      ]),
    );
  });

  it("sweeps deferred GitHub merge reconciliation every minute", () => {
    expect(config.triggers?.crons).toContain("* * * * *");
  });
});
