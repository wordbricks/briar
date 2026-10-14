/**
 * One "Worker process" of the memory vault e2e check. Each invocation is a
 * separate OS process holding its own claim, exactly as a Worker CLI would:
 *
 *   bun session.ts <scenario> <trigger message id> <result file>
 *
 * It claims the reply job for that trigger message through the real
 * `WorkerQueueService.ClaimWork`, opens the real `MemoryVaultInvocation`
 * (`openMemoryVaultInvocation` + `prepareTurn`), builds the turn the way
 * `reply-execution.ts` does (instructions = `detachedAgentContext` + vault
 * section; prompt = vault tags + `detachedChannelReplyPrompt`; env with the
 * private `tools` first on PATH) and then runs one scenario:
 *
 * * `model`      — a real, fresh `claude -p` session (no resume) with those
 *                  instructions, only `Bash(tools memory:*)` allowed, the
 *                  production reply JSON schema; completes the reply with the
 *                  model's body and citations; then checks the finished claim.
 * * `revisions`  — direct `tools memory` invocations: update with the right
 *                  revision, stale save, old revision read, paginated search,
 *                  journal retry dedupe, README save refusal.
 * * `isolation`  — list/search/read of user A's coffee record from this claim.
 * * `expire`     — lets the claim's lease lapse (local D1) and calls again.
 *
 * Claim and Worker tokens never leave this process and never reach the
 * result file.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeChannelAcknowledgementReaction } from "../../apps/briar/src/lib/channel-acknowledgement-reaction";
import { ChannelAgentReplyProviderOutputSchema } from "../../apps/briar/src/lib/channel-agent-reply-contract";
import { detachedAgentContext, detachedChannelReplyPrompt, type DetachedAgent } from "../../apps/briar/src-cli/agent-runner";
import {
  memoryVaultToolError,
  openMemoryVaultInvocation,
} from "../../apps/briar/src-cli/memory-vault-invocation";
import { providerStructuredOutputContract } from "../../apps/briar/src-cli/structured-output-contract";
import { workClaimIdentityToProto } from "../../apps/briar/src-cli/worker-queue-client";
import type { ClaimedChannelReply } from "../../apps/briar/src-cli/worker-queue-contract";
import { d1, loadState, redact, sha256Hex, workDirectory, workerClients } from "./lib";

const [scenario, triggerMessageId, resultPath, extra] = process.argv.slice(2);
if (!scenario || !triggerMessageId || !resultPath) {
  console.error("usage: bun session.ts <model|revisions|isolation|expire> <trigger message id> <result file> [arg]");
  process.exit(2);
}

const state = await loadState();
const { queue, operations } = workerClients(state.workerToken);
const log: string[] = [];
const note = (line: string) => { log.push(redact(line)); console.error(redact(line)); };
const timings: Record<string, number> = {};
const time = async <T>(name: string, fn: () => Promise<T>) => {
  const started = performance.now();
  try { return await fn(); } finally { timings[name] = Math.round(performance.now() - started); }
};

// 1. Claim the reply job for this trigger message (as a Worker would).
const reply = await time("claim", async () => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const claimed = await operations.claimWork({
      workspaceId: state.workspaceId, projectId: state.projectId, workerId: state.workerId,
      claimedBy: `e2e-${scenario}-${process.pid}`, repliesOnly: true,
    });
    if (claimed.work) {
      if (claimed.work.workType !== "channelReply") throw new Error(`claimed unexpected ${claimed.work.workType}`);
      const work = claimed.work as ClaimedChannelReply;
      if (work.triggerMessageId !== triggerMessageId) {
        throw new Error(`claimed reply for ${work.triggerMessageId}, expected ${triggerMessageId}`);
      }
      return work;
    }
    await Bun.sleep(Math.min(claimed.retryAfterMs ?? 1_000, 2_000));
  }
  throw new Error("no reply job was claimable");
});
note(`claimed ${reply.workId} (channel ${reply.channelId})`);

// 2. The run's vault invocation, exactly as reply-execution.ts opens it.
const vault = await openMemoryVaultInvocation({
  queue,
  projectId: state.projectId,
  workerId: state.workerId,
  work: reply,
  personFacing: true,
  citations: true,
  scriptPath: join(workDirectory, "memory-tools.js"),
  log: note,
});
if (!vault) throw new Error("openMemoryVaultInvocation returned null");
const workspace = await mkdtemp(join(tmpdir(), "briar-e2e-workspace-"));
const turn = await time("prepareTurn", () => vault.prepareTurn(workspace));

// Mirrors detachedReplyAgent() in issue-execution.ts (not exported).
const baseAgent = reply.agent ?? {
  id: reply.workId, name: "Briar Channel", provider: reply.provider, model: reply.model,
  effort: null, responsibility: "", skills: [],
};
const agent: DetachedAgent = {
  ...baseAgent,
  provider: reply.provider,
  model: reply.model,
  effort: reply.effort !== undefined ? reply.effort : reply.activeSkill?.effort ?? baseAgent.effort,
  activeSkill: reply.activeSkill ?? null,
  scope: reply.scope,
};
const workspaceScope = reply.scope.kind === "workspace";
const instructions = [
  detachedAgentContext(agent, { delegationTargets: workspaceScope ? reply.delegationTargets : undefined }),
  turn?.instructions ?? null,
].filter((value): value is string => value !== null).join("\n\n");
const basePrompt = detachedChannelReplyPrompt({
  agent,
  snapshot: reply.snapshot,
  workspaceAvailable: false,
  repositoryRequestAvailable: false,
  organizationContextAvailable: false,
  memoryVaultAvailable: Boolean(turn),
  delegationTargets: reply.delegationTargets,
  delegation: reply.delegation,
  agentMessageTargets: reply.agentMessageTargets,
  inboundAgentMessage: reply.inboundAgentMessage
    ? { senderAgentName: reply.inboundAgentMessage.senderAgentName, body: reply.inboundAgentMessage.body }
    : null,
  pendingTriggerMessageIds: reply.pendingTriggerMessageIds,
});
const prompt = turn?.promptPrefix ? `${turn.promptPrefix}\n\n${basePrompt}` : basePrompt;
// A nested Claude Code session must not think it runs inside this one.
const providerEnvironment = vault.environment(Object.fromEntries(Object.entries(process.env)
  .filter(([key]) => !key.startsWith("CLAUDECODE") && !key.startsWith("CLAUDE_CODE_"))));

type ToolRun = { argv: string[]; exit: number | null; output: unknown };
/**
 * Runs `tools …` as the agent's shell would. Asynchronous on purpose: the
 * relay that answers it lives in this very process.
 */
const tools = (argv: string[], stdin?: string) => new Promise<ToolRun>((resolveRun, reject) => {
  const child = spawn("tools", argv, { cwd: workspace, env: providerEnvironment, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
  child.once("error", reject);
  child.once("exit", (code) => {
    let output: unknown = stdout;
    try { output = JSON.parse(stdout); } catch { /* keep raw */ }
    resolveRun({ argv, exit: code, output });
  });
  child.stdin.end(stdin ?? "");
});
const claim = () => ({
  $typeName: "briar.worker.v1.MemoryVaultClaim" as const,
  projectId: state.projectId,
  workerId: state.workerId,
  work: workClaimIdentityToProto(reply),
});
// `memoryVaultToolError` is the CLI's own mapping of a Connect error to the agent-facing code.
const rpcError = (error: unknown) => memoryVaultToolError(error);
/** `MemoryVaultList` straight through the RPC with this claim: the error code, or that it succeeded. */
const vaultListOutcome = () => queue.memoryVaultList({ claim: claim() })
  .then(() => ({ code: "none (call succeeded)" }), rpcError);
const connectText = (error: unknown) => {
  const value = error as { code?: number; rawMessage?: string };
  return value.rawMessage !== undefined ? `${value.code} ${value.rawMessage}` : String(error);
};

async function complete(body: string, citations: Array<{ documentId: string; version: number }> = []) {
  return time("completeChannelReply", async () => {
    try {
      const response = await queue.completeChannelReply({
        requestId: randomUUID(),
        projectId: state.projectId,
        workerId: state.workerId,
        work: workClaimIdentityToProto(reply),
        outcome: { case: "success", value: { body, memoryCitations: citations } },
      });
      return { ok: true, disposition: response.disposition, finalMessageId: response.finalMessageId ?? null };
    } catch (error) {
      return { ok: false, error: connectText(error) };
    }
  });
}

// What this session reports to run.ts; each scenario adds its fields with Object.assign.
const result = {
  scenario,
  workId: reply.workId,
  channelId: reply.channelId,
  hasVault: Boolean(turn),
  context: turn ? {
    scopeKind: turn.context.scopeKind,
    status: turn.context.status,
    readable: turn.context.readable,
    writable: turn.context.writable,
    userRequestedWritable: turn.context.userRequestedWritable,
    voiceGuide: turn.context.voiceGuide,
    voice: turn.context.voice,
    playbook: turn.context.playbook,
    readmeSha256: sha256Hex(turn.context.readme),
  } : null,
  instructions,
  instructionsSha256: sha256Hex(instructions),
  promptPrefix: turn?.promptPrefix ?? null,
  prompt,
  toolsOnPath: (providerEnvironment.PATH ?? "").split(":")[0] === vault.binDirectory,
};

try {
  switch (scenario) {
    case "model": {
      const contract = providerStructuredOutputContract("claude", ChannelAgentReplyProviderOutputSchema,
        normalizeChannelAcknowledgementReaction);
      const args = [
        "-p", prompt,
        "--append-system-prompt", instructions,
        "--output-format", "stream-json", "--verbose",
        "--json-schema", JSON.stringify(contract.jsonSchema),
        // Production channel replies: Briar tools only, no user settings or MCP servers.
        "--setting-sources", "",
        "--strict-mcp-config",
        "--tools", "Bash",
        "--allowedTools", "Bash(tools memory:*)",
        "--permission-mode", "dontAsk",
        "--no-session-persistence",
        ...(extra ? ["--model", extra] : []),
      ];
      const events: Array<Record<string, unknown>> = [];
      const stderr: string[] = [];
      await time("model", () => new Promise<void>((resolve, reject) => {
        const child = spawn("claude", args, { cwd: workspace, env: providerEnvironment, stdio: ["ignore", "pipe", "pipe"] });
        let buffer = "";
        child.stdout.on("data", (chunk: Buffer) => {
          buffer += chunk.toString("utf8");
          let index: number;
          while ((index = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            if (!line) continue;
            try { events.push(JSON.parse(line)); } catch { stderr.push(`unparsed: ${line.slice(0, 200)}`); }
          }
        });
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk.toString("utf8")));
        const timer = setTimeout(() => child.kill("SIGTERM"), 600_000);
        child.once("error", reject);
        child.once("exit", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(); else reject(new Error(`claude exited ${code}: ${stderr.join("").slice(-800)}`));
        });
      }));
      const init = events.find((event) => event.type === "system" && event.subtype === "init") as
        { model?: string; tools?: string[]; session_id?: string; permissionMode?: string } | undefined;
      const toolCalls: Array<{ id: string; tool: string; command: string; output?: string; isError?: boolean }> = [];
      const permissionDenials: unknown[] = [];
      for (const event of events) {
        const message = (event as { message?: { content?: unknown } }).message;
        const content = Array.isArray(message?.content) ? message!.content as Array<Record<string, unknown>> : [];
        for (const block of content) {
          if (block.type === "tool_use") {
            const input = block.input as { command?: string };
            toolCalls.push({ id: String(block.id), tool: String(block.name), command: String(input.command ?? JSON.stringify(input)) });
          }
          if (block.type === "tool_result") {
            const call = toolCalls.find((candidate) => candidate.id === block.tool_use_id);
            const text = typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content) ? (block.content as Array<{ text?: string }>).map((part) => part.text ?? "").join("") : "";
            if (call) { call.output = text; call.isError = Boolean(block.is_error); }
          }
        }
      }
      const final = events.findLast((event) => event.type === "result") as
        { result?: string; structured_output?: unknown; total_cost_usd?: number; num_turns?: number; permission_denials?: unknown[]; usage?: unknown } | undefined;
      if (final?.permission_denials) permissionDenials.push(...final.permission_denials);
      const parseResult = (text: string | undefined) => {
        try { return text ? JSON.parse(text) : null; } catch { return null; }
      };
      const structured = final?.structured_output ?? parseResult(final?.result);
      let decoded: { case: string; result?: { body: string; memoryCitations?: Array<{ documentId: string; version: number }> | null } } | null = null;
      let decodeError: string | null = null;
      try { decoded = contract.decode(structured) as typeof decoded; } catch (error) { decodeError = String(error).slice(0, 500); }
      const body = decoded?.case === "reply" ? decoded.result!.body : typeof final?.result === "string" ? final.result : "";
      const citations = decoded?.case === "reply" ? decoded.result!.memoryCitations ?? [] : [];
      // What the vault holds after the turn, read back through the vault read RPCs.
      const afterList = await tools(["memory", "list"]);
      const afterReads: ToolRun[] = [];
      for (const record of (afterList.output as { records?: Array<{ id: string; type: string }> }).records ?? []) {
        if (record.id !== "README.md" && record.id !== "readme") afterReads.push(await tools(["memory", "read", record.id]));
      }
      const completion = await complete(body, citations.map((citation) => ({ documentId: citation.documentId, version: citation.version })));
      // The claim is finished now: the vault must refuse it.
      const finishedClaim = await vaultListOutcome();
      Object.assign(result, {
        model: init?.model ?? null,
        modelTools: init?.tools ?? null,
        modelSessionId: init?.session_id ?? null,
        numTurns: final?.num_turns ?? null,
        costUsd: final?.total_cost_usd ?? null,
        toolCalls,
        permissionDenials,
        structured,
        decodeError,
        answer: body,
        citations,
        afterList,
        afterReads,
        completion,
        finishedClaim,
        stderrTail: stderr.join("").slice(-1500),
      });
      break;
    }
    case "revisions": {
      const steps: Record<string, unknown> = {};
      const coffeeHits = await tools(["memory", "search", "콜드브루"]);
      steps.searchCoffee = coffeeHits;
      const hit = ((coffeeHits.output as { hits?: Array<{ id: string; type: string }> }).hits ?? [])
        .find((candidate) => candidate.type !== "timeline-daily");
      if (!hit) throw new Error("no non-journal record mentions 콜드브루");
      const before = await tools(["memory", "read", hit.id]);
      steps.readBefore = before;
      const current = before.output as { revision: number; body: string; type: string; aliases?: string[] };
      const updatedBody = `${current.body.replace(/\s+$/u, "")}\n\n- 주말에는 가끔 아이스 라떼도 마신다고 함 (e2e 업데이트).\n`;
      steps.updateWithRevision = await tools(["memory", "save", hit.id, "--type", current.type,
        "--expected-revision", String(current.revision), "--user-requested"], updatedBody);
      steps.staleSave = await tools(["memory", "save", hit.id, "--type", current.type,
        "--expected-revision", String(current.revision), "--user-requested"], `${updatedBody}\n- stale writer\n`);
      steps.readRevision1 = await tools(["memory", "read", hit.id, "--revision", "1"]);
      steps.readLatest = await tools(["memory", "read", hit.id]);
      // Pagination: three records/lines share a token; walk it one hit per page.
      steps.seedPageA = await tools(["memory", "save", "e2e-page-a", "--type", "fact"], "# Page A\n\npaginate-token alpha\n");
      steps.seedPageB = await tools(["memory", "save", "e2e-page-b", "--type", "fact"], "# Page B\n\npaginate-token beta\n");
      steps.seedPageJournal = await tools(["memory", "journal", "e2e paginate-token gamma line"]);
      const pages: ToolRun[] = [];
      let cursor: string | null = null;
      do {
        const page = await tools(["memory", "search", "paginate-token", "--limit", "1", ...(cursor ? ["--cursor", cursor] : [])]);
        pages.push(page);
        cursor = (page.output as { next_cursor?: string | null }).next_cursor ?? null;
      } while (cursor && pages.length < 10);
      steps.searchPages = pages;
      // Journal retry dedupe: the same request id twice through the RPC (a
      // transport retry), and the same line twice through `tools` (a model retry).
      const requestId = randomUUID();
      const journalRequest = { claim: claim(), requestId, text: "e2e retry dedupe line", references: [], userRequested: false };
      const first = await queue.memoryVaultJournal(journalRequest);
      const second = await queue.memoryVaultJournal(journalRequest);
      steps.journalSameRequestId = {
        first: { line: first.line, revision: first.revision, commit: first.commit, replayed: first.replayed, deduplicated: first.deduplicated },
        second: { line: second.line, revision: second.revision, commit: second.commit, replayed: second.replayed, deduplicated: second.deduplicated },
      };
      steps.journalToolFirst = await tools(["memory", "journal", "e2e identical line retry"]);
      steps.journalToolSecond = await tools(["memory", "journal", "e2e identical line retry"]);
      steps.readmeSave = await tools(["memory", "save", "readme", "--type", "fact"], "# hijack\n");
      steps.readmeRead = await tools(["memory", "read", "README.md"]);
      Object.assign(result, { coffeeRecordId: hit.id, steps, completion: await complete("e2e revisions done") });
      break;
    }
    case "isolation": {
      const coffeeId = extra ?? "";
      Object.assign(result, {
        coffeeRecordId: coffeeId,
        list: await tools(["memory", "list"]),
        search: await tools(["memory", "search", "콜드브루"]),
        searchDecaf: await tools(["memory", "search", "디카페인"]),
        read: await tools(["memory", "read", coffeeId]),
        completion: await complete("e2e isolation done"),
      });
      break;
    }
    case "expire": {
      const before = await tools(["memory", "list"]);
      await d1(`update briar_channel_agent_reply_jobs set lease_expires_at = ? where id = ?`,
        [new Date(Date.now() - 60_000).toISOString(), reply.workId]);
      const after = await tools(["memory", "list"]);
      Object.assign(result, { before, afterExpiry: after, afterExpiryRpc: await vaultListOutcome() });
      break;
    }
    default:
      throw new Error(`unknown scenario ${scenario}`);
  }
} catch (error) {
  Object.assign(result, { error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
} finally {
  await turn?.cleanup();
  await vault.cleanup();
  await rm(workspace, { recursive: true, force: true });
}
Object.assign(result, { timings, log });
await writeFile(resultPath, redact(JSON.stringify(result, null, 2)));
process.exit("error" in result ? 1 : 0);
