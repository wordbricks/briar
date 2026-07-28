import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

describe("project agents layout", () => {
  it("keeps the Agents page heading compact at every viewport size", () => {
    expect(styles.match(
      /\.project-agents-heading \{ min-height:unset; padding:8px 0;/gu,
    )).toHaveLength(2);
  });
});
