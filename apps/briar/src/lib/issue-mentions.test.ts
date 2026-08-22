import { describe, expect, it } from "vitest";
import {
  isIssueMentionUrl,
  issueMentionHandleFromUrl,
  issueMentionUrl,
  remarkIssueMentions,
} from "./issue-mentions";

describe("issue conversation mentions", () => {
  it("turns known mentions into no-op link nodes without touching code or email text", () => {
    const transform = remarkIssueMentions(["member"])();
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "text",
              value: "안녕하세요 @Member, owner@example.com @unknown",
            },
          ],
        },
        {
          type: "inlineCode",
          value: "@Member",
        },
        {
          type: "link",
          url: "https://example.com",
          children: [{ type: "text", value: "@Member" }],
        },
      ],
    } as Parameters<typeof transform>[0];

    transform(tree);

    expect(tree.children?.[0]?.children).toEqual([
      { type: "text", value: "안녕하세요 " },
      {
        type: "link",
        title: null,
        url: issueMentionUrl("Member"),
        children: [{ type: "text", value: "@Member" }],
      },
      { type: "text", value: ", owner@example.com @unknown" },
    ]);
    expect(tree.children?.[1]).toEqual({ type: "inlineCode", value: "@Member" });
    expect(tree.children?.[2]).toEqual({
      type: "link",
      url: "https://example.com",
      children: [{ type: "text", value: "@Member" }],
    });
  });

  it("keeps sentence punctuation outside a known mention link", () => {
    const transform = remarkIssueMentions(["member"])();
    const tree = {
      type: "root",
      children: [
        { type: "paragraph", children: [{ type: "text", value: "@member." }] },
      ],
    } as Parameters<typeof transform>[0];

    transform(tree);

    expect(tree.children?.[0]?.children).toEqual([
      {
        type: "link",
        title: null,
        url: issueMentionUrl("member"),
        children: [{ type: "text", value: "@member" }],
      },
      { type: "text", value: "." },
    ]);
  });

  it("links a known Agent Name containing spaces and non-Latin text", () => {
    const transform = remarkIssueMentions(["기획 도우미"])();
    const tree = {
      type: "root",
      children: [{
        type: "paragraph",
        children: [{ type: "text", value: "@기획 도우미 확인" }],
      }],
    } as Parameters<typeof transform>[0];

    transform(tree);

    expect(tree.children?.[0]?.children?.[0]).toMatchObject({
      type: "link",
      children: [{ type: "text", value: "@기획 도우미" }],
    });
  });

  it("recognizes only the internal mention URL scheme", () => {
    expect(isIssueMentionUrl(issueMentionUrl("member"))).toBe(true);
    expect(isIssueMentionUrl("https://example.com")).toBe(false);
    expect(issueMentionHandleFromUrl(issueMentionUrl("멤버 one"))).toBe(
      "멤버 one",
    );
    expect(issueMentionHandleFromUrl("https://example.com")).toBeNull();
    expect(issueMentionHandleFromUrl("briar-mention://%E0%A4%A")).toBeNull();
  });
});
