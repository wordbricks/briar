import { describe, expect, it } from "vitest";
import { connectedMentionSegments } from "./connected-mentions";

describe("connectedMentionSegments", () => {
  it("marks only handles that were connected by the caller", () => {
    const segments = connectedMentionSegments(
      "Ask @member and leave @typed alone.",
      [{ key: "user:1", handle: "member", label: "Member One" }],
    );

    expect(
      segments
        .filter((segment) => segment.type === "mention")
        .map((segment) => segment.value),
    ).toEqual(["@member"]);
    expect(segments.map((segment) => segment.value).join("")).toBe(
      "Ask @member and leave @typed alone.",
    );
  });

  it("matches Unicode and dotted handles without matching longer tokens", () => {
    const segments = connectedMentionSegments(
      "@민지 @jay.k @jay.kim",
      [
        { key: "user:1", handle: "민지" },
        { key: "user:2", handle: "jay.k" },
      ],
    );

    expect(
      segments
        .filter((segment) => segment.type === "mention")
        .map((segment) => segment.value),
    ).toEqual(["@민지", "@jay.k"]);
  });

  it("preserves the written casing while resolving handles case-insensitively", () => {
    const segments = connectedMentionSegments("Hi @Member", [
      { key: "user:1", handle: "member" },
    ]);

    expect(segments[1]).toMatchObject({
      type: "mention",
      value: "@Member",
      mention: { key: "user:1", handle: "member" },
    });
  });
});
