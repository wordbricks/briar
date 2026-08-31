import { createServer } from "node:http";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Config, ProjectConfig } from "./config-contract";
import type { DetachedProviderTurnInput, DetachedProviderTurnResult } from "./detached-provider-turn";
import { runClaimedChannelReply } from "./reply-execution";
import { decodeClaimedChannelReply } from "./worker-claim-contract";

const organizationId = crypto.randomUUID(), projectId = crypto.randomUUID(), workId = crypto.randomUUID();
const documentId = crypto.randomUUID(), memorySpaceId = crypto.randomUUID();
const snapshotAt = "2026-09-01T00:00:00.000Z";
const memory = { protocol: 1, memorySpaceId, memoryRevision: 1, revocationEpoch: 0,
  searchEnabled: true, briefState: "available" };
const brief = { memorySpaceId, memoryRevision: 1, revocationEpoch: 0, policyVersion: "test",
  validThrough: null, profile: [], progress: [], omitted: true, notice: "Search other memories when needed." };
const response = { operation: "get", memoryRevision: 1, revocationEpoch: 0, truncated: false,
  documents: [{ status: "ok", documentId, version: 1, title: "Synthetic older note", memoryClass: "note",
    body: "Synthetic old preference: use metric units.", evidenceType: "explicit_user", protectedByUser: true,
    sourceLanguage: "en", observedAt: null, validUntil: null, conflicted: false, sourceMessageIds: [], sourceEventIds: [],
    updatedAt: snapshotAt, offsetBytes: 0, nextOffsetBytes: null, endOffsetBytes: 44 }] };
const final = { body: "A synthetic answer in metric units", attachments: [], memoryRequests: null,
  memoryCitations: [{ documentId, version: 1 }], contextRequests: null };
const result = (value: unknown, conversationId: string | null = null): DetachedProviderTurnResult => ({
  resultText: JSON.stringify(value), conversationId, completed: true, exitCode: 0, stderr: "", runnerError: null,
});

describe("DM memory in the actual channel reply runner", () => {
  async function exercise(input: {
    revokedAfter?: number; activity?: boolean;
    provider: (turn: DetachedProviderTurnInput, number: number) => Promise<DetachedProviderTurnResult>;
  }) {
    const root = await mkdtemp(join(tmpdir(), "briar-memory-loop-test-"));
    const requests: string[] = [];
    let checks = 0, turns = 0, completed = "";
    const server = createServer((request, reply) => {
      void (async () => {
        const url = new URL(request.url!, "http://localhost"); requests.push(url.pathname);
        const respond = <T>(payload: T) => {
          reply.setHeader("Content-Type", "application/json"); reply.end(JSON.stringify(payload));
        };
        if (url.pathname.endsWith("/memory/check")) {
          checks++;
          respond({ memory: { ...memory, revocationEpoch: checks > (input.revokedAfter ?? Infinity) ? 1 : 0 } });
        } else if (url.pathname.endsWith("/memory/brief")) respond({ memory, brief });
        else if (url.pathname.endsWith("/memory/lookup")) respond(response);
        else if (url.pathname.endsWith("/organization-context/manifest")) respond({
          schemaVersion: 2, organizationId, workId, snapshotAt, revision: "a".repeat(64), projects: [], loadedQueries: [],
        });
        else if (url.pathname.endsWith("/complete")) {
          for await (const chunk of request) completed += String(chunk);
          respond({});
        } else { reply.writeHead(404); reply.end(); return; }
      })().catch(() => { reply.writeHead(500); reply.end(); });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("test server unavailable");
    const config: Config = { apiUrl: `http://127.0.0.1:${address.port}`, projects: [],
      agentProviders: { codex: true, claude: true, cursor: true, grok: true, agy: true, opencode: true, openrouter: true },
      appSettings: { preventSleepWhileRunning: false, browserAutomationProvider: "ego-browser" } };
    const project: ProjectConfig = { id: projectId, repositoryPath: root, agentToken: "synthetic",
      executionWorker: { workerId: "synthetic-worker", deviceId: crypto.randomUUID(), organizationId,
        token: "briar_worker_synthetic", label: "Synthetic", maxConcurrentSessions: 1 } };
    const claim = decodeClaimedChannelReply({ workType: "channelReply", workId, organizationId,
      channelId: crypto.randomUUID(), projectId: null, runId: crypto.randomUUID(), sourceKey: "synthetic", title: "Reply",
      triggerMessageId: crypto.randomUUID(), parentMessageId: crypto.randomUUID(), provider: "claude", model: null,
      claimToken: "briar_channel_claim_synthetic", claimedAt: snapshotAt, leaseExpiresAt: "2099-01-01T00:00:00Z",
      organizationContext: { schemaVersion: 1, snapshotAt }, snapshot: { messages: [] }, memory,
      activity: input.activity ? { token: "synthetic-activity", expiresAt: "2099-01-01T00:00:00Z" } : null });
    let failure: unknown;
    try {
      await runClaimedChannelReply(config, project, claim, "briar_worker_synthetic", new AbortController().signal,
        undefined, { workspaceRoot: root, runProviderTurn: (turn) => input.provider(turn, ++turns) });
    } catch (error) { failure = error; }
    finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await rm(root, { recursive: true, force: true });
    }
    return { failure, turns, requests, completed, checks };
  }

  it("M02/M03/M17 reconstructs retrieved sources for a provider without conversation continuation", async () => {
    const prompts: string[] = [];
    let privateDirectory = "";
    const observed = await exercise({ provider: async (turn, number) => {
      prompts.push(turn.prompt);
      privateDirectory = turn.prompt.match(/Private profile file: (.+)\/profile\.md/u)![1]!;
      expect(turn.conversationId).toBeNull();
      return result(number === 1 ? { memoryRequests: [{ operation: "get", documents: [{ documentId, version: 1 }] }] } : final);
    } });
    expect(observed.failure).toBeUndefined(); expect(observed.turns).toBe(2);
    expect(prompts[0]).not.toContain(response.documents[0]!.body);
    expect(prompts[1]).toContain(response.documents[0]!.body);
    expect(observed.completed).toContain('"memoryCitations"');
    expect(observed.completed).not.toContain(response.documents[0]!.body);
    await expect(stat(privateDirectory)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("M13 keeps private provider errors out of the durable failure payload", async () => {
    const observed = await exercise({ provider: async () => ({ ...result(final), exitCode: 1,
      stderr: "Synthetic private memory echoed by a failing provider" }) });
    expect(observed.failure).toMatchObject({ message: "memory_reply_failed" });
    expect(observed.completed).toBe("");
  });
  it("M07 blocks a revoked claim before invoking a provider", async () => {
    const observed = await exercise({ revokedAfter: 0, provider: async () => result(final) });
    expect(observed.failure).toMatchObject({ message: "memory_scope_revoked" });
    expect(observed.turns).toBe(0); expect(observed.completed).toBe("");
  });
  it("M07 aborts provider work before publishing activity after revocation", async () => {
    let aborted = false;
    const observed = await exercise({ revokedAfter: 1, activity: true, provider: async (turn) => {
      const abort = new Promise<void>((resolve) => turn.signal.addEventListener("abort", () => { aborted = true; resolve(); }, { once: true }));
      await turn.onPayload?.({ event: { type: "messageStarted", id: "synthetic", phase: "commentary", text: "Synthetic progress" } }, "");
      await abort;
      return result(final);
    } });
    expect(aborted).toBe(true); expect(observed.failure).toBeDefined();
    expect(observed.completed).toBe("");
    expect(observed.requests.some((path) => path.endsWith("/activity"))).toBe(false);
  });
  it("M07 blocks a revocation between model generation and final publication", async () => {
    const observed = await exercise({ revokedAfter: 1, provider: async () => result(final) });
    expect(observed.failure).toMatchObject({ message: "memory_scope_revoked" });
    expect(observed.turns).toBe(1); expect(observed.completed).toBe("");
  });
});
