import { describe, expect, it } from "vitest";
import { blobId } from "./git-objects";
import { VaultRepoNotFoundError, type VaultSnapshot, type VaultWritePlan } from "./git-store";
import { InMemoryVaultGitStore } from "./in-memory-git-store";

const commitFiles = (files: Record<string, string>, message = "m", timestamp = 1_760_000_000) =>
  async (): Promise<VaultWritePlan<null>> => ({
    kind: "commit", files: new Map(Object.entries(files)), message, timestamp, value: null,
  });

const extend = (path: string, content: string) => async (head: VaultSnapshot): Promise<VaultWritePlan<null>> => ({
  kind: "commit", files: new Map([...head.files, [path, content]]), message: `add ${path}`, timestamp: 1_760_000_000, value: null,
});

async function committed(store: InMemoryVaultGitStore, repo: string, plan: (head: VaultSnapshot) => Promise<VaultWritePlan<null>>) {
  const outcome = await store.write(repo, plan);
  if (outcome.kind !== "committed") throw new Error(`expected a commit, got ${outcome.kind}`);
  return outcome.commit;
}

describe("InMemoryVaultGitStore", () => {
  it("keeps history readable by commit and reports first-parent log newest first", async () => {
    const store = new InMemoryVaultGitStore();
    await store.createRepo("r");
    expect(await store.head("r")).toBeNull();
    const first = await committed(store, "r", commitFiles({ "a.md": "one\n" }, "first"));
    const second = await committed(store, "r", extend("a.md", "two\n"));
    expect(await store.head("r")).toBe(second);
    expect(await store.readFile("r", first, "a.md")).toBe("one\n");
    expect(await store.readFile("r", second, "a.md")).toBe("two\n");
    expect(await store.readFile("r", second, "missing.md")).toBeNull();
    const history = await store.history("r", { stopAt: null, limit: 10 });
    expect(history.map((commit) => commit.oid)).toEqual([second, first]);
    expect(history[1].message.trim()).toBe("first");
    expect((await store.history("r", { stopAt: first, limit: 10 })).map((commit) => commit.oid)).toEqual([second]);
    expect((await store.snapshot("r", first)).files).toEqual(new Map([["a.md", "one\n"]]));
  });

  it("rejects a write whose observed head moved: compare-and-swap, never force", async () => {
    const store = new InMemoryVaultGitStore();
    await store.createRepo("r");
    await committed(store, "r", commitFiles({ "a.md": "base\n" }));
    let interleaved = false;
    store.hooks.beforePush = async () => {
      if (interleaved) return;
      interleaved = true;
      store.hooks.beforePush = undefined;
      await committed(store, "r", extend("b.md", "competitor\n"));
    };
    const outcome = await store.write("r", extend("c.md", "late\n"));
    expect(outcome.kind).toBe("conflict");
    const head = await store.snapshot("r");
    expect([...head.files.keys()].sort()).toEqual(["a.md", "b.md"]);
    // Re-running on the new head keeps the competitor's change.
    await committed(store, "r", extend("c.md", "late\n"));
    expect([...(await store.snapshot("r")).files.keys()].sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("serializes concurrent writers so exactly one wins per head", async () => {
    const store = new InMemoryVaultGitStore();
    await store.createRepo("r");
    await committed(store, "r", commitFiles({ "a.md": "base\n" }));
    const outcomes = await Promise.all(Array.from({ length: 4 }, (_, index) => store.write("r", extend(`w${index}.md`, "x\n"))));
    expect(outcomes.filter((outcome) => outcome.kind === "committed")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.kind === "conflict")).toHaveLength(3);
  });

  it("rewrites history without forgotten paths, keeping re-created content after the forget", async () => {
    const store = new InMemoryVaultGitStore();
    await store.createRepo("g1");
    await committed(store, "g1", commitFiles({ "README.md": "r\n" }));
    const secret = "the secret record\n";
    const withSecret = await committed(store, "g1", extend("entities/people/x.md", secret));
    await committed(store, "g1", extend("facts.md", "kept\n"));
    const forget = await committed(store, "g1", async (head) => {
      const files = new Map(head.files);
      files.delete("entities/people/x.md");
      return { kind: "commit", files, message: "memory: forget x\n\nBriar-Record: x", timestamp: 1_760_000_000, value: null };
    });
    await committed(store, "g1", extend("entities/people/x.md", "re-created later\n"));
    const sourceTree = await store.headTree("g1");

    const result = await store.rewrite("g1", "g2", {
      drops: new Map([["entities/people/x.md", new Set([forget])]]),
      scrubMessage: (message, dropped) => (dropped.size ? message.replace(/\bx\b/gu, "[forgotten]") : message),
    });
    expect(result.sourceHeadTree).toBe(sourceTree);
    expect(await store.headTree("g2")).toBe(sourceTree);
    const rewritten = await store.history("g2", { stopAt: null, limit: 50 });
    // The commits that only added or removed the forgotten file became empty and
    // were dropped; the re-creation after the forget survives.
    expect(rewritten).toHaveLength(3);
    expect(rewritten.some((commit) => commit.message.includes("forget x"))).toBe(false);
    expect(await store.readFile("g2", result.head!, "entities/people/x.md")).toBe("re-created later\n");
    expect(result.mapping.get(withSecret)).toBeDefined();
    expect(await store.readFile("g2", result.mapping.get(withSecret)!, "entities/people/x.md")).toBeNull();
    const secretBlob = await blobId(secret);
    expect(await store.holdsObject("g2", secretBlob)).toBe(false);

    // History rewriting alone does not purge: the old repository still serves it.
    expect(await store.readFile("g1", withSecret, "entities/people/x.md")).toBe(secret);
    expect(await store.holdsObject("g1", secretBlob)).toBe(true);
    expect(await store.deleteRepo("g1")).toBe(true);
    await expect(store.readFile("g1", withSecret, "entities/people/x.md")).rejects.toBeInstanceOf(VaultRepoNotFoundError);
    expect(await store.repoExists("g1")).toBe(false);
  });
});
