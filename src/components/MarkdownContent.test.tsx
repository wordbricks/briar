import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("renders GFM links, lists, and scrollable tables through the shared surface", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent className="test-markdown">
        {[
          "- first item",
          "- second item",
          "",
          "https://example.com/docs",
          "",
          "| Name | Detail |",
          "| --- | --- |",
          "| item | value |",
        ].join("\n")}
      </MarkdownContent>,
    );

    expect(markup).toContain('class="test-markdown markdown-content"');
    expect(markup).toContain("<ul>");
    expect(markup).toContain('<a href="https://example.com/docs">');
    expect(markup).toContain('<div class="markdown-table-wrap"><table>');
  });

  it("keeps raw HTML disabled for every consumer", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>{"before <script>alert('x')</script> after"}</MarkdownContent>,
    );

    expect(markup).not.toContain("<script>");
    expect(markup).toContain("before alert(&#x27;x&#x27;) after");
  });
});
