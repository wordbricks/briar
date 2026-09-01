import type { AgentProvider } from "../src/lib/agent-provider";
import * as Schema from "effect/Schema";
import type { CodecTransformer } from "effect/unstable/ai/LanguageModel";
import * as AnthropicStructuredOutput from "effect/unstable/ai/AnthropicStructuredOutput";
import * as OpenAiStructuredOutput from "effect/unstable/ai/OpenAiStructuredOutput";

const providerCodecTransformers = {
  codex: OpenAiStructuredOutput.toCodecOpenAI,
  claude: AnthropicStructuredOutput.toCodecAnthropic,
  cursor: OpenAiStructuredOutput.toCodecOpenAI,
  grok: OpenAiStructuredOutput.toCodecOpenAI,
  agy: OpenAiStructuredOutput.toCodecOpenAI,
  opencode: OpenAiStructuredOutput.toCodecOpenAI,
  openrouter: OpenAiStructuredOutput.toCodecOpenAI,
} satisfies Record<AgentProvider, CodecTransformer>;

const strictSchemaOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;

/**
 * The provider schema and runtime decoder must come from the same transformed
 * codec. Provider adapters may deliberately weaken unsupported JSON Schema
 * constraints while the returned codec remains authoritative.
 */
export function providerStructuredOutputContract<T, E, RE>(
  provider: AgentProvider,
  schema: Schema.ConstraintCodec<T, E, never, RE>,
) {
  const transformed = providerCodecTransformers[provider](schema);
  const decode = Schema.decodeUnknownSync(
    transformed.codec,
    strictSchemaOptions,
  );
  const decodeJson = Schema.decodeUnknownSync(
    Schema.fromJsonString(transformed.codec),
    strictSchemaOptions,
  );
  return {
    jsonSchema: transformed.jsonSchema,
    decode,
    decodeJson,
  };
}
