import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("merge-group security regression", () => {
  it("has no agent policy mutation route or raw validation/status inputs", async () => {
    const [server, requestContract, cliContract] = await Promise.all([
      readFile("worker/src/index.ts", "utf8"),
      readFile("worker/src/worker-request-contract.ts", "utf8"),
      readFile("src-cli/worker-claim-contract.ts", "utf8"),
    ]);
    const surface = `${server}\n${requestContract}\n${cliContract}`;
    expect(surface).not.toContain("/merge-policy");
    expect(surface).not.toContain("validationCommand");
    expect(surface).not.toContain("statusContexts");
    expect(surface).not.toContain('workType: "mergeBatch"');
  });

  it("keeps the executor shell-free and its environment allowlisted", async () => {
    const executor = await readFile("src-cli/merge-group-validation.ts", "utf8");
    expect(executor).toContain("shell: false");
    expect(executor).not.toContain("/bin/bash");
    expect(executor).not.toContain('"-lc"');
    expect(executor).not.toContain("...process.env");
  });

  it("uses one small migration table instead of a shadow merge queue", async () => {
    const migration = await readFile(
      "migrations/0121_merge_group_validation_jobs.sql",
      "utf8",
    );
    expect(migration.match(/create table/gu)).toHaveLength(1);
    expect(migration).toContain("create table merge_group_validation_jobs");
    expect(migration).not.toContain("briar_repository_merge_policies");
    expect(migration).not.toContain("briar_merge_batches");
    expect(migration).not.toContain("candidate");
  });
});
