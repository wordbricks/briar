import type { ChannelMessage } from "./channels-contract";

const httpUrlPattern = /https?:\/\/[^\s<>"`]+/giu;
const maxUrlLength = 2_048;

function unmatchedClosingCount(value: string, opening: string, closing: string) {
  let count = 0;
  for (const character of value) {
    if (character === opening) count += 1;
    if (character === closing) count -= 1;
  }
  return count;
}

function trimUrlCandidate(raw: string) {
  let candidate = raw;
  const pipeIndex = candidate.indexOf("|");
  if (pipeIndex >= 0) candidate = candidate.slice(0, pipeIndex);
  candidate = candidate.replace(/[.,!?;:'"]+$/u, "");
  for (const [opening, closing] of [["(", ")"], ["[", "]"], ["{", "}"]] as const) {
    while (
      candidate.endsWith(closing) &&
      unmatchedClosingCount(candidate, opening, closing) < 0
    ) {
      candidate = candidate.slice(0, -1);
    }
  }
  return candidate;
}

/** Finds the first absolute HTTP(S) URL in message text or structured blocks. */
export function firstHttpUrl(value: string) {
  for (const match of value.matchAll(httpUrlPattern)) {
    const candidate = trimUrlCandidate(match[0]);
    if (candidate.length > maxUrlLength) continue;
    try {
      const url = new URL(candidate);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password
      ) {
        return url.href;
      }
    } catch {
      // Ignore malformed URLs and continue looking for the next link.
    }
  }
  return null;
}

export function channelMessageLinkPreviewUrl(
  message: Pick<ChannelMessage, "body" | "blocks">,
) {
  const bodyUrl = firstHttpUrl(message.body);
  if (bodyUrl) return bodyUrl;
  if (!message.blocks?.length) return null;
  try {
    return firstHttpUrl(JSON.stringify(message.blocks));
  } catch {
    return null;
  }
}
