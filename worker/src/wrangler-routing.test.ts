import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(
  readFileSync(new URL("../../wrangler.jsonc", import.meta.url), "utf8"),
) as {
  assets?: { run_worker_first?: string[] };
};

describe("Cloudflare Worker routing", () => {
  it("runs every top-level background execution endpoint before static assets", () => {
    expect(config.assets?.run_worker_first).toEqual(
      expect.arrayContaining([
        "/transcripts",
        "/idea-job-claims*",
        "/issue-reply-claims*",
        "/queue*",
        "/run-events",
      ]),
    );
  });
});
