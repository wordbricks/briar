import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as JsonSchema from "effect/JsonSchema";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import type { AgentProvider } from "../src/lib/agent-provider";
import { DmLearningProposal, DmLearningVerification, dmLearningFailureCodes,
  type DmLearningInvocation, type DmLearningUsage } from "../src/lib/dm-memory-learning-contract";
import { dmLearningCallReservation, dmMemoryProposalPrompt, dmMemoryProposerInstructions, dmMemoryVerificationPrompt,
  dmMemoryVerifierInstructions } from "../src/lib/dm-memory-learning-prompts";

export class DmLearningClientError extends Error {
  constructor(readonly code: typeof dmLearningFailureCodes[number], readonly usage?: DmLearningUsage) { super(`memory_${code}`); }
}

/** Shared by the provider and the private Worker API; never include response text in errors. */
export async function readDmLearningJson(response: Response, maximum = 1_048_576): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new DmLearningClientError("model_unavailable");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > maximum) { await reader.cancel(); throw new DmLearningClientError("invalid_proposal"); }
      chunks.push(part.value);
    }
  } finally { reader.releaseLock(); }
  const payload = new Uint8Array(bytes);
  let offset = 0;
  for (const part of chunks) { payload.set(part, offset); offset += part.length; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(payload)); }
  catch { throw new DmLearningClientError("invalid_proposal"); }
}

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER));
const completion = Schema.Struct({
  model: Schema.String,
  choices: Schema.Array(Schema.Struct({ finish_reason: Schema.Literal("stop"),
    message: Schema.Struct({ content: Schema.String,
      refusal: Schema.optional(Schema.NullOr(Schema.Literal(""))),
      tool_calls: Schema.optional(Schema.Array(Schema.Never)) }) })).check(Schema.isLengthBetween(1, 1)),
  usage: Schema.Struct({ prompt_tokens: count, completion_tokens: count,
    cost: Schema.optional(Schema.NullOr(Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)))) }),
});

function outputSchema(schema: typeof DmLearningProposal | typeof DmLearningVerification) {
  const document = JsonSchema.toDocumentDraft07(Schema.toJsonSchemaDocument(schema, { additionalProperties: false }));
  if (typeof document.schema === "boolean") throw new DmLearningClientError("model_configuration");
  return { ...document.schema, ...(Object.keys(document.definitions).length ? { definitions: document.definitions } : {}) };
}

function agentOutputSchema(schema: ReturnType<typeof outputSchema>): ReturnType<typeof outputSchema> {
  const flatten = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(flatten);
    if (!Predicate.isObject(value)) return value;
    const record = value as Record<string, unknown>;
    const normalized = Object.fromEntries(Object.entries(record)
      .filter(([key]) => key !== "allOf")
      .map(([key, item]) => [key, flatten(item)]));
    if (record.allOf === undefined) return normalized;
    if (!Array.isArray(record.allOf)) throw new DmLearningClientError("model_configuration");
    for (const member of record.allOf) {
      const flattened = flatten(member);
      if (!Predicate.isObject(flattened) || Array.isArray(flattened)) {
        throw new DmLearningClientError("model_configuration");
      }
      for (const [key, item] of Object.entries(flattened)) {
        if (key in normalized && JSON.stringify(normalized[key]) !== JSON.stringify(item)) {
          throw new DmLearningClientError("model_configuration");
        }
        normalized[key] = item;
      }
    }
    return normalized;
  };
  return flatten(schema) as ReturnType<typeof outputSchema>;
}

type DmLearningModelResult =
  | { proposal: DmLearningProposal; usage: DmLearningUsage }
  | { verification: DmLearningVerification; usage: DmLearningUsage };

export type DmLearningAgentTurn = (input: {
  agent: { id: string; name: string; provider: AgentProvider; model: string | null; effort?: string | null;
    responsibility: string; skill: string; skills: [] };
  prompt: string; workspacePath: string; fullAccess: false; readOnly: true; conversationId: null;
  attachments: []; skillCatalog: null; outputSchema: ReturnType<typeof outputSchema>;
  environment: NodeJS.ProcessEnv; signal: AbortSignal; onPayload: (payload: unknown) => void;
}) => Promise<{ exitCode: number | null; stderr: string; runnerError: string | null; completed: boolean;
  resultText: string | null; conversationId: string | null }>;

export type PrepareDmLearningAgentEnvironment = (provider: AgentProvider, input: {
  workspaceRoot: string; environment?: NodeJS.ProcessEnv;
}) => Promise<{ environment: NodeJS.ProcessEnv; cleanup: () => Promise<void> }>;

function decodeModelResult(invocation: DmLearningInvocation, value: unknown, usage: DmLearningUsage): DmLearningModelResult {
  return invocation.stage === "proposing"
    ? { proposal: Schema.decodeUnknownSync(DmLearningProposal)(value), usage }
    : { verification: Schema.decodeUnknownSync(DmLearningVerification)(value), usage };
}

async function invokeOpenRouterDmLearningModel(input: {
  invocation: DmLearningInvocation; apiKey: string | null; signal: AbortSignal; fetcher?: typeof fetch;
}): Promise<DmLearningModelResult> {
  const { invocation } = input;
  if (invocation.model.transport !== "openrouter") throw new DmLearningClientError("model_configuration");
  if (!input.apiKey?.trim()) throw new DmLearningClientError("model_credentials");
  const proposing = invocation.stage === "proposing";
  const prompt = proposing ? dmMemoryProposalPrompt(invocation.snapshot) : dmMemoryVerificationPrompt(invocation.snapshot, invocation.proposal!);
  const reservation = dmLearningCallReservation(invocation.model, prompt, invocation.stage);
  if (!reservation) throw new DmLearningClientError("model_configuration");
  const body = JSON.stringify({
    model: invocation.model.model, stream: false, max_tokens: invocation.model.maxOutputTokens,
    provider: { only: [invocation.model.upstreamProvider], allow_fallbacks: false,
      require_parameters: true, data_collection: "deny", zdr: true,
      max_price: { prompt: invocation.model.maxInputMicroUsdPerMillionTokens / 1_000_000,
        completion: invocation.model.maxOutputMicroUsdPerMillionTokens / 1_000_000, request: 0, image: 0 } },
    messages: [
      { role: "system", content: proposing ? dmMemoryProposerInstructions : dmMemoryVerifierInstructions },
      { role: "user", content: prompt },
    ],
    response_format: { type: "json_schema", json_schema: { name: proposing ? "memory_proposal" : "memory_verification",
      strict: true, schema: outputSchema(proposing ? DmLearningProposal : DmLearningVerification) } },
  });
  if (new TextEncoder().encode(body).length > 524_288) throw new DmLearningClientError("input_capacity");
  const timeout = AbortSignal.timeout(60_000);
  let usage: DmLearningUsage | undefined;
  try {
    const response = await (input.fetcher ?? fetch)("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST", redirect: "error", signal: AbortSignal.any([input.signal, timeout]),
      headers: { Authorization: `Bearer ${input.apiKey}`, "Content-Type": "application/json" }, body,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new DmLearningClientError([401, 402, 403].includes(response.status) ? "model_credentials"
        : [400, 404, 422].includes(response.status) ? "model_configuration"
        : [408, 504].includes(response.status) ? "model_timeout" : "model_unavailable");
    }
    const decoded = Schema.decodeUnknownSync(completion)(await readDmLearningJson(response));
    const costMicroUsd = decoded.usage.cost == null ? null : Math.ceil(decoded.usage.cost * 1_000_000);
    if (costMicroUsd !== null && !Number.isSafeInteger(costMicroUsd)) throw new DmLearningClientError("model_configuration");
    usage = { inputTokens: decoded.usage.prompt_tokens, outputTokens: decoded.usage.completion_tokens, costMicroUsd };
    if (decoded.model !== invocation.model.model || usage.outputTokens > invocation.model.maxOutputTokens ||
      usage.inputTokens > reservation.inputTokenCeiling || (costMicroUsd !== null && costMicroUsd > reservation.reservedMicroUsd)) {
      throw new DmLearningClientError("model_configuration", usage);
    }
    return decodeModelResult(invocation, JSON.parse(decoded.choices[0]!.message.content), usage);
  } catch (error) {
    if (input.signal.aborted) throw new DmLearningClientError("scope_revoked");
    if (timeout.aborted) throw new DmLearningClientError("model_timeout");
    if (error instanceof DmLearningClientError) throw new DmLearningClientError(error.code, usage ?? error.usage);
    if (Schema.isSchemaError(error) || error instanceof SyntaxError) throw new DmLearningClientError("invalid_proposal", usage);
    throw new DmLearningClientError("model_unavailable");
  }
}

async function invokeAgentDmLearningModel(input: {
  invocation: DmLearningInvocation; signal: AbortSignal; environment?: NodeJS.ProcessEnv;
  runAgentTurn?: DmLearningAgentTurn;
  prepareAgentEnvironment?: PrepareDmLearningAgentEnvironment;
}): Promise<DmLearningModelResult> {
  const { invocation } = input;
  if (invocation.model.transport !== "agent") throw new DmLearningClientError("model_configuration");
  const proposing = invocation.stage === "proposing";
  const instructions = proposing ? dmMemoryProposerInstructions : dmMemoryVerifierInstructions;
  const prompt = proposing ? dmMemoryProposalPrompt(invocation.snapshot)
    : dmMemoryVerificationPrompt(invocation.snapshot, invocation.proposal!);
  const reservation = dmLearningCallReservation(invocation.model, prompt, invocation.stage);
  if (!reservation) throw new DmLearningClientError("model_configuration");
  const workspacePath = await mkdtemp(join(tmpdir(), "briar-dm-memory-learning-"));
  await chmod(workspacePath, 0o700);
  const timeout = AbortSignal.timeout(120_000);
  let prepared: Awaited<ReturnType<PrepareDmLearningAgentEnvironment>> | null = null;
  let freeTierLimited = false;
  try {
    if (!input.prepareAgentEnvironment || !input.runAgentTurn) throw new DmLearningClientError("model_configuration");
    prepared = await input.prepareAgentEnvironment(invocation.model.provider, {
      workspaceRoot: workspacePath,
      environment: input.environment ?? process.env,
    });
    const result = await input.runAgentTurn({
      agent: {
        id: "dm-memory-learning",
        name: proposing ? "DM memory proposer" : "DM memory verifier",
        provider: invocation.model.provider,
        model: invocation.model.model,
        effort: invocation.model.effort,
        responsibility: instructions,
        skill: "",
        skills: [],
      },
      prompt,
      workspacePath,
      fullAccess: false,
      readOnly: true,
      conversationId: null,
      attachments: [],
      skillCatalog: null,
      outputSchema: agentOutputSchema(outputSchema(proposing ? DmLearningProposal : DmLearningVerification)),
      environment: prepared.environment,
      signal: AbortSignal.any([input.signal, timeout]),
      onPayload: (payload) => {
        if (Schema.is(Schema.Struct({ type: Schema.Literal("blocked"),
          reason: Schema.Literal("free_tier_limit") }))(payload)) freeTierLimited = true;
      },
    });
    if (freeTierLimited) throw new DmLearningClientError("budget_exhausted");
    if (result.exitCode !== 0 || result.runnerError || !result.completed || !result.resultText) {
      throw new DmLearningClientError("model_unavailable");
    }
    const inputTokens = Math.ceil(new TextEncoder().encode(instructions + prompt).length / 4);
    const outputTokens = Math.ceil(new TextEncoder().encode(result.resultText).length / 4);
    const usage = { inputTokens, outputTokens, costMicroUsd: null } satisfies DmLearningUsage;
    if (inputTokens > reservation.inputTokenCeiling || outputTokens > invocation.model.maxOutputTokens) {
      throw new DmLearningClientError("model_configuration", usage);
    }
    return decodeModelResult(invocation, JSON.parse(result.resultText), usage);
  } catch (error) {
    if (input.signal.aborted) throw new DmLearningClientError("scope_revoked");
    if (timeout.aborted) throw new DmLearningClientError("model_timeout");
    if (error instanceof DmLearningClientError) throw error;
    if (Schema.isSchemaError(error) || error instanceof SyntaxError) throw new DmLearningClientError("invalid_proposal");
    throw new DmLearningClientError("model_unavailable");
  } finally {
    await prepared?.cleanup().catch(() => undefined);
    await rm(workspacePath, { recursive: true, force: true });
  }
}

/** Two independent, stateless text-only calls; tools, project files and retained conversations stay unavailable. */
export async function invokeDmLearningModel(input: {
  invocation: DmLearningInvocation; apiKey: string | null; signal: AbortSignal;
  fetcher?: typeof fetch; environment?: NodeJS.ProcessEnv;
  runAgentTurn?: DmLearningAgentTurn;
  prepareAgentEnvironment?: PrepareDmLearningAgentEnvironment;
}): Promise<DmLearningModelResult> {
  const { invocation } = input;
  if (invocation.status !== "reserved") throw new DmLearningClientError("stale");
  if (invocation.stage === "verifying" && !invocation.proposal) throw new DmLearningClientError("stale");
  return invocation.model.transport === "agent" ? invokeAgentDmLearningModel(input)
    : invokeOpenRouterDmLearningModel(input);
}
