import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src", "styles.css"), "utf8");

describe("channel message whitespace", () => {
  it("preserves line breaks in rendered message paragraphs", () => {
    const paragraphRule = styles.match(
      /\.channel-message-text p \{[^}]+\}/u,
    )?.[0];

    expect(paragraphRule).toContain("white-space:pre-wrap");
  });
});
