/**
 * Throwaway Worker for the memory vault live check
 * (docs/operations/memory-vault.md, "Live check"). It bundles the production
 * `ArtifactsVaultGitStore` unchanged and drives it against real Cloudflare
 * Artifacts in its own namespace (`briar-memory-live-check`, never the
 * production `briar-memory`). `scripts/memory-vault-live-check.ts` deploys it
 * under a random name, calls it once and deletes it.
 *
 * Every repository it creates is named `mv-live-<random>-…` and deleted before
 * the response is sent, pass or fail.
 */
import { ArtifactsVaultGitStore } from "../../apps/briar/worker/src/memory-vault/artifacts-git-store";
import {
  VaultCommitNotFoundError,
  VaultRepoNotFoundError,
  type VaultSnapshot,
  type VaultWritePlan,
} from "../../apps/briar/worker/src/memory-vault/git-store";

type CheckEnv = {
  readonly MEMORY_ARTIFACTS: ConstructorParameters<typeof ArtifactsVaultGitStore>[0];
  readonly CHECK_TOKEN: string;
};

type Step = { name: string; ok: boolean; ms: number; detail?: unknown; error?: string };

class CheckFailed extends Error {}

function expectThat(condition: boolean, message: string): asserts condition {
  if (!condition) throw new CheckFailed(message);
}

const sleep = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const commitPlan = (files: Record<string, string>, message: string, delayMs = 0) =>
  async (head: VaultSnapshot): Promise<VaultWritePlan<string | null>> => {
    if (delayMs) await sleep(delayMs);
    const next = new Map(head.files);
    for (const [path, content] of Object.entries(files)) {
      if (content === "") next.delete(path);
      else next.set(path, content);
    }
    return { kind: "commit", files: next, message, timestamp: Math.floor(Date.now() / 1000), value: head.commit };
  };

async function runCheck(env: CheckEnv) {
  const store = new ArtifactsVaultGitStore(env.MEMORY_ARTIFACTS);
  const prefix = `mv-live-${crypto.randomUUID().slice(0, 8)}`;
  const source = `${prefix}-g1`;
  const target = `${prefix}-g2`;
  const steps: Step[] = [];
  const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    const started = Date.now();
    try {
      const detail = await fn();
      steps.push({ name, ok: true, ms: Date.now() - started, detail });
      return detail;
    } catch (error) {
      steps.push({ name, ok: false, ms: Date.now() - started,
        error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
      return undefined;
    }
  };
  const secret = `forget-me-${crypto.randomUUID().slice(0, 8)}`;
  try {
    await step("createRepo", () => store.createRepo(source));
    await step("createRepo is idempotent", () => store.createRepo(source));
    await step("repoExists", async () => expectThat(await store.repoExists(source), "the new repository is missing"));
    await step("head of an empty repository is null", async () => expectThat(await store.head(source) === null, "head is not null"));
    await step("snapshot of an empty repository", async () => {
      const snapshot = await store.snapshot(source);
      expectThat(snapshot.commit === null && snapshot.files.size === 0, "an empty repository has files");
    });
    const first = await step("write 1", async () => {
      const outcome = await store.write(source, commitPlan({ "README.md": "# readme\n", "knowledge/facts/a.md": "A v1\n" }, "w1\n"));
      expectThat(outcome.kind === "committed", `write 1 was ${outcome.kind}`);
      return outcome.commit;
    });
    await step("write 2 sees write 1 as head", async () => {
      const outcome = await store.write(source, commitPlan({ "knowledge/facts/a.md": "A v2\n", "knowledge/facts/forget.md": `${secret}\n` }, "w2\n"));
      expectThat(outcome.kind === "committed" && outcome.value === first, "write 2 did not build on write 1");
      return outcome.commit;
    });
    const concurrent = await step("concurrent writers: one commits, the other gets a conflict", async () => {
      const outcomes = await Promise.all([
        store.write(source, commitPlan({ "timeline/daily/2026-10-13.md": "- 10:00 | one\n" }, "x1\n", 1_500)),
        store.write(source, commitPlan({ "timeline/daily/2026-10-13.md": "- 10:00 | two\n" }, "x2\n", 1_500)),
      ]);
      const kinds = outcomes.map((outcome) => outcome.kind).sort();
      expectThat(JSON.stringify(kinds) === JSON.stringify(["committed", "conflict"]),
        `expected one commit and one conflict, got ${kinds.join(", ")}`);
      const committed = outcomes.find((outcome) => outcome.kind === "committed");
      return committed?.kind === "committed" ? committed.commit : null;
    });
    await step("head is the winning commit", async () => expectThat(await store.head(source) === concurrent, "head moved elsewhere"));
    const head = await store.head(source).catch(() => null);
    await step("readFile at head", async () => expectThat(await store.readFile(source, head!, "knowledge/facts/a.md") === "A v2\n", "wrong head content"));
    await step("readFile at an old commit", async () => expectThat(await store.readFile(source, first!, "knowledge/facts/a.md") === "A v1\n", "wrong old content"));
    await step("readFile of a missing path is null", async () => expectThat(await store.readFile(source, head!, "missing.md") === null, "missing path returned content"));
    await step("readFile at an unknown commit is null or not found", async () => {
      try {
        expectThat(await store.readFile(source, "0".repeat(40), "knowledge/facts/a.md") === null, "unknown commit returned content");
      } catch (error) {
        expectThat(error instanceof VaultCommitNotFoundError, `unexpected ${String(error)}`);
      }
    });
    await step("snapshot at head and at an old commit", async () => {
      const now = await store.snapshot(source);
      const old = await store.snapshot(source, first!);
      expectThat(now.commit === head && now.files.has("knowledge/facts/forget.md"), "head snapshot is wrong");
      expectThat(old.files.size === 2 && old.files.get("knowledge/facts/a.md") === "A v1\n", "old snapshot is wrong");
      return { head: [...now.files.keys()].sort(), old: [...old.files.keys()].sort() };
    });
    await step("history newest first, stopAt excluded", async () => {
      const all = await store.history(source, { stopAt: null, limit: 10 });
      const since = await store.history(source, { stopAt: first!, limit: 10 });
      expectThat(all.length === 3 && all.at(-1)!.oid === first, "full history is wrong");
      expectThat(since.length === 2 && !since.some((commit) => commit.oid === first), "stopAt was not excluded");
      return all.map((commit) => commit.message.trim());
    });
    await step("a skipped plan writes nothing", async () => {
      const outcome = await store.write(source, async () => ({ kind: "skip", value: 1 }));
      expectThat(outcome.kind === "skipped" && outcome.head === head, "skip moved or misreported head");
    });
    const forgetCommit = await step("forget commit removes the file", async () => {
      const outcome = await store.write(source, commitPlan({ "knowledge/facts/forget.md": "" }, "memory: forget forget\n"));
      expectThat(outcome.kind === "committed", `forget was ${outcome.kind}`);
      return outcome.commit;
    });
    const rewritten = await step("rewrite into the next generation without the forgotten file", async () => {
      const result = await store.rewrite(source, target, {
        drops: new Map([["knowledge/facts/forget.md", new Set([forgetCommit!])]]),
        scrubMessage: (message) => message,
      });
      expectThat(result.sourceHead === forgetCommit, "the rewrite did not start from the forget commit");
      expectThat(result.headTree === result.sourceHeadTree, "the rebuilt head tree differs from the source");
      return { sourceHead: result.sourceHead, head: result.head, commits: result.mapping.size };
    });
    await step("target head tree equals the source head tree", async () => {
      const [sourceTree, targetTree] = await Promise.all([store.headTree(source), store.headTree(target)]);
      expectThat(sourceTree !== null && sourceTree === targetTree, "head trees differ");
    });
    await step("no commit of the target holds the forgotten text", async () => {
      for (const commit of await store.history(target, { stopAt: null, limit: 20 })) {
        const snapshot = await store.snapshot(target, commit.oid);
        for (const content of snapshot.files.values()) expectThat(!content.includes(secret), `commit ${commit.oid} still holds it`);
      }
    });
    await step("deleting the old generation purges it", async () => {
      expectThat(await store.deleteRepo(source), "delete reported nothing deleted");
      expectThat(!await store.repoExists(source), "the deleted repository still exists");
      try {
        await store.readFile(source, first!, "knowledge/facts/forget.md");
        throw new CheckFailed("an object of the deleted repository is still readable");
      } catch (error) {
        expectThat(error instanceof VaultRepoNotFoundError, `unexpected ${String(error)}`);
      }
    });
    await step("listRepos shows only the new generation", async () => {
      const names = (await store.listRepos()).map((repo) => repo.name).filter((name) => name.startsWith(prefix));
      expectThat(JSON.stringify(names) === JSON.stringify([target]), `listed ${names.join(", ")}`);
    });
    void rewritten;
  } finally {
    await step("cleanup", async () => {
      await store.deleteRepo(source).catch(() => false);
      await store.deleteRepo(target).catch(() => false);
      const left = (await store.listRepos()).filter((repo) => repo.name.startsWith(prefix)).map((repo) => repo.name);
      expectThat(left.length === 0, `left behind ${left.join(", ")}`);
    });
  }
  return { ok: steps.every((entry) => entry.ok), prefix, steps };
}

export default {
  async fetch(request: Request, env: CheckEnv): Promise<Response> {
    const expected = `Bearer ${env.CHECK_TOKEN}`;
    if (!env.CHECK_TOKEN || request.headers.get("authorization") !== expected) {
      return new Response("Not found", { status: 404 });
    }
    return Response.json(await runCheck(env));
  },
};
