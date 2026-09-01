import * as JsonSchema from "effect/JsonSchema";
import * as Schema from "effect/Schema";
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

/** Two independent text-only calls; no coding-agent process, tools, files or provider conversation. */
export async function invokeDmLearningModel(input: {
  invocation: DmLearningInvocation; apiKey: string | null; signal: AbortSignal;
  fetcher?: typeof fetch;
}): Promise<{ proposal: DmLearningProposal; usage: DmLearningUsage } | { verification: DmLearningVerification; usage: DmLearningUsage }> {
  const { invocation } = input;
  if (!input.apiKey?.trim()) throw new DmLearningClientError("model_credentials");
  if (invocation.status !== "reserved") throw new DmLearningClientError("stale");
  const proposing = invocation.stage === "proposing";
  if (!proposing && !invocation.proposal) throw new DmLearningClientError("stale");
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
    const value: unknown = JSON.parse(decoded.choices[0]!.message.content);
    return proposing ? { proposal: Schema.decodeUnknownSync(DmLearningProposal)(value), usage }
      : { verification: Schema.decodeUnknownSync(DmLearningVerification)(value), usage };
  } catch (error) {
    if (input.signal.aborted) throw new DmLearningClientError("scope_revoked");
    if (timeout.aborted) throw new DmLearningClientError("model_timeout");
    if (error instanceof DmLearningClientError) throw new DmLearningClientError(error.code, usage ?? error.usage);
    if (Schema.isSchemaError(error) || error instanceof SyntaxError) throw new DmLearningClientError("invalid_proposal", usage);
    throw new DmLearningClientError("model_unavailable");
  }
}
