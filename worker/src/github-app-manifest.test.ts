import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("GitHub App manifest", () => {
  it("subscribes to signed merge-group events with read-only queue access", async () => {
    const manifest = await readFile("config/github-app-manifest.yaml", "utf8");
    expect(manifest).toContain("merge_queues: read");
    expect(manifest).toContain("pull_requests: read");
    expect(manifest).toContain("administration: read");
    expect(manifest).toContain("contents: read");
    expect(manifest).toContain("statuses: write");
    expect(manifest).toMatch(/default_events:[\s\S]*- merge_group/u);
    expect(manifest).toMatch(/default_events:[\s\S]*- pull_request/u);
    expect(manifest).not.toMatch(/merge_queues: write/u);
  });
});
