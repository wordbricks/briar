/**
 * One ephemeral progress update, sent by the Agent as a message of its own
 * while a reply is still being worked on: `{"progress":"what I am doing now"}`.
 *
 * The shape is deliberately disjoint from every reply completion envelope:
 * those require `body` (channels) or `reply` (issues) and reject excess
 * members, this one requires `progress` and nothing else, so neither can ever
 * be read as the other. That single member is the whole discriminator, which
 * keeps an update cheap enough to be worth emitting mid-turn.
 *
 * This is a leaf module on purpose. Every provider runner in `src-agent`
 * imports it to keep a progress update out of the turn's final answer, and
 * those bundles ship into sandboxes — so it carries no schema library and no
 * generated protobuf, only the reading of one small object.
 */

/** The longest headline a progress update may show. */
export const AGENT_PROGRESS_HEADLINE_MAX_LENGTH = 240;

const fencedJsonBlock = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu;

/** The whole message read as one JSON object, or null. Never throws. */
function wholeJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const unfenced = (fencedJsonBlock.exec(trimmed)?.[1] ?? trimmed).trim();
  if (!unfenced.startsWith("{") || !unfenced.endsWith("}")) return null;
  try {
    const parsed: unknown = JSON.parse(unfenced);
    return parsed !== null && typeof parsed === "object" &&
        !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/**
 * Reads one Agent message as a progress update, or returns null when it is
 * anything else: a reply envelope, plain narration, or truncated JSON. Both
 * the activity publisher and the provider runners call this on every
 * assistant message, so it must never throw.
 *
 * An over-length headline is clamped rather than rejected. Rejecting would
 * both hide the update from the typing strip and let a runner adopt it as the
 * turn's final answer — the two failures this type exists to prevent.
 */
export function agentProgressMessage(
  text: string,
): { readonly headline: string } | null {
  const message = wholeJsonObject(text);
  if (!message) return null;
  const keys = Object.keys(message);
  if (keys.length !== 1 || keys[0] !== "progress") return null;
  const { progress } = message;
  if (typeof progress !== "string") return null;
  const headline = progress
    .trim()
    .slice(0, AGENT_PROGRESS_HEADLINE_MAX_LENGTH)
    .replace(/[\uD800-\uDBFF]$/u, "");
  return headline ? { headline } : null;
}
