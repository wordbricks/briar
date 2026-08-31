import * as Option from "effect/Option";
import {
  decodeStructuredAgentResultJson,
  type StructuredAgentResult,
} from "../../src/lib/agent-result";
import { decodeAgentExecutionMetricsOption } from "../../src/lib/agent-execution-metrics";

export const parseJsonObject = (value: string | null) => {
  if (!value) return null;
  const parsed: unknown = JSON.parse(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? parsed
    : null;
};

export const parseStructuredResult = (
  value: string | null,
): StructuredAgentResult | null =>
  value === null ? null : decodeStructuredAgentResultJson(value);

export const parseExecutionMetrics = (value: string | null) =>
  Option.getOrNull(
    decodeAgentExecutionMetricsOption(parseJsonObject(value)),
  );
