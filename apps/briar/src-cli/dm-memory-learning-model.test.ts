import { readdir, stat } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { DmLearningInvocation } from "../src/lib/dm-memory-learning-contract";
import { syntheticDmLearningChange, syntheticDmLearningSnapshot } from "../worker/src/test-helpers/dm-memory-learning";
import { invokeDmLearningModel } from "./dm-memory-learning-model";
import { runDetachedProviderTurn } from "./detached-provider-turn";
import { prepareReadOnlyAgentEnvironment } from "./read-only-agent-environment";

function fixture(stage: "proposing" | "verifying" = "proposing"): DmLearningInvocation {
  const snapshot = syntheticDmLearningSnapshot();
  return { callId: crypto.randomUUID(), inputHash: "a".repeat(64), stage, snapshot,
    proposalId: stage === "verifying" ? crypto.randomUUID() : null,
    proposalHash: stage === "verifying" ? "b".repeat(64) : null,
    model: snapshot.policy[stage === "proposing" ? "proposer" : "verifier"],
    proposal: stage === "verifying" ? { explicitRequest: false, changes: [syntheticDmLearningChange(snapshot)] } : null,
    status: "reserved" };
}

function agentFixture(stage: "proposing" | "verifying" = "proposing"): DmLearningInvocation {
  const invocation = fixture(stage);
  const model = { transport: "agent" as const, provider: "codex" as const, model: null, effort: null,
    maxOutputTokens: 4096, maxInputMicroUsdPerMillionTokens: 0, maxOutputMicroUsdPerMillionTokens: 0 };
  return { ...invocation, model, snapshot: { ...invocation.snapshot,
    policy: { ...invocation.snapshot.policy, proposer: model, verifier: model } } };
}
type SyntheticMessageFields = { readonly tool_calls?: readonly unknown[]; readonly refusal?: string | null };
const response = (invocation: DmLearningInvocation, value: unknown, message: SyntheticMessageFields = {}) => Response.json({
  model: invocation.model.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value), ...message } }],
  usage: { prompt_tokens: 123, completion_tokens: 45, cost: 0.0002 },
});

describe("isolated memory model transport", () => {
  it("runs a connected Agent in an empty read-only workspace without tools, skills or a retained conversation", async () => {
    const invocation = agentFixture(), proposal = { explicitRequest: false, changes: [] };
    let workspacePath = "";
    const cleanup = vi.fn(async () => undefined);
    const prepareAgentEnvironment = vi.fn<typeof prepareReadOnlyAgentEnvironment>(async (_provider, input) => {
      workspacePath = input.workspaceRoot;
      expect(await readdir(workspacePath)).toEqual([]);
      return { environment: { PATH: "/synthetic" }, cleanup };
    });
    const runAgentTurn = vi.fn<typeof runDetachedProviderTurn>(async (input) => {
      expect(input.agent).toMatchObject({ provider: "codex", model: null, effort: null, skills: [], skill: "" });
      expect(input).toMatchObject({ workspacePath, fullAccess: false, readOnly: true, conversationId: null,
        attachments: [], skillCatalog: null });
      expect(input.outputSchema).toBeTruthy();
      expect(JSON.stringify(input.outputSchema)).not.toContain('"allOf"');
      expect(input.agent.responsibility).toContain("Do not use tools");
      return { exitCode: 0, stderr: "", runnerError: null, completed: true,
        resultText: JSON.stringify(proposal), conversationId: crypto.randomUUID() };
    });
    expect(await invokeDmLearningModel({ invocation, apiKey: null, signal: new AbortController().signal,
      environment: { HOME: "/synthetic-home" }, prepareAgentEnvironment, runAgentTurn }))
      .toEqual({ proposal, usage: expect.objectContaining({ costMicroUsd: null }) });
    expect(prepareAgentEnvironment).toHaveBeenCalledWith("codex", expect.objectContaining({ workspaceRoot: workspacePath }));
    expect(cleanup).toHaveBeenCalledTimes(1);
    await expect(stat(workspacePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("starts proposer and verifier Agent calls without sharing provider conversation state", async () => {
    const workspaces: string[] = [], conversations: Array<string | null | undefined> = [];
    const prepareAgentEnvironment = vi.fn<typeof prepareReadOnlyAgentEnvironment>(async () => ({
      environment: {}, cleanup: async () => undefined,
    }));
    const runAgentTurn = vi.fn<typeof runDetachedProviderTurn>(async (input) => {
      workspaces.push(input.workspacePath);
      conversations.push(input.conversationId);
      const result = input.agent.name.endsWith("verifier")
        ? { approved: true, explicitRequestAuthorized: false, decisions: [{ changeId: "change-1", verdict: "supported" }] }
        : { explicitRequest: false, changes: [] };
      return { exitCode: 0, stderr: "", runnerError: null, completed: true,
        resultText: JSON.stringify(result), conversationId: crypto.randomUUID() };
    });
    await invokeDmLearningModel({ invocation: agentFixture(), apiKey: null, signal: new AbortController().signal,
      prepareAgentEnvironment, runAgentTurn });
    await invokeDmLearningModel({ invocation: agentFixture("verifying"), apiKey: null,
      signal: new AbortController().signal, prepareAgentEnvironment, runAgentTurn });
    expect(new Set(workspaces).size).toBe(2);
    expect(conversations).toEqual([null, null]);
  });

  it("pins routing, disables fallback and submits only system instructions, authorized data and the output schema", async () => {
    const invocation = fixture(), proposal = { explicitRequest: false, changes: [] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(invocation, proposal));
    expect(await invokeDmLearningModel({ invocation, apiKey: "synthetic-secret", signal: new AbortController().signal, fetcher }))
      .toEqual({ proposal, usage: { inputTokens: 123, outputTokens: 45, costMicroUsd: 200 } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const request = JSON.parse(String(init?.body));
    expect(request.provider).toEqual({ only: ["synthetic"], allow_fallbacks: false,
      require_parameters: true, data_collection: "deny", zdr: true,
      max_price: { prompt: 1, completion: 2, request: 0, image: 0 } });
    expect(request.messages.map((message: { role: string }) => message.role)).toEqual(["system", "user"]);
    expect(request.messages[1].content).toBe(JSON.stringify({ snapshot: invocation.snapshot }));
    expect(request.response_format.json_schema.strict).toBe(true);
    expect(request.max_tokens).toBe(invocation.model.maxOutputTokens);
    for (const field of ["tools", "plugins", "conversation_id", "models", "session_id", "modalities", "n", "max_completion_tokens"]) {
      expect(request).not.toHaveProperty(field);
    }
    expect(String(init?.body)).not.toContain("synthetic-secret");
  });
  it("verifies in a fresh request without inheriting the proposing conversation", async () => {
    const invocation = fixture("verifying"), verification = { approved: true, explicitRequestAuthorized: false,
      decisions: [{ changeId: "change-1", verdict: "supported" }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(invocation, verification));
    const result = await invokeDmLearningModel({ invocation, apiKey: "synthetic-secret", signal: new AbortController().signal, fetcher });
    expect(result).toHaveProperty("verification", verification);
    const request = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(request.model).toBe("synthetic/verifier");
    expect(request.messages).toHaveLength(2);
    expect(request.messages[0].content).toContain("Independently verify");
    expect(JSON.parse(request.messages[1].content)).toEqual({ snapshot: invocation.snapshot, proposal: invocation.proposal });
  });
  it("does not retry credentials errors or expose a provider's response body", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("synthetic-private-prompt-and-key", { status: 401 }));
    await expect(invokeDmLearningModel({ invocation: fixture(), apiKey: "synthetic-secret", signal: new AbortController().signal, fetcher }))
      .rejects.toThrow("memory_model_credentials");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("rejects a tool call even when its text also contains otherwise valid memory JSON", async () => {
    const invocation = fixture();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response(invocation, { explicitRequest: false, changes: [] },
      { tool_calls: [{ function: { name: "write_memory", arguments: "synthetic private data" } }] }));
    await expect(invokeDmLearningModel({ invocation, apiKey: "synthetic-secret", signal: new AbortController().signal, fetcher }))
      .rejects.toThrow("memory_invalid_proposal");
  });
  it("requires configured credentials and an unused reservation before sending any data", async () => {
    const invocation = fixture(), fetcher = vi.fn<typeof fetch>();
    await expect(invokeDmLearningModel({ invocation, apiKey: null, signal: new AbortController().signal, fetcher }))
      .rejects.toThrow("memory_model_credentials");
    await expect(invokeDmLearningModel({ invocation: { ...invocation, status: "completed" }, apiKey: "synthetic-secret",
      signal: new AbortController().signal, fetcher })).rejects.toThrow("memory_stale");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
