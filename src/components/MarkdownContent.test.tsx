import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./MarkdownContent";

describe("MarkdownContent", () => {
  it("keeps raw HTML disabled for every consumer", () => {
    const markup = renderToStaticMarkup(
      <MarkdownContent>{"before <script>alert('x')</script> after"}</MarkdownContent>,
    );

    expect(markup).not.toContain("<script>");
    expect(markup).toContain("before alert(&#x27;x&#x27;) after");
  });
});
