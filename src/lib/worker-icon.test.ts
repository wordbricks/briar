import { describe, expect, it } from "vitest";

import { isWorkerEmoji } from "./worker-icon";

describe("worker icons", () => {
  it("accepts one emoji grapheme, including joined and flag sequences", () => {
    expect(isWorkerEmoji("🍋")).toBe(true);
    expect(isWorkerEmoji("👩🏽‍💻")).toBe(true);
    expect(isWorkerEmoji("🇰🇷")).toBe(true);
  });

  it("rejects text and multiple emoji graphemes", () => {
    expect(isWorkerEmoji("worker")).toBe(false);
    expect(isWorkerEmoji("🍋🥭")).toBe(false);
    expect(isWorkerEmoji("")).toBe(false);
  });
});
