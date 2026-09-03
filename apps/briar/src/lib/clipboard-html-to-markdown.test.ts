/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";
import {
  htmlToMarkdown,
  markdownFromClipboardHtml,
} from "./clipboard-html-to-markdown";

describe("htmlToMarkdown", () => {
  it("keeps bold, underline, nested lists, tabs, and links", () => {
    const markdown = htmlToMarkdown(`
      <p><span style="font-weight:700;text-decoration:underline">인지도와 영향력</span></p>
      <ol>
        <li>
          <p>기준을 정하기</p>
          <ol>
            <li>2차 관계</li>
            <li>감의 영역</li>
          </ol>
        </li>
        <li>협업 자료는 <a href="https://example.com/brief">brief</a></li>
      </ol>
      <p>indent<span>\t</span>tab</p>
    `);

    expect(markdown).toContain("<u>**인지도와 영향력**</u>");
    expect(markdown).toContain("1. 기준을 정하기");
    expect(markdown).toContain("\t1. 2차 관계");
    expect(markdown).toContain("\t2. 감의 영역");
    expect(markdown).toContain("2. 협업 자료는 [brief](https://example.com/brief)");
    expect(markdown).toContain("indent\ttab");
  });

  it("keeps separate paragraphs inside a list item", () => {
    expect(
      htmlToMarkdown("<ul><li><p>first</p><p>second</p></li></ul>"),
    ).toMatch(/^-\s+first\n\tsecond$/);
  });

  it("does not treat the Google Docs wrapper as bold", () => {
    const markdown = htmlToMarkdown(`
      <b style="font-weight:normal;" id="docs-internal-guid-abc">
        <p><span style="font-weight:700">강조</span>와 일반</p>
      </b>
    `);

    expect(markdown).toBe("**강조**와 일반");
  });

  it("rebuilds Word mso-list paragraphs without duplicating markers", () => {
    const markdown = htmlToMarkdown(`
      <p class="MsoListParagraph" style="mso-list:l0 level1 lfo1">
        <span style="mso-list:Ignore">1. </span>첫 항목
      </p>
      <p class="MsoListParagraph" style="mso-list:l0 level2 lfo1">
        <span style="mso-list:Ignore">a. </span><u>하위</u>
      </p>
    `);

    expect(markdown).toBe("1. 첫 항목\n\t1. <u>하위</u>");
  });

  it("drops scripts, images, and empty html", () => {
    expect(htmlToMarkdown("<script>alert(1)</script><img src='https://x/y.png'>")).toBe("");
    expect(markdownFromClipboardHtml("<div><img alt='shot'></div>")).toBeNull();
  });

  it("escapes markdown punctuation in ordinary text", () => {
    expect(htmlToMarkdown("<p>use *stars* and [brackets]</p>")).toBe(
      "use \\*stars\\* and \\[brackets\\]",
    );
  });

  it("keeps line breaks from br tags", () => {
    expect(htmlToMarkdown("<p>first<br>second</p>")).toBe("first  \nsecond");
    expect(htmlToMarkdown("<p>before <span>first<br>second</span> after</p>")).toBe(
      "before first  \nsecond after",
    );
  });
});
