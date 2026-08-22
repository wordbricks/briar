export type MentionQuery = {
  start: number;
  end: number;
  query: string;
};

export function mentionAtCaret(
  body: string,
  caret: number,
): MentionQuery | null {
  if (!Number.isInteger(caret) || caret < 0 || caret > body.length) return null;
  const match = body
    .slice(0, caret)
    .match(/(^|[^\p{L}\p{N}_.-])@([^@\r\n]*)$/u);
  if (!match) return null;
  return {
    start: caret - match[2].length - 1,
    end: caret,
    query: match[2],
  };
}
