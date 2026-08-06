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
};

export type MentionQuery = {
  start: number;
  end: number;
  query: string;
};

/**
 * Finds the `@` token the caret sits inside, if any. Mirrors the issue
 * conversation rule that a mention must start at a word boundary.
 */
export function mentionAtCaret(
  body: string,
  caret: number,
): MentionQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > body.length) return null;
  const match = body
    .slice(0, caret)
    .match(/(^|[^\p{L}\p{N}_.-])@([\p{L}\p{N}_.-]*)$/u);
  if (!match) return null;
  return {
    start: caret - match[2].length - 1,
    end: caret,
    query: match[2],
  };
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
