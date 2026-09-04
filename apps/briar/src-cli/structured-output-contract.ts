import type { AgentProvider } from "../src/lib/agent-provider";
import * as Schema from "effect/Schema";
import type * as JsonSchema from "effect/JsonSchema";
import type { CodecTransformer } from "effect/unstable/ai/LanguageModel";
import * as AnthropicStructuredOutput from "effect/unstable/ai/AnthropicStructuredOutput";
import * as OpenAiStructuredOutput from "effect/unstable/ai/OpenAiStructuredOutput";

/** Keywords whose values are literal data rather than nested schemas. */
const jsonSchemaLiteralKeywords = new Set([
  "const",
  "default",
  "enum",
  "examples",
]);

/** Keywords whose values map member names to nested schemas. */
const jsonSchemaMapKeywords = new Set([
  "$defs",
  "definitions",
  "patternProperties",
  "properties",
]);

const isJsonSchemaNode = (value: unknown): value is JsonSchema.JsonSchema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function withoutJsonSchemaFormats(
  schema: JsonSchema.JsonSchema,
): JsonSchema.JsonSchema {
  const rewritten: JsonSchema.JsonSchema = {};
  for (const [keyword, value] of Object.entries(schema)) {
    if (keyword === "format") continue;
    if (jsonSchemaLiteralKeywords.has(keyword)) {
      rewritten[keyword] = value;
      continue;
    }
    // Member names are data, so only the schemas they point at are rewritten.
    rewritten[keyword] = jsonSchemaMapKeywords.has(keyword) &&
        isJsonSchemaNode(value)
      ? Object.fromEntries(
        Object.entries(value).map(([member, nested]) => [
          member,
          rewriteJsonSchemaValue(nested),
        ]),
      )
      : rewriteJsonSchemaValue(value);
  }
  return rewritten;
}

function rewriteJsonSchemaValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteJsonSchemaValue);
  return isJsonSchemaNode(value) ? withoutJsonSchemaFormats(value) : value;
}

/**
 * Claude Code abandons structured output without any error when the provider
 * schema carries a `format` keyword: the turn returns no `structured_output`,
 * the runner falls back to the model's free text, and the strict JSON decode
 * then rejects that text. Effect keeps the formats Anthropic documents as
 * supported, so drop them here. The codec still enforces the constraint and the
 * emitted `pattern` still describes it to the model.
 */
const toCodecClaudeCode: CodecTransformer = (schema) => {
  const transformed = AnthropicStructuredOutput.toCodecAnthropic(schema);
  return {
    codec: transformed.codec,
    jsonSchema: withoutJsonSchemaFormats(transformed.jsonSchema),
  };
};

const providerCodecTransformers = {
  codex: OpenAiStructuredOutput.toCodecOpenAI,
  claude: toCodecClaudeCode,
  cursor: OpenAiStructuredOutput.toCodecOpenAI,
  grok: OpenAiStructuredOutput.toCodecOpenAI,
  agy: OpenAiStructuredOutput.toCodecOpenAI,
  opencode: OpenAiStructuredOutput.toCodecOpenAI,
  openrouter: OpenAiStructuredOutput.toCodecOpenAI,
  vertex: OpenAiStructuredOutput.toCodecOpenAI,
  pi: OpenAiStructuredOutput.toCodecOpenAI,
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
