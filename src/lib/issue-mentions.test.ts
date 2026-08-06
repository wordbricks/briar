import { describe, expect, it } from "vitest";
import {
  isIssueMentionUrl,
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

  it("recognizes only the internal mention URL scheme", () => {
    expect(isIssueMentionUrl(issueMentionUrl("member"))).toBe(true);
    expect(isIssueMentionUrl("https://example.com")).toBe(false);
  });
});
