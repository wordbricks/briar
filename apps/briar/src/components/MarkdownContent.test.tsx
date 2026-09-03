/** @vitest-environment jsdom */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { htmlToMarkdown } from "../lib/clipboard-html-to-markdown";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("keeps raw HTML disabled for every consumer", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>{"before <script>alert('x')</script> after"}</MarkdownContent>,
    );

    expect(markup).not.toContain("<script>");
    expect(markup).toContain("before alert(&#x27;x&#x27;) after");
  });

  it("renders underline tags from formatted paste without enabling other HTML", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>
        {"<u>**인지도**</u> and <script>alert('x')</script>"}
      </MarkdownContent>,
    );

    expect(markup).toContain("<u><strong>인지도</strong></u>");
    expect(markup).not.toContain("<script>");
  });

  it("renders pasted nested lists, bold, underline, and links", () => {
    const markdown = htmlToMarkdown(`
      <ol>
        <li>
          <span style="font-weight:700">기준</span>
          <ol>
            <li><u>하위</u></li>
          </ol>
        </li>
        <li><a href="https://example.com/x">자료</a></li>
      </ol>
    `);
    const markup = renderToStaticMarkup(
      <MarkdownContent>{markdown}</MarkdownContent>,
    );

    expect(markup).toContain("<ol>");
    expect(markup).toContain("<strong>기준</strong>");
    expect(markup).toContain("<u>하위</u>");
    expect(markup).toContain("href=\"https://example.com/x\"");
    expect(markup).toContain("자료");
  });
});
