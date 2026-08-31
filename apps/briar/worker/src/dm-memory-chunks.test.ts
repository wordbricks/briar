import { describe, expect, it } from "vitest";
import { Tiktoken } from "js-tiktoken/lite";
import ranks from "js-tiktoken/ranks/cl100k_base";
import { chunkDmMemory, dmMemoryCurrentSections, memoryUtf8Slice } from "./dm-memory-chunks";

const identity = { spaceId: "space", documentId: "document", version: 1, title: "설명 방식" };

describe("DM memory source ranges", () => {
  it("keeps a short independent observation whole and changes IDs with its version", async () => {
    const input = { ...identity, kind: "observation" as const, body: "짧게 답변하되 조건은 생략하지 않는다. 🧠" };
    const [chunk] = await chunkDmMemory(input);
    expect(chunk).toMatchObject({ startBytes: 0, endBytes: new TextEncoder().encode(input.body).length, lineStart: 1, lineEnd: 1 });
    expect(await chunkDmMemory(input)).toEqual([chunk]);
    expect((await chunkDmMemory({ ...input, version: 2 }))[0]?.vectorId).not.toBe(chunk?.vectorId);
  });

  it("indexes only Current, including nested headings, without treating code as headings", async () => {
    const body = "# Topic\n\n## Current\n\n현재 조건.\n\n### Detail\n\n```md\n## History\n코드 예제\n```\n\n## History\n\n폐기한 조건.\n";
    const chunks = await chunkDmMemory({ ...identity, kind: "topic", body });
    expect(chunks.length).toBe(2);
    expect(chunks.map((chunk) => chunk.embeddingText).join("\n")).toContain("코드 예제");
    expect(chunks.map((chunk) => chunk.embeddingText).join("\n")).not.toContain("폐기한 조건");
    expect(chunks[1]?.headings).toEqual(["Topic", "Current", "Detail"]);
    expect(dmMemoryCurrentSections("Current\n-------\n보존\n\nHistory\n-------\n제외\n", "topic")
      .map((section) => section.body).join("")).toContain("보존");
    expect(await chunkDmMemory({ ...identity, kind: "topic", body: "## History\n이전 정보" })).toEqual([]);
  });

  it("splits long multilingual paragraphs without losing characters or exceeding budgets", async () => {
    const body = ("조건을 보존한다 😀 e\u0301. Do not claim completion without evidence.\n").repeat(220);
    const chunks = await chunkDmMemory({ ...identity, kind: "observation", body });
    const bytes = new TextEncoder().encode(body);
    const coverage = new Uint8Array(bytes.length);
    const tokenizer = new Tiktoken(ranks);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(800);
      const slice = memoryUtf8Slice(body, chunk.startBytes, chunk.endBytes - chunk.startBytes);
      expect(chunk.embeddingText.endsWith(slice.body)).toBe(true);
      expect(slice.body).not.toContain("�");
      coverage.fill(1, chunk.startBytes, chunk.endBytes);
    }
    expect(coverage.every((value) => value === 1)).toBe(true);
    for (let i = 1; i < chunks.length; i++) {
      const previous = chunks[i - 1]!;
      const current = chunks[i]!;
      if (current.startBytes < previous.endBytes) {
        const overlap = memoryUtf8Slice(body, current.startBytes, previous.endBytes - current.startBytes).body;
        expect(tokenizer.encode(overlap, [], []).length).toBeLessThanOrEqual(64);
      }
    }
  });

  it("keeps heading paths and byte offsets tied to the original when paragraphs are packed", async () => {
    const body = "# 조건\n\n" + Array.from({ length: 40 }, (_, index) => `${index}. 한국어 조건을 잊지 않는다.\n\n`).join("");
    const chunks = await chunkDmMemory({ ...identity, kind: "observation", body });
    for (const chunk of chunks) {
      const content = memoryUtf8Slice(body, chunk.startBytes, chunk.endBytes - chunk.startBytes).body;
      expect(chunk.embeddingText.endsWith(content)).toBe(true);
      expect(chunk.lineStart).toBe(body.slice(0, body.indexOf(content)).split("\n").length);
    }
  });

  it("rejects partial UTF-8 offsets and resumes without splitting a character", () => {
    const body = "가🧠나";
    expect(() => memoryUtf8Slice(body, 1, 4)).toThrow("invalid_utf8_offset");
    expect(memoryUtf8Slice(body, 0, 5)).toEqual({ body: "가", offsetBytes: 0, endOffsetBytes: 3, nextOffsetBytes: 3 });
    expect(memoryUtf8Slice(body, 3, 7)).toEqual({ body: "🧠나", offsetBytes: 3, endOffsetBytes: 10, nextOffsetBytes: null });
  });

  it("bounds repeated heading context without dropping an oversized heading from the source ranges", async () => {
    const heading = "긴 제목의 조건을 보존한다. ".repeat(200);
    const body = `## ${heading}\n\n본문 조건도 보존한다.`;
    const chunks = await chunkDmMemory({ ...identity, title: "🧠".repeat(100), kind: "observation", body });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.tokenCount <= 800)).toBe(true);
    const covered = new Uint8Array(new TextEncoder().encode(body).length);
    for (const chunk of chunks) covered.fill(1, chunk.startBytes, chunk.endBytes);
    expect(covered.every((value) => value === 1)).toBe(true);
  });
});
