import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

describe("project agents layout", () => {
  it("keeps the shared page heading compact and full width", () => {
    expect(styles).toContain(
      ".project-agents-content { min-height:100%; padding:0 0 54px; }",
    );
    expect(styles).toContain(
      ".page-header.app-page-header {\n  min-height:unset;\n  padding:10px 32px;",
    );
    expect(styles).toContain(
      ".page-header.app-page-header > div:first-child > p:last-child {\n  max-width:720px;\n  margin:6px 0 0;",
    );
  });
});
