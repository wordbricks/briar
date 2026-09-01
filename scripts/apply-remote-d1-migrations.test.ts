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

describe("remote D1 migration imports", () => {
  it("imports only pending migration files and then records them", async () => {
    const migrationsDirectory = await mkdtemp(join(tmpdir(), "briar-test-"));
    temporaryDirectories.push(migrationsDirectory);
    await writeFile(join(migrationsDirectory, "0001_first.sql"), "SELECT 1;\n");
    await writeFile(join(migrationsDirectory, "0002_second.sql"), "SELECT 2;\n");

    let importedSql = "";
    const beforeMigration = vi.fn(async () => 0);
    const runner = vi.fn<WranglerRunner>(async (args, captureOutput) => {
      if (captureOutput) {
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            { success: true, results: [{ name: "0001_first.sql" }] },
          ]),
        };
      }
      const fileIndex = args.indexOf("--file");
      if (fileIndex >= 0) {
        importedSql = await readFile(args[fileIndex + 1]!, "utf8");
      }
      return { exitCode: 0, stdout: "" };
    });

    await expect(
      applyRemoteD1Migrations({
        migrationsDirectory,
        runner,
        beforeMigration,
      }),
    ).resolves.toBe(0);
    expect(importedSql).toContain("SELECT 2;");
    expect(importedSql).toContain(
      "INSERT INTO d1_migrations (name) VALUES ('0002_second.sql');",
    );
    expect(runner).toHaveBeenCalledTimes(3);
    expect(beforeMigration).toHaveBeenCalledOnce();
    expect(beforeMigration).toHaveBeenCalledWith("0002_second.sql");
  });

  it("recovers when the final import poll fails after D1 commits", async () => {
    const migrationsDirectory = await mkdtemp(join(tmpdir(), "briar-test-"));
    temporaryDirectories.push(migrationsDirectory);
    await writeFile(join(migrationsDirectory, "0001_first.sql"), "SELECT 1;\n");

    let historyReads = 0;
    const runner = vi.fn<WranglerRunner>(async (args, captureOutput) => {
      if (captureOutput) {
        historyReads += 1;
        return {
          exitCode: 0,
          stdout: JSON.stringify([
            {
              success: true,
              results: historyReads === 1
                ? []
                : [{ name: "0001_first.sql" }],
            },
          ]),
        };
      }
      return {
        exitCode: args.includes("--file") ? 1 : 0,
        stdout: "",
      };
    });

    await expect(
      applyRemoteD1Migrations({ migrationsDirectory, runner }),
    ).resolves.toBe(0);
    expect(historyReads).toBe(2);
  });

  it("preserves the import failure when the migration was not committed", async () => {
    const migrationsDirectory = await mkdtemp(join(tmpdir(), "briar-test-"));
    temporaryDirectories.push(migrationsDirectory);
    await writeFile(join(migrationsDirectory, "0001_first.sql"), "SELECT 1;\n");

    const runner = vi.fn<WranglerRunner>(async (args, captureOutput) => ({
      exitCode: !captureOutput && args.includes("--file") ? 23 : 0,
      stdout: captureOutput
        ? JSON.stringify([{ success: true, results: [] }])
        : "",
    }));

    await expect(
      applyRemoteD1Migrations({ migrationsDirectory, runner }),
    ).resolves.toBe(23);
  });
});
