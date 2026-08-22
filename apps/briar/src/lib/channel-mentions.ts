/**
 * Channel mentions resolve at compose time, not at send time. The picker turns
 * a typed handle into an entity and the server trusts only that structured
 * list, so a handle collision between a member and an Agent stays a display
 * problem instead of routing a message to the wrong recipient.
 */
export type MentionTarget = {
  type: "user" | "agent";
  id: string;
  handle: string;
  label: string;
  detail: string;
  image?: string | null;
};

export { mentionAtCaret, type MentionQuery } from "./mention-token";

/** Produces a token the mention parser can recognize even for a display name. */
export function mentionHandle(value: string) {
  return (
    value
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "member"
  );
}

/**
 * Drops mentions whose handle no longer appears in the body. Editing away a
 * handle after picking it must not leave a hidden recipient attached.
 */
export function retainedMentions(
  body: string,
  mentions: readonly MentionTarget[],
) {
  return mentions.filter((mention) =>
    new RegExp(
      `(^|[^\\p{L}\\p{N}_.-])@${mention.handle.replace(
        /[.*+?^${}()|[\]\\]/gu,
        "\\$&",
      )}(?=$|[^\\p{L}\\p{N}_.-])`,
      "u",
    ).test(body),
  );
}
