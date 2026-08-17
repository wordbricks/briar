import { describe, expect, it } from "vitest";
import { hyperlinkSegments } from "./hyperlink-text";

describe("hyperlinkSegments", () => {
  it("keeps plain text as a single text segment", () => {
    const value = "그냥 일반 텍스트";
    expect(hyperlinkSegments(value)).toEqual([
      { type: "text", start: 0, end: value.length, value },
    ]);
  });

  it("marks bare https URLs as links", () => {
    const segments = hyperlinkSegments(
      "버그 재현: https://github.com/org/repo/issues/1 확인해주세요",
    );
    const url = "https://github.com/org/repo/issues/1";
    expect(segments).toEqual([
      {
        type: "text",
        start: 0,
        end: "버그 재현: ".length,
        value: "버그 재현: ",
      },
      {
        type: "link",
        start: "버그 재현: ".length,
        end: "버그 재현: ".length + url.length,
        value: url,
        url,
      },
      {
        type: "text",
        start: "버그 재현: ".length + url.length,
        end: (
          "버그 재현: " + "https://github.com/org/repo/issues/1" + " 확인해주세요"
        ).length,
        value: " 확인해주세요",
      },
    ]);
  });

  it("strips trailing sentence punctuation from a link", () => {
    const segments = hyperlinkSegments("참고 https://example.com. 계속");
    expect(segments[1]).toMatchObject({
      type: "link",
      value: "https://example.com",
      url: "https://example.com",
    });
    expect(segments.map((segment) => segment.value).join("")).toBe(
      "참고 https://example.com. 계속",
    );
  });

  it("does not strip balanced parentheses inside a link", () => {
    const value = "https://en.wikipedia.org/wiki/Foo_(bar)";
    expect(hyperlinkSegments(value)).toEqual([
      {
        type: "link",
        start: 0,
        end: value.length,
        value,
        url: value,
      },
    ]);
  });

  it("links www URLs with an http scheme", () => {
    const segments = hyperlinkSegments("방문 www.example.com/path?q=1 끝");
    expect(segments[1]).toMatchObject({
      type: "link",
      value: "www.example.com/path?q=1",
      url: "http://www.example.com/path?q=1",
    });
  });

  it("renders multiple links across lines", () => {
    const segments = hyperlinkSegments(
      "a https://one.com\nb http://two.example.org!",
    );
    expect(
      segments
        .filter((segment) => segment.type === "link")
        .map((segment) => segment.value),
    ).toEqual(["https://one.com", "http://two.example.org"]);
    expect(segments.map((segment) => segment.value).join("")).toBe(
      "a https://one.com\nb http://two.example.org!",
    );
  });

  it("does not match attachment scheme references as links", () => {
    const value = "![alt](briar-attachment://abc)";
    expect(hyperlinkSegments(value)).toEqual([
      {
        type: "text",
        start: 0,
        end: value.length,
        value,
      },
    ]);
  });

  it("supports case-insensitive schemes", () => {
    const segments = hyperlinkSegments("HTTPS://EXAMPLE.COM/A");
    expect(segments[0]).toMatchObject({
      type: "link",
      value: "HTTPS://EXAMPLE.COM/A",
      url: "HTTPS://EXAMPLE.COM/A",
    });
  });
});