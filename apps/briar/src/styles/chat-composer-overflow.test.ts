import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src", "styles.css"), "utf8");

describe("chat composer overflow", () => {
  it("never displays scrollbars in shared chat textareas", () => {
    const textareaRule = styles.match(
      /\.mention-composer-field > textarea \{[^}]+overflow:hidden;[^}]+\}/u,
    )?.[0];

    expect(textareaRule).toBeDefined();
  });
});
