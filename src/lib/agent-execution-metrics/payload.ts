import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { AGENT_EXECUTION_USD_TICKS_PER_DOLLAR } from "../agent-execution-cost";
import { NonnegativeSafeInteger } from "./codec";

const NonnegativeUsd = Schema.Finite.check(
  Schema.isGreaterThanOrEqualTo(0),
);

const decodeNonEmptyString = Schema.decodeUnknownOption(
  Schema.Trim.check(Schema.isNonEmpty()),
);
const decodeTokenCount = Schema.decodeUnknownOption(NonnegativeSafeInteger);
const decodeNonnegativeUsd = Schema.decodeUnknownOption(NonnegativeUsd);

export type ProviderPayloadRecord = Readonly<Record<string, unknown>>;

export const asRecord = (
  value: unknown,
): ProviderPayloadRecord | null =>
  Predicate.isObject(value) ? value : null;

export const nonEmptyString = (value: unknown): string | null =>
  Option.getOrNull(decodeNonEmptyString(value));

export const tokenValue = (
  record: ProviderPayloadRecord,
  ...keys: string[]
): number | null => {
  for (const key of keys) {
    const value = Option.getOrNull(decodeTokenCount(record[key]));
    if (value !== null) return value;
  }
  return null;
};

export const tokenSum = (...values: Array<number | null>): number | null => {
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Option.getOrNull(decodeTokenCount(total));
};

export const usdAmountToTicks = (value: unknown): number | null => {
  const amount = Option.getOrNull(decodeNonnegativeUsd(value));
  if (amount === null) return null;
  return Option.getOrNull(
    decodeTokenCount(
      Math.round(amount * AGENT_EXECUTION_USD_TICKS_PER_DOLLAR),
    ),
  );
};

export const exactUsdTicks = (
  record: ProviderPayloadRecord,
): number | null => tokenValue(record, "costUsdTicks", "cost_usd_ticks");

export const runnerPayload = (payload: unknown) => {
  const root = asRecord(payload);
  if (!root) return null;
  return asRecord(root.raw) ?? root;
};

export const dedupeKey = (...parts: Array<string | null>) =>
  parts.every((part) => part !== null) ? parts.join(":") : null;
