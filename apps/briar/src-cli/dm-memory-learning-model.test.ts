import { describe, expect, it, vi } from "vitest";
import type { DmLearningInvocation } from "../src/lib/dm-memory-learning-contract";
import { syntheticDmLearningChange, syntheticDmLearningSnapshot } from "../worker/src/test-helpers/dm-memory-learning";
import { invokeDmLearningModel } from "./dm-memory-learning-model";

function fixture(stage: "proposing" | "verifying" = "proposing"): DmLearningInvocation {
  const snapshot = syntheticDmLearningSnapshot();
  return { callId: crypto.randomUUID(), inputHash: "a".repeat(64), stage, snapshot,
    proposalId: stage === "verifying" ? crypto.randomUUID() : null,
    proposalHash: stage === "verifying" ? "b".repeat(64) : null,
    model: snapshot.policy[stage === "proposing" ? "proposer" : "verifier"],
    proposal: stage === "verifying" ? { explicitRequest: false, changes: [syntheticDmLearningChange(snapshot)] } : null,
    status: "reserved" };
}
type SyntheticMessageFields = { readonly tool_calls?: readonly unknown[]; readonly refusal?: string | null };
const response = (invocation: DmLearningInvocation, value: unknown, message: SyntheticMessageFields = {}) => Response.json({
  model: invocation.model.model, choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value), ...message } }],
  usage: { prompt_tokens: 123, completion_tokens: 45, cost: 0.0002 },
});

describe("isolated memory model transport", () => {
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
