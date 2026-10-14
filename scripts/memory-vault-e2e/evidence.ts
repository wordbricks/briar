/**
 * Renders the e2e run (run.ts) as the Markdown evidence file. Tokens never
 * reach it: the session results hold none and run.ts redacts the output.
 */
type Check = { goal: string; name: string; ok: boolean; detail?: unknown };
type Input = {
  startedAt: string;
  finishedAt: string;
  passed: number;
  failed: number;
  model: string | null;
  timeline: Array<{ step: string; ms: number }>;
  checks: Check[];
  results: Record<string, any>;
};

const fence = (value: unknown, language = "") =>
  `\`\`\`${language}\n${typeof value === "string" ? value : JSON.stringify(value, null, 2)}\n\`\`\``;
const clip = (text: unknown, max = 1_200) => {
  const value = typeof text === "string" ? text : JSON.stringify(text);
  return value && value.length > max ? `${value.slice(0, max)}… (${value.length} chars)` : value ?? "";
};
const goals = {
  "1": "Real API Worker locally, real Artifacts (`briar-memory-e2e`)",
  "2": "Seed through RPCs",
  "3": "Session 1: model saves and journals",
  "4": "Session 2: another process, fresh session recalls",
  "5": "Revisions, conflict, old revision, pagination, journal dedupe",
  "6": "Isolation and inactive claims",
  "7": "README",
  "8": "Forget and purge",
  "9": "Cleanup",
  "-": "Harness",
} as const satisfies Record<string, string>;
const goalTitle = (goal: string) => Object.hasOwn(goals, goal) ? goals[goal as keyof typeof goals] : "";

function toolCalls(session: Record<string, any> | undefined) {
  const calls: Array<{ tool?: string; command: string; output?: string; isError?: boolean }> = session?.toolCalls ?? [];
  return calls.map((call, index) => [
    `Call ${index + 1}, ${call.tool === "StructuredOutput" || (!call.tool && call.command.trim().startsWith("{")) ? "structured reply (StructuredOutput)" : `${call.tool ?? "Bash"}`}${call.isError ? " (tool error)" : ""}:`,
    "",
    fence(call.command, call.command.trim().startsWith("{") ? "json" : "sh"),
    "",
    "Output:",
    "",
    fence(clip(call.output, 1_500)),
  ].join("\n")).join("\n\n");
}

export function renderEvidence(input: Input) {
  const r = input.results;
  const s1 = r.session1 ?? {};
  const s2 = r.session2 ?? {};
  const byGoal = new Map<string, Check[]>();
  for (const entry of input.checks) byGoal.set(entry.goal, [...(byGoal.get(entry.goal) ?? []), entry]);
  const lines: string[] = [];
  // Local (KST) calendar date of the run; timestamps below are UTC.
  lines.push(`# Memory vault end-to-end check — ${new Date(input.startedAt).toLocaleDateString("sv-SE")}`);
  lines.push("");
  lines.push(`Run ${input.startedAt} → ${input.finishedAt}: **${input.passed} passed, ${input.failed} failed**.`);
  lines.push("");
  lines.push("Reproduce: `export CLOUDFLARE_ACCOUNT_ID=459bc0fca39fa1adab8aed615098fcaf && bun scripts/memory-vault-e2e/run.ts --out <this file>` (prerequisites at the top of `scripts/memory-vault-e2e/run.ts`).");
  lines.push("");
  lines.push("## Setup");
  lines.push("");
  lines.push(`* Versions: ${Object.entries(r.versions ?? {}).map(([name, version]) => `${name} \`${version}\``).join(", ")}.`);
  lines.push(`* API: the real \`briar-api\` Worker (\`apps/briar/worker/src/index.ts\`) under \`wrangler dev\` ${r.versions?.wrangler ?? ""} (the repository's 4.127.1 also runs remote Artifacts bindings, but its dev bridge cannot carry the Blob \`repo.readFile\` returns: "Cannot serialize value: [object Blob]") with a config generated from \`apps/briar/wrangler.jsonc\` (\`scripts/memory-vault-e2e/dev-config.ts\`): \`MEMORY_ARTIFACTS\` → Artifacts namespace \`briar-memory-e2e\` with \`remote: true\`, \`MEMORY_VAULT_ENABLED=true\`; routes, assets, Workers AI and Vectorize removed; D1, R2, Durable Objects, Workflows and email local; dummy secrets. Every migration applied to a private local persist dir. The Worker heartbeats through \`WorkerControlService.HeartbeatWorker\` every 15 s. Nothing deployed, no \`--remote\` D1, the \`briar-memory\` namespace untouched.`);
  lines.push("* Admin: `scripts/memory-vault-e2e/artifacts-admin-worker.ts` under a second local `wrangler dev`, same remote namespace, reading repositories through the production `ArtifactsVaultGitStore` (direct git-store reads, existence, deletion).");
  lines.push("* Seed: people, sessions, workspace, project and Worker device/credential/runtime (with `memoryVaultProtocol = 1`) as local rows; the Agent (`AgentService.CreateWorkspaceAgent`, provider Claude), both DMs (`ChannelService.CreateDirectMessage`), the group channel (`CreateChannel`, `SetChannelMember`, `SetChannelAgent`) and DM memory opt-in (`DmMemoryService.UpdateDmMemorySettings`) through the real RPCs with the people's session tokens.");
  lines.push("* Every reply: the person posts through `ChannelService.CreateChannelMessage`; a separate Worker process (`session.ts`) claims it with `WorkerQueueService.ClaimWork`, opens `openMemoryVaultInvocation` + `prepareTurn`, builds instructions = `detachedAgentContext` + vault section and prompt = vault tags + `detachedChannelReplyPrompt`, puts the private `tools` first on PATH, and completes with `CompleteChannelReply`.");
  lines.push(`* Model: \`claude -p\` model \`${s1.model ?? "?"}\`, flags \`--append-system-prompt <instructions> --json-schema <production reply schema> --setting-sources "" --strict-mcp-config --tools Bash --allowedTools "Bash(tools memory:*)" --permission-mode dontAsk --no-session-persistence\` (the production Claude runner appends instructions to the \`claude_code\` preset with no setting sources for Briar-only reply turns). Session ids: 1 \`${s1.modelSessionId ?? "?"}\`, 2 \`${s2.modelSessionId ?? "?"}\`.`);
  lines.push("");
  lines.push("## Assertions");
  lines.push("");
  for (const [goal, entries] of [...byGoal].sort(([a], [b]) => (a === "-" ? 99 : Number(a)) - (b === "-" ? 99 : Number(b)))) {
    lines.push(`### ${goal}. ${goalTitle(goal)}`);
    lines.push("");
    for (const entry of entries) {
      const detail = entry.detail === undefined ? "" : ` — \`${clip(entry.detail, 400).replaceAll("`", "'").replaceAll("\n", " ")}\``;
      lines.push(`* **${entry.ok ? "PASS" : "FAIL"}** ${entry.name}${detail}`);
    }
    lines.push("");
  }
  lines.push("## Session 1 (user A states a fact and a reply rule)");
  lines.push("");
  lines.push(`Claim \`${s1.workId}\`, vault scope \`${s1.context?.scopeKind}\`, status line \`${s1.context?.status ?? ""}\`. User message: "${r.session1Message ?? ""}"`);
  lines.push("");
  lines.push("Prompt prefix (the vault was empty):");
  lines.push("");
  lines.push(fence(s1.promptPrefix ?? ""));
  lines.push("");
  lines.push("Tool calls (command → output):");
  lines.push("");
  lines.push(toolCalls(s1));
  lines.push("");
  lines.push("Answer (reply body sent through CompleteChannelReply):");
  lines.push("");
  lines.push(fence(s1.answer ?? ""));
  lines.push("");
  lines.push(`Repository after session 1 (\`${r.vaultA?.repo_name}\`, read directly from the git store):`);
  lines.push("");
  lines.push(fence(r.repoAfterSession1?.commits ?? []));
  for (const [path, content] of Object.entries<string>(r.repoAfterSession1?.headFiles ?? {})) {
    if (path === "README.md") continue;
    lines.push(`\`${path}\`:`);
    lines.push(fence(content, "md"));
  }
  lines.push("");
  lines.push("D1 index after session 1:");
  lines.push("");
  lines.push(fence(r.indexAfterSession1 ?? {}));
  lines.push("");
  lines.push("## Session 2 (another Worker process, fresh model session)");
  lines.push("");
  lines.push(`Claim \`${s2.workId}\`, user message "내가 좋아하는 커피 뭐였지?". Prompt prefix:`);
  lines.push("");
  lines.push(fence(s2.promptPrefix ?? ""));
  lines.push("");
  lines.push("Tool calls:");
  lines.push("");
  lines.push(toolCalls(s2));
  lines.push("");
  lines.push("Answer:");
  lines.push("");
  lines.push(fence(s2.answer ?? ""));
  lines.push("");
  lines.push(`Citations: \`${JSON.stringify(s2.citations ?? [])}\`, completion: \`${JSON.stringify(s2.completion ?? {})}\``);
  lines.push("");
  lines.push("## Direct tool invocations (goal 5, 7)");
  lines.push("");
  const steps = r.revisions?.steps ?? {};
  for (const name of ["readBefore", "updateWithRevision", "staleSave", "readRevision1", "readLatest", "searchPages",
    "journalSameRequestId", "journalToolFirst", "journalToolSecond", "readmeSave"]) {
    lines.push(`* \`${name}\`: \`${clip(steps[name], 700).replaceAll("`", "'")}\``);
  }
  lines.push("");
  lines.push("## Isolation (goal 6)");
  lines.push("");
  for (const [label, iso] of Object.entries<any>(r.isolation ?? {})) {
    lines.push(`* ${label}: scope \`${iso.context?.scopeKind}\`; list \`${clip(iso.list?.output, 300)}\`; search \`${clip(iso.search?.output, 200)}\`; read \`${clip(iso.read?.output, 300)}\``);
  }
  lines.push(`* expired claim: tools \`${clip(r.expired?.afterExpiry?.output, 300)}\`, RPC \`${clip(r.expired?.afterExpiryRpc, 300)}\``);
  lines.push(`* finished claim (session 1 after completion): \`${clip(s1.finishedClaim, 300)}\``);
  lines.push("");
  lines.push("## Forget and purge (goal 8)");
  lines.push("");
  const purgeSummary = (purge: any) => purge && {
    completedAt: purge.purge?.completed_at, attempts: purge.purge?.attempts, lastError: purge.purge?.last_error,
    oldRepoGone: purge.oldGone, vault: purge.scan?.current, commitsInNewGeneration: purge.scan?.commits,
    commitsStillHoldingCoffeeText: (purge.scan?.holding ?? []).length,
  };
  lines.push(fence({
    owner_dialog_documents_before: r.forget1?.listed,
    forget1_deleted: r.forget1?.deleted,
    purge1: purgeSummary(r.purge1),
    coffee_text_left_in_journal_commits: (r.coffeeOutsideRecord ?? []).map((entry: any) => entry.paths).flat()
      .filter((path: string, index: number, all: string[]) => all.indexOf(path) === index),
    forget2_deleted: r.forget2?.deleted,
    purge2: purgeSummary(r.purge2),
  }));
  lines.push("");
  lines.push("Spec §10.3: forget removes the record's own history; words the agent also wrote into a journal line are a separate record. The owner deletes that daily record too (forget 2), after which no commit of the final generation contains the text.");
  lines.push("");
  lines.push("## Cleanup (goal 9)");
  lines.push("");
  lines.push(fence(r.cleanup ?? {}));
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  const aliasRejections = [...(s1.toolCalls ?? []), ...(s2.toolCalls ?? [])]
    .filter((call: any) => String(call.output ?? "").includes("Aliases use the same form as ids")).length;
  lines.push(`* Non-ASCII aliases: the model's first save offered a Korean alias ("커피") and got \`invalid_record\` "Aliases use the same form as ids" (${aliasRejections} such rejection(s) in this run); it retried with ASCII aliases in the same turn. Aliases follow the id grammar by design (spec §5.1); a Korean user's natural alias cannot be stored.`);
  lines.push("* Local-only differences, not product behaviour: Workers AI is not bound, so the DM acknowledgement reaction logs \"Cannot read properties of undefined (reading 'run')\"; reply delivery to the channel is otherwise real.");
  lines.push("* Product fixes this check needed (see the PR): the README Text import failed the real `wrangler deploy` bundle (`readme.ts`, guarded by `scripts/worker-module-rules.test.ts`); a missing repository behind a `wrangler dev` remote binding lost its `NOT_FOUND` code, so every purge failed its \"old generation is gone\" check (`artifacts-git-store.ts`, `artifacts-git-store.test.ts`).");
  lines.push("");
  lines.push("## Timings");
  lines.push("");
  lines.push("| Step | ms |");
  lines.push("| --- | ---: |");
  for (const entry of input.timeline) lines.push(`| ${entry.step} | ${entry.ms} |`);
  for (const [label, session] of [["session 1", s1], ["session 2", s2]] as const) {
    lines.push(`| ${label}: claim / prepareTurn / model / completion | ${session.timings?.claim ?? "?"} / ${session.timings?.prepareTurn ?? "?"} / ${session.timings?.model ?? "?"} / ${session.timings?.completeChannelReply ?? "?"} |`);
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  // Re-render from a finished run: bun evidence.ts .work/results.json <out.md> [model]
  const [resultsPath, out, model] = process.argv.slice(2);
  const parsed = JSON.parse(await Bun.file(resultsPath!).text());
  await Bun.write(out!, renderEvidence({ ...parsed, model: model ?? null }));
}
