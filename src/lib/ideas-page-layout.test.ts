import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

const ideasSource = readFileSync(
  new URL("../components/Ideas.tsx", import.meta.url),
  "utf8",
);

describe("ideas page layout", () => {
  it("fills the app-shell instead of the full viewport under the status bar", () => {
    expect(styles).toMatch(
      /\.ideas-page,\s*\.idea-detail-page \{[^}]*min-height:\s*0;[^}]*height:\s*100%;/,
    );
    expect(styles).toMatch(
      /\.idea-detail-page \{[^}]*overflow:\s*hidden;/,
    );
    expect(styles).toMatch(
      /\.idea-split \{[^}]*min-height:\s*0;[^}]*flex:\s*1;/,
    );
    expect(styles).not.toMatch(
      /\.idea-detail-page\s*\{[^}]*height:\s*100vh/,
    );
    expect(styles).not.toMatch(
      /\.idea-split\s*\{[^}]*height:\s*calc\(100vh/,
    );
  });

  it("keeps the chat composer inside the pane above the status bar", () => {
    expect(styles).toMatch(
      /\.idea-composer \{[^}]*flex:\s*0\s+0\s+auto;/,
    );
    expect(styles).toMatch(
      /\.idea-messages \{[^}]*min-height:\s*0;[^}]*overflow:\s*auto;/,
    );
  });

  it("shows only rendered markdown in the document pane", () => {
    expect(styles).toMatch(
      /\.document-workspace \{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/,
    );
    expect(styles).not.toMatch(
      /\.document-workspace\s*\{[^}]*grid-template-columns:\s*1fr\s+1fr/,
    );
    expect(styles).not.toContain(".document-workspace > textarea");
    expect(ideasSource).toContain('className="idea-markdown-preview"');
    expect(ideasSource).toContain("ReactMarkdown");
    expect(ideasSource).not.toMatch(
      /aria-label="아이디어 Markdown 문서"/,
    );
    expect(ideasSource).not.toMatch(
      /placeholder="# 아이디어\\n\\n대화를 시작하면 문서가 작성됩니다\."/,
    );
  });
});
