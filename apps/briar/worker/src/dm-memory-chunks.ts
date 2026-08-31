import { Tiktoken } from "js-tiktoken/lite";
import ranks from "js-tiktoken/ranks/cl100k_base";
import { sha256 } from "./crypto-digest";

// This is a reproducible chunk budget, not the embedding provider's billing tokenizer.
export const dmMemorySplitterProfile = "markdown-cl100k-js-1.0.21-v1";
export const dmMemoryEmbeddingProfile = "cf-bge-m3-1024-cosine-v1";
export const dmMemoryEmbeddingModel = "@cf/baai/bge-m3";
export const dmMemoryEmbeddingDimensions = 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
// Cache only the immutable tokenizer tables. Ordinary API requests never need
// to initialize them; request text and generated tokens are not retained.
let tokenizer: Tiktoken | undefined;
const countTokens = (text: string) => {
  tokenizer ??= new Tiktoken(ranks);
  return tokenizer.encode(text, [], []).length;
};

type Section = { start: number; end: number; headings: string[] };
export type DmMemoryChunk = {
  id: string; vectorId: string; startBytes: number; endBytes: number;
  lineStart: number; lineEnd: number; headings: string[]; tokenCount: number;
  embeddingText: string;
};

export function memoryUtf8Slice(text: string, offsetBytes: number, maxBytes: number) {
  const bytes = encoder.encode(text);
  if (offsetBytes < 0 || offsetBytes > bytes.length || !Number.isInteger(offsetBytes)
    || (offsetBytes < bytes.length && (bytes[offsetBytes]! & 0xc0) === 0x80)) {
    throw new Error("invalid_utf8_offset");
  }
  let end = Math.min(bytes.length, offsetBytes + maxBytes);
  while (end > offsetBytes && end < bytes.length && (bytes[end]! & 0xc0) === 0x80) end--;
  return { body: decoder.decode(bytes.subarray(offsetBytes, end)), offsetBytes,
    endOffsetBytes: end, nextOffsetBytes: end < bytes.length ? end : null };
}

function sections(body: string, kind: "observation" | "topic"): Section[] {
  const result: Section[] = [];
  const headings: Array<{ level: number; title: string }> = [];
  let start = 0;
  let offset = 0;
  let enabled = kind === "observation";
  let currentLevel: number | null = null;
  let fence: { character: string; length: number } | null = null;
  const lines = body.match(/.*(?:\n|$)/gu) ?? [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (!line) continue;
    const codeFence = /^ {0,3}(`{3,}|~{3,})/u.exec(line);
    if (fence) {
      if (codeFence?.[1]?.[0] === fence.character && codeFence[1].length >= fence.length
        && line.slice(codeFence[0].length).trim() === "") fence = null;
      offset += line.length;
      continue;
    }
    if (codeFence?.[1]) {
      fence = { character: codeFence[1][0]!, length: codeFence[1].length };
      offset += line.length;
      continue;
    }
    const atx = /^ {0,3}(#{1,6})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*\n?$/u.exec(line);
    const underline = !atx && line.trim() && !/^ {4}/u.test(line)
      ? /^ {0,3}(=+|-+)[ \t]*\n?$/u.exec(lines[index + 1] ?? "") : null;
    const level = atx?.[1]?.length ?? (underline ? underline[1]![0] === "=" ? 1 : 2 : 0);
    const title = atx?.[2]?.trim() ?? (underline ? line.trim() : "");
    if (level) {
      if (enabled && offset > start) result.push({ start, end: offset, headings: headings.map((h) => h.title) });
      while (headings.length && headings.at(-1)!.level >= level) headings.pop();
      headings.push({ level, title });
      if (kind === "topic") {
        if (currentLevel !== null && level <= currentLevel) { enabled = false; currentLevel = null; }
        if (title.toLowerCase() === "current") { enabled = true; currentLevel = level; }
      }
      start = offset;
      if (underline) { offset += line.length + lines[index + 1]!.length; index++; continue; }
    }
    offset += line.length;
  }
  if (enabled && body.length > start) result.push({ start, end: body.length, headings: headings.map((h) => h.title) });
  return result.filter((section) => body.slice(section.start, section.end).trim().length > 0);
}

// Offsets stay in the original normalized Markdown. History is never concatenated
// into Current, so excerpts cannot accidentally cross an excluded section.
export function dmMemoryCurrentSections(body: string, kind: "observation" | "topic") {
  return sections(body, kind).map((section) => ({
    headings: section.headings, body: body.slice(section.start, section.end),
    offsetBytes: encoder.encode(body.slice(0, section.start)).length,
    endOffsetBytes: encoder.encode(body.slice(0, section.end)).length,
  }));
}

function prefixLength(characters: string[], start: number, end: number, budget: number) {
  let low = start + 1;
  let high = Math.min(end, start + budget * 16);
  let accepted = start;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (countTokens(characters.slice(start, mid).join("")) <= budget) { accepted = mid; low = mid + 1; }
    else high = mid - 1;
  }
  return accepted;
}

export function dmMemoryEmbeddingPrefix(title: string, headings: readonly string[]) {
  const text = [title, ...headings].join(" > ");
  if (countTokens(`${text}\n\n`) <= 128) return `${text}\n\n`;
  const characters = Array.from(text);
  const end = prefixLength(characters, 0, characters.length, 120);
  return `${characters.slice(0, end).join("")}…\n\n`;
}

export async function chunkDmMemory(input: {
  spaceId: string; documentId: string; version: number; title: string;
  kind: "observation" | "topic"; body: string;
}): Promise<DmMemoryChunk[]> {
  const body = input.body;
  if (body.includes("\r")) throw new Error("memory_body_not_normalized");
  const ranges: Array<Section & { tokenCount: number; embeddingText: string }> = [];
  const addRange = (start: number, end: number, headings: string[], prefix: string) => {
    const content = body.slice(start, end);
    if (!content.trim()) return;
    const embeddingText = `${prefix}${content}`;
    const tokenCount = countTokens(embeddingText);
    if (tokenCount > 800) throw new Error("memory_chunk_token_limit");
    ranges.push({ start, end, headings, tokenCount, embeddingText });
  };
  const wholePrefix = dmMemoryEmbeddingPrefix(input.title, []);
  if (input.kind === "observation" && countTokens(wholePrefix + body) <= 800) {
    addRange(0, body.length, [], wholePrefix);
  } else for (const section of sections(body, input.kind)) {
    const prefix = dmMemoryEmbeddingPrefix(input.title, section.headings);
    const prefixTokens = countTokens(prefix);
    const target = 400 - prefixTokens;
    const maximum = 800 - prefixTokens;
    const text = body.slice(section.start, section.end);
    if (countTokens(prefix + text) <= 800) {
      addRange(section.start, section.end, section.headings, prefix);
      continue;
    }
    const paragraphs = text.matchAll(/[^\n](?:[^\n]|\n(?!\s*\n))*(?:\n\s*\n|$)/gu);
    let pendingStart = section.start;
    let pendingEnd = section.start;
    for (const paragraph of paragraphs) {
      const start = section.start + paragraph.index;
      const end = start + paragraph[0].length;
      const paragraphTokens = countTokens(body.slice(start, end));
      if (pendingEnd > pendingStart && countTokens(body.slice(pendingStart, end)) > target) {
        addRange(pendingStart, pendingEnd, section.headings, prefix);
        pendingStart = start;
      }
      if (paragraphTokens <= maximum) {
        if (pendingEnd <= pendingStart) pendingStart = start;
        pendingEnd = end;
        continue;
      }
      const characters = Array.from(body.slice(start, end));
      const offsets = [start];
      for (const character of characters) offsets.push(offsets.at(-1)! + character.length);
      let cursor = 0;
      while (cursor < characters.length) {
        const next = prefixLength(characters, cursor, characters.length, target);
        if (next <= cursor) throw new Error("memory_chunk_cannot_advance");
        addRange(offsets[cursor]!, offsets[next]!, section.headings, prefix);
        if (next === characters.length) break;
        let overlap = next;
        // A suffix is at most 64 tokens. It never crosses a paragraph or section.
        while (overlap > cursor + 1
          && countTokens(characters.slice(overlap - 1, next).join("")) <= 64) overlap--;
        cursor = overlap;
      }
      pendingStart = end;
      pendingEnd = end;
    }
    if (pendingEnd > pendingStart) addRange(pendingStart, pendingEnd, section.headings, prefix);
  }
  return Promise.all(ranges.map(async (range) => {
    const startBytes = encoder.encode(body.slice(0, range.start)).length;
    const endBytes = encoder.encode(body.slice(0, range.end)).length;
    const id = await sha256(JSON.stringify([input.spaceId, input.documentId, input.version,
      dmMemorySplitterProfile, startBytes, endBytes]));
    return { id, vectorId: await sha256(`${id}:${dmMemoryEmbeddingProfile}`),
      startBytes, endBytes, lineStart: body.slice(0, range.start).split("\n").length,
      lineEnd: body.slice(0, range.end).trimEnd().split("\n").length,
      headings: range.headings, tokenCount: range.tokenCount, embeddingText: range.embeddingText };
  }));
}
