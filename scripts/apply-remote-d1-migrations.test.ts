import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyRemoteD1Migrations,
  type WranglerRunner,
} from "./apply-remote-d1-migrations";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

function migrationNameFromImportedSql(sql: string): string | null {
  return /INSERT INTO d1_migrations \(name\) VALUES \('([^']+)'\);/u.exec(
    sql,
  )?.[1] ?? null;
}

describe("remote D1 migration imports", () => {
  it("imports only pending migration files and then records them", async () => {
    const migrationsDirectory = await mkdtemp(join(tmpdir(), "briar-test-"));
    temporaryDirectories.push(migrationsDirectory);
    await writeFile(join(migrationsDirectory, "0001_first.sql"), "SELECT 1;\n");
    await writeFile(join(migrationsDirectory, "0002_second.sql"), "SELECT 2;\n");

    let importedSql = "";
    const appliedNames: string[] = [];
    const beforeMigration = vi.fn(async () => 0);
    const runner = vi.fn<WranglerRunner>(async (args, captureOutput) => {
      if (captureOutput) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              success: true,
              results: appliedNames.map((name) => ({ name })),
            },
          ]),
        };
      }
      const fileIndex = args.indexOf("--file");
      if (fileIndex >= 0) {
        importedSql = await readFile(args[fileIndex + 1]!, "utf8");
        const name = migrationNameFromImportedSql(importedSql);
        if (name && !appliedNames.includes(name)) appliedNames.push(name);
      }
      return { exitCode: 0, stdout: "" };
    });

    await expect(
      applyRemoteD1Migrations({
        migrationsDirectory,
        runner,
        beforeMigration,
        importRetryDelayMillis: 0,
      }),
    ).resolves.toBe(0);
    expect(importedSql).toContain("SELECT 2;");
    expect(importedSql).toContain(
      "INSERT INTO d1_migrations (name) VALUES ('0002_second.sql');",
    );
    expect(beforeMigration).toHaveBeenCalledTimes(2);
    expect(beforeMigration).toHaveBeenLastCalledWith("0002_second.sql", undefined);
  });

  it("recovers when the final import poll fails after D1 commits", async () => {
    const migrationsDirectory = await mkdtemp(join(tmpdir(), "briar-test-"));
    temporaryDirectories.push(migrationsDirectory);
    await writeFile(join(migrationsDirectory, "0001_first.sql"), "SELECT 1;\n");

    let historyReads = 0;
    let imports = 0;
    const runner = vi.fn<WranglerRunner>(async (args, captureOutput) => {
      if (captureOutput) {
        historyReads += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              success: true,
              results: historyReads >= 2
                ? [{ name: "0001_first.sql" }]
                : [],
            },
          ]),
        };
      }
      if (args.includes("--file")) imports += 1;
      return {
        exitCode: args.includes("--file") ? 1 : 0,
        stdout: "",
      };
    });

    await expect(
      applyRemoteD1Migrations({ migrationsDirectory, runner, importRetryDelayMillis: 0 }),
    ).resolves.toBe(0);
    expect(historyReads).toBe(2);
    expect(imports).toBe(1);
  });

  it("retries an import that returned success without committing", async () => {
    const migrationsDirectory = await mkdtemp(join(tmpdir(), "briar-test-"));
    temporaryDirectories.push(migrationsDirectory);
    await writeFile(join(migrationsDirectory, "0001_first.sql"), "SELECT 1;\n");

    let imports = 0;
    let committed = false;
    const runner = vi.fn<WranglerRunner>(async (args, captureOutput) => {
      if (captureOutput) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              success: true,
              results: committed ? [{ name: "0001_first.sql" }] : [],
            },
          ]),
        };
      }
      if (args.includes("--file")) {
        imports += 1;
        // The first import returns success while the server-side job silently
        // fails; the retry commits.
        if (imports === 2) committed = true;
      }
      return { exitCode: 0, stdout: "" };
    });

    await expect(
      applyRemoteD1Migrations({ migrationsDirectory, runner, importRetryDelayMillis: 0 }),
    ).resolves.toBe(0);
    expect(imports).toBe(2);
  });

  it("fails after the import repeatedly returns success without committing", async () => {
    const migrationsDirectory = await mkdtemp(join(tmpdir(), "briar-test-"));
    temporaryDirectories.push(migrationsDirectory);
    await writeFile(join(migrationsDirectory, "0001_first.sql"), "SELECT 1;\n");

    let imports = 0;
    const runner = vi.fn<WranglerRunner>(async (args, captureOutput) => {
      if (captureOutput) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ success: true, results: [] }]),
        };
      }
      if (args.includes("--file")) imports += 1;
      return { exitCode: 0, stdout: "" };
    });

    await expect(
      applyRemoteD1Migrations({ migrationsDirectory, runner, importRetryDelayMillis: 0 }),
    ).resolves.toBe(1);
    expect(imports).toBe(3);
  });

  it("preserves the import failure when the migration was not committed", async () => {
    const migrationsDirectory = await mkdtemp(join(tmpdir(), "briar-test-"));
    temporaryDirectories.push(migrationsDirectory);
    await writeFile(join(migrationsDirectory, "0001_first.sql"), "SELECT 1;\n");

    let imports = 0;
    const runner = vi.fn<WranglerRunner>(async (args, captureOutput) => {
      if (captureOutput) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([{ success: true, results: [] }]),
        };
      }
      if (args.includes("--file")) imports += 1;
      return { exitCode: args.includes("--file") ? 23 : 0, stdout: "" };
    });

    await expect(
      applyRemoteD1Migrations({ migrationsDirectory, runner, importRetryDelayMillis: 0 }),
    ).resolves.toBe(23);
    expect(imports).toBe(1);
  });
});
