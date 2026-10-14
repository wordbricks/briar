/**
 * Local-only admin Worker for the memory vault e2e check. Runs under
 * `wrangler dev` next to the API Worker with a remote `MEMORY_ARTIFACTS`
 * binding on the e2e namespace (`briar-memory-e2e`, never `briar-memory`) and
 * reads the vault repositories directly through the production
 * `ArtifactsVaultGitStore`: list, existence, every commit's files, deletion.
 * Never deployed.
 */
import { ArtifactsVaultGitStore } from "../../apps/briar/worker/src/memory-vault/artifacts-git-store";

type AdminEnv = {
  readonly MEMORY_ARTIFACTS: ConstructorParameters<typeof ArtifactsVaultGitStore>[0];
  readonly ADMIN_TOKEN: string;
  readonly E2E_NAMESPACE: string;
};

const json = (value: unknown, status = 200) => Response.json(value, { status });

export default {
  async fetch(request: Request, env: AdminEnv): Promise<Response> {
    if (!env.ADMIN_TOKEN || request.headers.get("authorization") !== `Bearer ${env.ADMIN_TOKEN}`) {
      return new Response("Not found", { status: 404 });
    }
    if (env.E2E_NAMESPACE !== "briar-memory-e2e") return json({ error: "wrong namespace" }, 500);
    const store = new ArtifactsVaultGitStore(env.MEMORY_ARTIFACTS);
    const url = new URL(request.url);
    const name = url.searchParams.get("name") ?? "";
    try {
      switch (url.pathname) {
        case "/list":
          return json({ repos: (await store.listRepos()).map((repo) => repo.name) });
        case "/exists":
          return json({ name, exists: await store.repoExists(name) });
        case "/delete":
          return json({ name, deleted: await store.deleteRepo(name) });
        case "/history": {
          // Every commit with every file it holds: the repositories are tiny.
          const commits = await store.history(name, { stopAt: null, limit: 200 });
          const out = [];
          for (const commit of commits) {
            const snapshot = await store.snapshot(name, commit.oid);
            out.push({ oid: commit.oid, message: commit.message, files: Object.fromEntries(snapshot.files) });
          }
          return json({ name, commits: out });
        }
        case "/selftest": {
          // Checks that this dev bridge can carry every store call the vault makes.
          const repo = `mv-e2e-selftest-${crypto.randomUUID().slice(0, 8)}-g1`;
          const steps: Record<string, unknown> = {};
          try {
            await store.createRepo(repo);
            const outcome = await store.write(repo, async (head) => ({
              kind: "commit", files: new Map([["a.md", "hello"]]), message: "selftest\n",
              timestamp: Math.floor(Date.now() / 1000), value: head.commit,
            }));
            steps.write = outcome.kind;
            const head = await store.head(repo);
            try { steps.readFile = await store.readFile(repo, head!, "a.md"); } catch (error) { steps.readFile = String(error); }
            try { steps.snapshot = [...(await store.snapshot(repo)).files.keys()]; } catch (error) { steps.snapshot = String(error); }
          } finally {
            steps.deleted = await store.deleteRepo(repo).catch((error) => String(error));
          }
          return json(steps);
        }
        default:
          return json({ error: "unknown route" }, 404);
      }
    } catch (error) {
      return json({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }, 500);
    }
  },
};
