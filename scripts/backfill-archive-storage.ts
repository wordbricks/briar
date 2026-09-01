import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "apps",
  "briar",
);

type BackfillResponse = {
  processed: number;
  remaining: number;
};

const decodeBackfillResponse = (input: unknown): BackfillResponse => {
  if (
    input === null ||
    typeof input !== "object" ||
    !("processed" in input) ||
    !("remaining" in input) ||
    typeof input.processed !== "number" ||
    typeof input.remaining !== "number"
  ) {
    throw new Error("Archive backfill returned an invalid response");
  }
  return { processed: input.processed, remaining: input.remaining };
};

export async function backfillRemoteArchiveStorage(): Promise<number> {
  const token = crypto.randomUUID();
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const origin = `http://127.0.0.1:${port}`;
  const worker = Bun.spawn([
    "bunx",
    "wrangler",
    "dev",
    "worker/src/archive-storage-backfill-entry.ts",
    "--remote",
    "--config",
    "wrangler.archive-backfill.jsonc",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--var",
    `BRIAR_ARCHIVE_BACKFILL_TOKEN:${token}`,
  ], {
    cwd: appDirectory,
    env: process.env,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  try {
    let ready = false;
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (await Promise.race([
        worker.exited.then(() => true),
        Bun.sleep(250).then(() => false),
      ])) {
        throw new Error("Archive backfill Worker exited before becoming ready");
      }
      try {
        const response = await fetch(`${origin}/health`);
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {
        // Remote bindings can take a few seconds to initialize.
      }
    }
    if (!ready) throw new Error("Archive backfill Worker did not become ready");

    let totalProcessed = 0;
    for (let batch = 0; batch < 10_000; batch += 1) {
      const response = await fetch(`${origin}/backfill`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(
          `Archive backfill failed (${response.status}): ${await response.text()}`,
        );
      }
      const result = decodeBackfillResponse(await response.json());
      totalProcessed += result.processed;
      console.log(
        `Archive storage backfill: ${totalProcessed} ported, ${result.remaining} remaining.`,
      );
      if (result.remaining === 0) return 0;
      if (result.processed === 0) {
        throw new Error("Archive backfill made no progress");
      }
    }
    throw new Error("Archive backfill exceeded its batch limit");
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    worker.kill();
    await worker.exited;
  }
}

if (import.meta.main) {
  const exitCode = await backfillRemoteArchiveStorage();
  if (exitCode !== 0) process.exitCode = exitCode;
}
