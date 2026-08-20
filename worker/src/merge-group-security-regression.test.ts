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

  it("keeps the candidate in a networkless container without inherited credentials", async () => {
    const [executor, profile] = await Promise.all([
      readFile("src-cli/merge-group-validation.ts", "utf8"),
      readFile("scripts/ci-local.sh", "utf8"),
    ]);
    expect(executor).toContain("shell: false");
    expect(executor).not.toContain('"-lc"');
    expect(executor).not.toContain("...process.env");
    expect(executor).not.toContain("env: process.env");
    expect(executor).toContain('"--network=none"');
    expect(executor).toContain('"--user=65532:65532"');
    expect(executor).toContain("repository.bundle");
    expect(executor).not.toContain("dst=/candidate");
    expect(executor).not.toContain("BRIAR_CI_CANDIDATE_ROOT");
    expect(executor).not.toContain("dst=/repo/.git");
    expect(executor).not.toContain("BRIAR_WORKER_TOKEN");
    expect(executor).not.toContain("GH_TOKEN");
    expect(profile).toContain("bun run test -- --maxWorkers=1");
  });

  it("uses a forward-only cleanup after preserving migration 0121", async () => {
    const migration = await readFile(
      "migrations/0122_merge_group_executor_cleanup.sql",
      "utf8",
    );
    expect(migration.match(/create table/gu)).toHaveLength(1);
    expect(migration).toContain("create table merge_group_validation_jobs");
    expect(migration).toContain("drop table if exists briar_repository_merge_policies");
    expect(migration).toContain("drop table if exists briar_merge_batches");
    expect(migration).toContain("drop table if exists briar_merge_batch_candidates");
  });
});
