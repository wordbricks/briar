export type ConnectedMention = {
  key: string;
  handle: string;
  label?: string;
};

export type ConnectedMentionSegment =
  | {
      type: "text";
      start: number;
      end: number;
      value: string;
    }
  | {
      type: "mention";
      start: number;
      end: number;
      value: string;
      mention: ConnectedMention;
    };

const mentionBoundaryCharacters = "\\p{L}\\p{N}_.-";

function escapeRegularExpression(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Splits composer text without inferring recipients from text alone. Only the
 * handles supplied by the caller become connected mention segments.
 */
export function connectedMentionSegments(
  body: string,
  mentions: readonly ConnectedMention[],
): ConnectedMentionSegment[] {
  if (!body) return [];

  const mentionsByHandle = new Map<string, ConnectedMention>();
  for (const mention of mentions) {
    const handle = mention.handle.replace(/^@/u, "").toLocaleLowerCase();
    if (handle && !mentionsByHandle.has(handle)) {
      mentionsByHandle.set(handle, { ...mention, handle });
    }
  }
  if (mentionsByHandle.size === 0) {
    return [{ type: "text", start: 0, end: body.length, value: body }];
  }

  const alternatives = [...mentionsByHandle.keys()]
    .sort((left, right) => right.length - left.length)
    .map(escapeRegularExpression)
    .join("|");
  const matcher = new RegExp(
    `(^|[^${mentionBoundaryCharacters}])(@(?:${alternatives}))(?=$|[^${mentionBoundaryCharacters}])`,
    "giu",
  );
  const segments: ConnectedMentionSegment[] = [];
  let cursor = 0;

  for (const match of body.matchAll(matcher)) {
    const value = match[2];
    if (!value) continue;
    const mention = mentionsByHandle.get(
      value.slice(1).toLocaleLowerCase(),
    );
    if (!mention) continue;
    const start = (match.index ?? 0) + match[1].length;
    if (start > cursor) {
      segments.push({
        type: "text",
        start: cursor,
        end: start,
        value: body.slice(cursor, start),
      });
    }
    const end = start + value.length;
    segments.push({ type: "mention", start, end, value, mention });
    cursor = end;
  }

  if (cursor < body.length) {
    segments.push({
      type: "text",
      start: cursor,
      end: body.length,
      value: body.slice(cursor),
    });
  }
  return segments;
}
