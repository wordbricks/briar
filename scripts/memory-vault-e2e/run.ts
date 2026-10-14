/**
 * Memory vault end-to-end check: the real `briar-api` Worker under
 * `wrangler dev` with a remote Cloudflare Artifacts binding, real Worker CLI
 * code and real `claude -p` model sessions. Nothing production is touched.
 *
 *   export CLOUDFLARE_ACCOUNT_ID=459bc0fca39fa1adab8aed615098fcaf
 *   bun scripts/memory-vault-e2e/run.ts [--out docs/operations/evidence/memory-vault-e2e-<date>.md] [--model <alias>]
 *
 * Prerequisites
 * * `bun install` done (uses apps/briar/node_modules/.bin/wrangler, 4.127+,
 *   which supports `remote: true` Artifacts bindings in `wrangler dev`).
 * * `wrangler login` on the account above. The `artifacts:write` OAuth scope is
 *   NOT needed: only the dev servers' remote binding talks to Artifacts.
 * * `claude` (Claude Code CLI) on PATH and signed in; each model session costs
 *   a few cents.
 * * Free local ports 8799/9799 (API Worker) and 8795/9795 (admin Worker).
 *
 * What it does (docs/operations/memory-vault.md; goals 1–9 of the e2e plan):
 * 1. Generates a dev config from apps/briar/wrangler.jsonc (dev-config.ts:
 *    `MEMORY_ARTIFACTS` → namespace `briar-memory-e2e`, vault on, AI/Vectorize/
 *    routes/assets dropped, everything else local), applies every migration to
 *    a private persist dir, starts the API Worker and a local admin Worker
 *    (artifacts-admin-worker.ts) on the same namespace.
 * 2. Seeds two people, a workspace, a project and a Worker (seed.ts); creates
 *    the Agent, both DMs and the group channel and turns DM memory on through
 *    the real RPCs.
 * 3–7. Each reply is posted by the person through ChannelService and claimed
 *    by a separate Worker process (session.ts) through ClaimWork.
 * 8. Forgets through DmMemoryService as the owner and runs the minute cron.
 * 9. Deletes every repository in the namespace and confirms it is empty.
 *
 * Exits 1 if any assertion fails. Results: scripts/memory-vault-e2e/.work/.
 */
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { e2eNamespace } from "./dev-config";
import { appClients, type Check, d1, readmeSha256, redact, repoRoot, saveState, sha256Hex, workDirectory } from "./lib";
import { enableDmMemory, heartbeat, seed } from "./seed";
import { admin, prepareApi, startServers, triggerMinuteCron, wranglerVersion, type Servers } from "./servers";

const args = process.argv.slice(2);
const outPath = args.includes("--out") ? resolve(args[args.indexOf("--out") + 1]!) : null;
const model = args.includes("--model") ? args[args.indexOf("--model") + 1]! : null;

const checks: Check[] = [];
const timeline: Array<{ step: string; ms: number }> = [];
const check = (goal: string, name: string, ok: boolean, detail?: unknown) => {
  checks.push({ goal, name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${goal}] ${name}${detail === undefined ? "" : ` — ${redact(JSON.stringify(detail)).slice(0, 300)}`}`);
};
const step = async <T>(name: string, fn: () => Promise<T>) => {
  const started = performance.now();
  console.log(`== ${name}`);
  try { return await fn(); } finally { timeline.push({ step: name, ms: Math.round(performance.now() - started) }); }
};

type ToolRun = { argv: string[]; exit: number | null; output: any };
type SessionResult = Record<string, any> & { error?: string };

async function session(label: string, scenario: string, triggerMessageId: string, extra?: string): Promise<SessionResult> {
  const resultPath = join(workDirectory, `${label}.json`);
  const code = await new Promise<number | null>((resolveExit) => {
    const child = spawn("bun", [join(import.meta.dir, "session.ts"), scenario, triggerMessageId, resultPath, ...(extra ? [extra] : [])],
      { cwd: repoRoot, env: process.env, stdio: ["ignore", "inherit", "inherit"] });
    child.once("exit", resolveExit);
  });
  const result = JSON.parse(await readFile(resultPath, "utf8").catch(() => "{}")) as SessionResult;
  if (code !== 0 && !result.error) result.error = `session exited ${code}`;
  return result;
}

async function post(token: string, workspaceId: string, channelId: string, body: string, mentionAgentId?: string) {
  const response = await appClients(token).channels.createChannelMessage({
    workspaceId, channelId, clientMessageId: crypto.randomUUID(), body,
    mentionedUserIds: [], mentionedAgentIds: mentionAgentId ? [mentionAgentId] : [],
  });
  if (response.agentReplies.length !== 1) throw new Error(`expected one Agent reply job, got ${response.agentReplies.length}`);
  return response.message!.id;
}

const leakPattern = /tools memory|knowledge\/|entities\/|timeline\/|\.md\b|voice-guide|README|Artifacts|vault|저장소|파일|메모리 도구/iu;

let servers: Servers | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
/** Raw results for results.json and the evidence, one entry per step. */
const results = new Map<string, unknown>([["versions", {
  wrangler: wranglerVersion,
  claudeCode: Bun.spawnSync(["claude", "--version"]).stdout.toString().trim(),
  bun: Bun.version,
}]]);
const startedAt = new Date();
try {
  const readmeText = await readFile(join(repoRoot, "apps/briar/worker/src/memory-vault/memory-vault-readme.md"), "utf8");
  check("7", "README file hash is the pinned one", sha256Hex(readmeText) === readmeSha256, sha256Hex(readmeText));

  // ── 1. Servers ──────────────────────────────────────────────────────────
  const adminToken = crypto.randomUUID().replaceAll("-", "");
  await step("build memory-tools bundle", async () => {
    const built = Bun.spawnSync(["bun", "build", "apps/briar/src-agent/memory-tools.ts", "--target=bun",
      "--outfile", join(workDirectory, "memory-tools.js")], { cwd: repoRoot });
    if (built.exitCode !== 0) throw new Error(built.stderr.toString());
  });
  const configPath = await step("generate config + apply migrations (local D1)", prepareApi);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  check("1", "dev config binds MEMORY_ARTIFACTS to the e2e namespace (remote) and turns the vault on",
    config.artifacts?.length === 1 && config.artifacts[0].namespace === e2eNamespace && config.artifacts[0].remote === true &&
      config.vars.MEMORY_VAULT_ENABLED === "true",
    config.artifacts);
  check("1", "no production-only remote bindings in the dev config (AI, Vectorize, routes)",
    !config.ai && !config.vectorize && !config.routes && JSON.stringify(config).includes("briar-memory\"") === false);
  servers = await step("start wrangler dev (API + admin)", () => startServers({ configPath, adminToken }));
  const leftovers = (await admin<{ repos: string[] }>(adminToken, "/list")).repos;
  for (const name of leftovers) await admin(adminToken, "/delete", name);
  results.set("preexistingRepos", leftovers);
  check("1", "the e2e namespace starts empty (leftovers from an earlier run deleted)",
    (await admin<{ repos: string[] }>(adminToken, "/list")).repos.length === 0, { deletedLeftovers: leftovers.length });
  const selftest = await admin<{ write: string; readFile: string; snapshot: string[]; deleted: boolean }>(adminToken, "/selftest");
  check("1", "the dev remote binding carries create, push, readFile, clone and delete (production ArtifactsVaultGitStore)",
    selftest.write === "committed" && selftest.readFile === "hello" && selftest.snapshot?.[0] === "a.md" && selftest.deleted === true, selftest);

  // ── 2. Seed ─────────────────────────────────────────────────────────────
  const state = await step("seed (raw people/org/project/worker + RPC agent/channels/settings)", seed);
  await saveState({ ...state, adminToken });
  // A real Worker heartbeats all the time; a stale heartbeat refuses claims.
  await heartbeat(state);
  heartbeatTimer = setInterval(() => void heartbeat(state).catch((error) => console.error(`heartbeat failed: ${error}`)), 15_000);
  const optInA = await enableDmMemory(state.userA.token, state.workspaceId, state.dmA);
  const optInB = await enableDmMemory(state.userB.token, state.workspaceId, state.dmB);
  check("2", "A's and B's DMs are eligible DM memory spaces with recall + automatic writing on",
    optInA.eligible && optInB.eligible && optInA.space?.useEnabled === true && optInA.space?.autoEnabled === true &&
      optInB.space?.useEnabled === true, { spaceA: optInA.space?.id, spaceB: optInB.space?.id });

  // ── 3. Session 1 ────────────────────────────────────────────────────────
  const s1Message = "내가 좋아하는 커피는 콜드브루 디카페인이야. 기억해 줘. 그리고 앞으로 나한테 답할 땐 항상 존댓말로 짧게 해줘.";
  results.set("session1Message", s1Message);
  const s1 = await step("session 1 (Worker process 1, claude -p)", async () =>
    session("session-1", "model", await post(state.userA.token, state.workspaceId, state.dmA, s1Message), model ?? undefined));
  results.set("session1", s1);
  check("3", "session 1 ran without error", !s1.error, s1.error);
  check("3", "claim carried no legacy DM memory descriptor; the vault context was served", s1.legacyMemoryDescriptor === "none" && s1.hasVault === true,
    { scope: s1.context?.scopeKind, status: s1.context?.status });
  check("3", "instructions = Briar context + memory section; prompt starts with the vault tags; tools first on PATH",
    typeof s1.instructions === "string" && s1.instructions.indexOf("# Memory vault") > 0 &&
      String(s1.prompt).startsWith("<voice-memory>") && s1.toolsOnPath === true);
  const s1Calls: Array<{ command: string; output?: string }> = s1.toolCalls ?? [];
  // The model may chain several `tools memory …` calls in one shell command.
  const saves = s1Calls.filter((call) => /(^|[;&|\n]\s*)tools memory save\b/u.test(call.command));
  const journals = s1Calls.filter((call) => /(^|[;&|\n]\s*)tools memory journal\b/u.test(call.command));
  check("3", "the model called `tools memory save` successfully", saves.some((call) => /"revision":\d+,"commit"/u.test(call.output ?? "")),
    saves.flatMap((call) => call.command.split("\n").filter((line) => line.includes("tools memory save"))));
  check("3", "the model called `tools memory journal` successfully", journals.some((call) => /"line":/u.test(call.output ?? "")),
    journals.flatMap((call) => call.command.split("\n").filter((line) => line.includes("tools memory journal"))));
  check("3", "no tool call was denied", (s1.permissionDenials ?? []).length === 0, s1.permissionDenials);

  const vaultRow = (await d1<{ id: string; repo_name: string; generation: number; head_commit: string; scope_kind: string }>(
    `select v.id, v.repo_name, v.generation, v.head_commit, v.scope_kind from briar_memory_vaults v
     join briar_dm_memory_spaces s on s.id = v.dm_space_id where s.channel_id = ?`, [state.dmA]))[0];
  results.set("vaultA", vaultRow);
  check("3", "A's DM vault row exists in D1 with a head commit", Boolean(vaultRow?.head_commit), vaultRow);
  const history1 = await admin<{ commits: Array<{ oid: string; message: string; files: Record<string, string> }> }>(adminToken, "/history", vaultRow!.repo_name);
  const head1 = history1.commits[0]!;
  results.set("repoAfterSession1", { commits: history1.commits.map((commit) => ({ oid: commit.oid, subject: commit.message.split("\n")[0] })), headFiles: head1.files });
  const coffeeFile = Object.entries(head1.files).find(([path, content]) => !path.startsWith("timeline/") && content.includes("콜드브루"));
  const dailyFile = Object.entries(head1.files).find(([path]) => /^timeline\/daily\/\d{4}-\d{2}-\d{2}\.md$/u.test(path));
  const voiceGuideFile = head1.files["knowledge/preferences/voice-guide.md"];
  check("3", "git store (direct): a record holds the coffee fact", Boolean(coffeeFile), coffeeFile?.[0]);
  check("3", "git store (direct): the daily journal has a `- HH:MM | …` line", Boolean(dailyFile && /^- \d{2}:\d{2} \| .+/mu.test(dailyFile[1])), dailyFile?.[0]);
  check("3", "git store (direct): voice-guide has the stated rule with `(user, <date>)`",
    Boolean(voiceGuideFile && /존댓말.*\(user, \d{4}-\d{2}-\d{2}\)/u.test(voiceGuideFile)), voiceGuideFile);
  check("3", "git store (direct): every commit carries Briar trailers",
    history1.commits.every((commit) => commit.message.includes("Briar-Operation:") && commit.message.includes("Briar-Vault:")));
  const readsAfter: ToolRun[] = s1.afterReads ?? [];
  check("3", "vault read RPC (tools memory read) returns the coffee record and the voice guide",
    readsAfter.some((run) => String(run.output?.body ?? "").includes("콜드브루")) &&
      readsAfter.some((run) => run.output?.id === "voice-guide" && /\(user, /u.test(String(run.output?.body ?? ""))),
    readsAfter.map((run) => ({ id: run.output?.id, revision: run.output?.revision })));
  const indexRows = await d1<{ record_id: string; record_type: string; path: string; revision: number }>(
    `select record_id, record_type, path, revision from briar_memory_vault_records where vault_id = ? and deleted_at is null order by path`, [vaultRow!.id]);
  const revisionRows = await d1<{ n: number }>(`select count(*) as n from briar_memory_vault_revisions where vault_id = ?`, [vaultRow!.id]);
  results.set("indexAfterSession1", { records: indexRows, revisions: revisionRows[0]?.n });
  check("3", "D1 index rows match the repository (records + revisions)",
    indexRows.some((row) => row.path === coffeeFile?.[0]) && indexRows.some((row) => row.path === dailyFile?.[0]) &&
      indexRows.some((row) => row.record_id === "voice-guide") && Number(revisionRows[0]?.n) >= indexRows.length, indexRows);
  check("6", "a finished claim (session 1 after completion) gets claim_inactive", s1.finishedClaim?.code === "claim_inactive", s1.finishedClaim);
  check("3", "the reply completed through CompleteChannelReply", s1.completion?.ok === true, s1.completion);

  // ── 7. README in the instructions ──────────────────────────────────────
  check("7", "instructions contain the server README byte for byte",
    typeof s1.instructions === "string" && s1.instructions.includes(readmeText) && s1.context?.readmeSha256 === readmeSha256);

  // ── 4. Session 2 ────────────────────────────────────────────────────────
  const s2 = await step("session 2 (Worker process 2, fresh claude -p)", async () =>
    session("session-2", "model", await post(state.userA.token, state.workspaceId, state.dmA, "내가 좋아하는 커피 뭐였지?"), model ?? undefined));
  results.set("session2", s2);
  check("4", "session 2 ran without error", !s2.error, s2.error);
  check("4", "session 2 is a brand-new model session (no resume)", Boolean(s2.modelSessionId) && s2.modelSessionId !== s1.modelSessionId,
    { s1: s1.modelSessionId, s2: s2.modelSessionId });
  check("4", "the prompt prefix carried <voice-guide> with the saved rule",
    /<voice-guide>[\s\S]*존댓말[\s\S]*\(user, \d{4}-\d{2}-\d{2}\)[\s\S]*<\/voice-guide>/u.test(String(s2.promptPrefix)), s2.context?.voiceGuide);
  const s2Calls: Array<{ command: string; output?: string }> = s2.toolCalls ?? [];
  const retrieved = s2Calls.some((call) => /(^|[;&|\n]\s*)tools memory (read|search|list)\b/u.test(call.command) && (call.output ?? "").includes("콜드브루"));
  check("4", "the model retrieved the fact through `tools memory`", retrieved, s2Calls.map((call) => call.command.split("\n")[0]));
  const answer = String(s2.answer ?? "");
  check("4", "the answer states the fact (콜드브루 디카페인)", /콜드\s?브루/u.test(answer) && /디카페인/u.test(answer), answer);
  check("4", "the answer does not expose files, paths, tools or storage", !leakPattern.test(answer), answer);
  check("4", "the answer follows the saved reply rule (polite form, short)", /(요|니다)[.!?~]?\s*$/u.test(answer.trim()) && answer.length <= 200, answer);
  check("4", "citations (if any) were accepted by completion", s2.completion?.ok === true, { citations: s2.citations, completion: s2.completion });

  // ── 5. Revisions, conflicts, pagination, journal dedupe; 7. README save ─
  const rv = await step("direct tools memory invocations (Worker process 3)", async () =>
    session("revisions", "revisions", await post(state.userA.token, state.workspaceId, state.dmA, "e2e: 메모리 점검 턴")));
  results.set("revisions", rv);
  const s = rv.steps ?? {};
  check("5", "revisions scenario ran without error", !rv.error, rv.error);
  check("5", "update with the right --expected-revision commits revision n+1",
    s.updateWithRevision?.exit === 0 && s.updateWithRevision.output.revision === s.readBefore?.output?.revision + 1,
    { before: s.readBefore?.output?.revision, after: s.updateWithRevision?.output });
  check("5", "a stale save gets revision_conflict with the current revision",
    s.staleSave?.exit === 1 && s.staleSave.output?.error?.code === "revision_conflict" &&
      s.staleSave.output.error.current_revision === s.updateWithRevision?.output?.revision, s.staleSave?.output);
  check("5", "read --revision 1 returns the first body",
    s.readRevision1?.exit === 0 && s.readRevision1.output.revision === 1 && s.readRevision1.output.latest === false &&
      String(s.readRevision1.output.body).includes("콜드브루") && !String(s.readRevision1.output.body).includes("e2e 업데이트"),
    { revision: s.readRevision1?.output?.revision, latest: s.readRevision1?.output?.latest });
  const pages: ToolRun[] = s.searchPages ?? [];
  check("5", "search --limit 1 paginates through next_cursor to null",
    pages.length >= 3 && pages.every((page) => page.exit === 0 && page.output.hits.length === 1) &&
      pages.slice(0, -1).every((page) => typeof page.output.next_cursor === "string") && pages.at(-1)!.output.next_cursor === null,
    pages.map((page) => ({ hit: page.output?.hits?.[0]?.id, next: page.output?.next_cursor ? "cursor" : null })));
  check("5", "journal retry with the same request id is deduplicated (replayed, same commit)",
    s.journalSameRequestId?.second?.replayed === true && s.journalSameRequestId.second.commit === s.journalSameRequestId.first.commit,
    s.journalSameRequestId);
  check("5", "an identical journal line within the same minute is deduplicated",
    s.journalToolSecond?.output?.deduplicated === true && s.journalToolSecond.output.commit === s.journalToolFirst?.output?.commit,
    { first: s.journalToolFirst?.output, second: s.journalToolSecond?.output });
  check("7", "`tools memory save readme …` is refused (readme_read_only)",
    s.readmeSave?.exit === 1 && s.readmeSave.output?.error?.code === "readme_read_only", s.readmeSave?.output);
  check("7", "`tools memory read README.md` serves the server README byte for byte",
    sha256Hex(String(s.readmeRead?.output?.body ?? "")) === readmeSha256);
  const coffeeId: string = rv.coffeeRecordId;

  // ── 6. Isolation ────────────────────────────────────────────────────────
  const isoB = await step("isolation: user B's DM claim", async () =>
    session("isolation-b", "isolation", await post(state.userB.token, state.workspaceId, state.dmB, "e2e: 격리 점검"), coffeeId));
  const isoGroup = await step("isolation: group channel claim", async () =>
    session("isolation-group", "isolation", await post(state.userA.token, state.workspaceId, state.group, "@Mori e2e: 그룹 격리 점검", state.agentId), coffeeId));
  results.set("isolation", { b: isoB, group: isoGroup });
  for (const [label, iso] of [["user B DM", isoB], ["group channel", isoGroup]] as const) {
    const records: Array<{ id: string }> = iso.list?.output?.records ?? [];
    check("6", `${label}: vault scope is its own (${iso.context?.scopeKind})`, !iso.error && iso.hasVault === true, iso.error ?? iso.context?.scopeKind);
    check("6", `${label}: list shows none of A's records`, iso.list?.exit === 0 && records.every((record) => record.id === "README.md" || record.id === "readme"),
      records.map((record) => record.id));
    check("6", `${label}: search for A's coffee finds nothing`,
      iso.search?.exit === 0 && iso.search.output.hits.length === 0 && iso.searchDecaf?.output?.hits?.length === 0);
    check("6", `${label}: read of A's coffee record is not_found`, iso.read?.exit === 1 && iso.read.output?.error?.code === "not_found", iso.read?.output);
  }
  const expired = await step("expired claim", async () =>
    session("expired", "expire", await post(state.userA.token, state.workspaceId, state.dmA, "e2e: 만료 점검")));
  results.set("expired", expired);
  check("6", "an expired claim gets claim_inactive (tools and RPC)",
    expired.before?.exit === 0 && expired.afterExpiry?.output?.error?.code === "claim_inactive" && expired.afterExpiryRpc?.code === "claim_inactive",
    { tools: expired.afterExpiry?.output, rpc: expired.afterExpiryRpc });

  // ── 8. Forget + purge ──────────────────────────────────────────────────
  const owner = appClients(state.userA.token).dmMemory;
  const forget = async (match: (document: { title: string; body: string; memoryClass: number }) => boolean) => {
    const listed = await owner.listDmMemories({ workspaceId: state.workspaceId, channelId: state.dmA });
    const deleted: Array<{ id: string; title: string; purgeState: string }> = [];
    for (const document of listed.documents) {
      const full = (await owner.getDmMemoryDocument({ workspaceId: state.workspaceId, channelId: state.dmA, documentId: document.id })).document!;
      if (!match({ title: full.title, body: full.body ?? "", memoryClass: full.memoryClass })) continue;
      const response = await owner.deleteDmMemoryDocument({ workspaceId: state.workspaceId, channelId: state.dmA, documentId: document.id });
      deleted.push({ id: document.id, title: full.title, purgeState: response.purgeState });
    }
    return { listed: listed.documents.map((document) => ({ id: document.id, title: document.title, version: document.version })), deleted };
  };
  const runPurge = async (generation: number) => {
    const output = await triggerMinuteCron();
    for (let attempt = 0; attempt < 90; attempt += 1) {
      const rows = await d1<{ completed_at: string | null; last_error: string | null; attempts: number }>(
        `select completed_at, last_error, attempts from briar_memory_vault_purges where vault_id = ? and source_generation = ?`, [vaultRow!.id, generation]);
      if (rows[0]?.completed_at) return { ...rows[0], cron: output.slice(0, 200) };
      if (rows[0]?.last_error && attempt > 20) return { ...rows[0], cron: output.slice(0, 200) };
      await Bun.sleep(2_000);
    }
    return { completed_at: null, last_error: "timeout waiting for the purge", attempts: -1 };
  };
  const scan = async () => {
    const current = (await d1<{ repo_name: string; generation: number; state: string }>(
      `select repo_name, generation, state from briar_memory_vaults where id = ?`, [vaultRow!.id]))[0]!;
    const history = await admin<{ commits: Array<{ oid: string; message: string; files: Record<string, string> }> }>(adminToken, "/history", current.repo_name);
    const holding = history.commits.filter((commit) => Object.values(commit.files).some((content) => content.includes("콜드브루")) ||
      commit.message.includes("콜드브루"));
    return { current, commits: history.commits.length, holding: holding.map((commit) => ({ oid: commit.oid,
      paths: Object.entries(commit.files).filter(([, content]) => content.includes("콜드브루")).map(([path]) => path) })),
      pathEverPresent: history.commits.some((commit) => coffeeFile![0] in commit.files) };
  };
  const forget1 = await step("forget the coffee record (owner dialog)", () =>
    forget((document) => document.body.includes("콜드브루") && document.memoryClass !== 2 /* DM_MEMORY_CLASS_LOG = timeline */ && !/^\d{4}-\d{2}-\d{2}$/u.test(document.title)));
  results.set("forget1", forget1);
  check("8", "the owner dialog deleted the coffee record", forget1.deleted.length === 1, forget1.deleted);
  const generation1 = vaultRow!.generation;
  const purge1 = await step("purge 1 (minute cron)", () => runPurge(generation1));
  const scan1 = await scan();
  const oldGone1 = !(await admin<{ exists: boolean }>(adminToken, "/exists", vaultRow!.repo_name)).exists;
  results.set("purge1", { purge: purge1, scan: scan1, oldRepo: vaultRow!.repo_name, oldGone: oldGone1 });
  check("8", "purge completed and switched to the next generation", Boolean(purge1.completed_at) && scan1.current.generation === generation1 + 1 &&
    scan1.current.state === "active", { purge: purge1, vault: scan1.current });
  check("8", "the old generation repository is gone", oldGone1, vaultRow!.repo_name);
  check("8", "no commit of the new generation contains the coffee record's path", !scan1.pathEverPresent, coffeeFile?.[0]);
  results.set("coffeeOutsideRecord", scan1.holding);
  let finalScan = scan1;
  if (scan1.holding.length > 0) {
    // Spec §10.3: words the agent also wrote into a journal line are a separate
    // record. The owner deletes those too, and a second purge removes them.
    const forget2 = await step("forget the daily journal records mentioning it (owner dialog)", () =>
      forget((document) => document.body.includes("콜드브루")));
    results.set("forget2", forget2);
    const purge2 = await step("purge 2 (minute cron)", () => runPurge(generation1 + 1));
    finalScan = await scan();
    const oldGone2 = !(await admin<{ exists: boolean }>(adminToken, "/exists", scan1.current.repo_name)).exists;
    results.set("purge2", { purge: purge2, scan: finalScan, oldGone: oldGone2 });
    check("8", "second purge completed; previous generation gone", Boolean(purge2.completed_at) && oldGone2, { purge: purge2, vault: finalScan.current });
  }
  check("8", "the final generation has no commit containing the coffee text", finalScan.holding.length === 0, finalScan.holding);

  // ── 9. Cleanup ──────────────────────────────────────────────────────────
  await step("cleanup", async () => {
    await new Promise<void>((resolveStop) => { servers!.api.once("exit", () => resolveStop()); servers!.api.kill("SIGTERM"); setTimeout(resolveStop, 10_000); });
    const repos = (await admin<{ repos: string[] }>(adminToken, "/list")).repos;
    for (const name of repos) await admin(adminToken, "/delete", name);
    const left = (await admin<{ repos: string[] }>(adminToken, "/list")).repos;
    results.set("cleanup", { deleted: repos, left });
    check("9", "every repository in the e2e namespace deleted; namespace empty", left.length === 0, { deleted: repos, left });
  });
} catch (error) {
  check("-", "harness error", false, error instanceof Error ? `${error.name}: ${error.message}\n${error.stack ?? ""}` : String(error));
} finally {
  clearInterval(heartbeatTimer);
  await servers?.stop();
}

const passed = checks.filter((entry) => entry.ok).length;
const summary = { startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(), passed, failed: checks.length - passed, timeline, checks };
await writeFile(join(workDirectory, "results.json"), redact(JSON.stringify({ ...summary, results: Object.fromEntries(results) }, null, 2)));
console.log(`\n${passed}/${checks.length} checks passed; details in ${join(workDirectory, "results.json")}`);
if (outPath) {
  const { renderEvidence } = await import("./evidence");
  await writeFile(outPath, redact(renderEvidence({ ...summary, results: Object.fromEntries(results), model })));
  console.log(`evidence written to ${outPath}`);
}
process.exit(checks.every((entry) => entry.ok) ? 0 : 1);
