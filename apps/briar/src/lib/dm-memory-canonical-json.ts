import * as Predicate from "effect/Predicate";

/** Field ordering must not change a proposal, input or policy identity. */
export function dmMemoryCanonicalJson(value: unknown): string {
  const result = JSON.stringify(value, (_key, item: unknown) =>
    Predicate.isObject(item) && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
      : item,
  );
  if (result === undefined) throw new Error("Memory data is not JSON");
  return result;
}
