export type HyperlinkSegment =
  | { type: "text"; start: number; end: number; value: string }
  | { type: "link"; start: number; end: number; value: string; url: string };

const linkCandidatePattern = /(?:https?:\/\/|www\.)[^\s<>"']+/gi;

function linkUrl(value: string): string {
  return value.toLowerCase().startsWith("www.") ? `http://${value}` : value;
}

function trimmedLinkValue(raw: string): string {
  let value = raw;
  while (value.length > 0) {
    const last = value[value.length - 1]!;
    if (/[.,;:!?'"`]/.test(last)) {
      value = value.slice(0, -1);
      continue;
    }
    if (last === ")" || last === "]" || last === "}") {
      const opening = last === ")" ? "(" : last === "]" ? "[" : "{";
      const current = value.slice(0, -1);
      const openings = [...current].filter((char) => char === opening).length;
      const closings = [...current].filter((char) => char === last).length;
      if (closings >= openings) {
        value = current;
        continue;
      }
    }
    break;
  }
  return value;
}

/**
 * Splits plain text into segments, marking URL-like runs as clickable links.
 * Matches http(s):// and www. URLs and strips trailing punctuation that is
 * almost always sentence decoration rather than part of the destination.
 */
export function hyperlinkSegments(value: string): HyperlinkSegment[] {
  const segments: HyperlinkSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(linkCandidatePattern)) {
    const start = match.index ?? 0;
    if (start < cursor) {
      continue;
    }
    const raw = match[0];
    const trimmed = trimmedLinkValue(raw);
    if (trimmed.length === 0) continue;
    const end = start + trimmed.length;
    if (start > cursor) {
      segments.push({
        type: "text",
        start: cursor,
        end: start,
        value: value.slice(cursor, start),
      });
    }
    const url = linkUrl(trimmed);
    segments.push({ type: "link", start, end, value: trimmed, url });
    cursor = end;
  }
  if (cursor < value.length) {
    segments.push({
      type: "text",
      start: cursor,
      end: value.length,
      value: value.slice(cursor),
    });
  }
  if (segments.length === 0 && value.length > 0) {
    return [{ type: "text", start: 0, end: value.length, value }];
  }
  return segments;
}