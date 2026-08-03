import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const indexMarkup = readFileSync(
  new URL("../../index.html", import.meta.url),
  "utf8",
);

describe("desktop startup error fallback", () => {
  it("loads through a CSP-compatible external bundle", () => {
    expect(indexMarkup).toContain(
      '<script type="module" src="/src/startup-error.ts"></script>',
    );
    expect(indexMarkup).not.toMatch(
      /<script(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/iu,
    );
  });
});
