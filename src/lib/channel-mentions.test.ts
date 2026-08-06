import { describe, expect, it } from "vitest";
import { channelSlugFromName, handleFromName } from "./channels-contract";
import { mentionAtCaret, retainedMentions } from "./channel-mentions";

const target = (handle: string) => ({
  type: "agent" as const,
  id: `id-${handle}`,
  handle,
  label: handle,
  detail: "",
});

describe("mentionAtCaret", () => {
  it("finds the handle the caret is inside", () => {
    expect(mentionAtCaret("hey @hon", 8)).toEqual({
      start: 4,
      end: 8,
      query: "hon",
    });
  });

  it("matches an empty query right after the marker", () => {
    expect(mentionAtCaret("hey @", 5)).toMatchObject({ query: "" });
  });

  it("ignores an address-like token that is not a mention", () => {
    expect(mentionAtCaret("mail me at jay@example", 22)).toBeNull();
  });

  it("ignores a completed mention the caret has moved past", () => {
    expect(mentionAtCaret("@honey hello", 12)).toBeNull();
  });

  it("rejects a caret outside the body", () => {
    expect(mentionAtCaret("@honey", 99)).toBeNull();
  });
});

describe("retainedMentions", () => {
  it("keeps a mention whose handle is still written", () => {
    expect(
      retainedMentions("@honey please help", [target("honey")]).map(
        (mention) => mention.handle,
      ),
    ).toEqual(["honey"]);
  });

  it("drops a mention the author edited away", () => {
    expect(retainedMentions("never mind", [target("honey")])).toEqual([]);
  });

  it("does not treat a longer handle as a match for a shorter one", () => {
    // @honey-2 must not keep a picked @honey: they are different Agents.
    expect(retainedMentions("@honey-2 hi", [target("honey")])).toEqual([]);
  });

  it("keeps a handle that contains regular expression characters literally", () => {
    expect(
      retainedMentions("@a.b hello", [target("a.b")]).map(
        (mention) => mention.handle,
      ),
    ).toEqual(["a.b"]);
    expect(retainedMentions("@axb hello", [target("a.b")])).toEqual([]);
  });
});

describe("handleFromName", () => {
  it("slugifies a Latin name", () => {
    expect(handleFromName("Honey Bee")).toBe("honey-bee");
  });

  it("returns an empty handle for a name with no handle characters", () => {
    // Callers must fall back to a generated handle rather than store this.
    expect(handleFromName("꿀벌")).toBe("");
  });

  it("trims separators produced by punctuation", () => {
    expect(handleFromName("  Bumble!! ")).toBe("bumble");
  });
});

describe("channelSlugFromName", () => {
  it("generates a stable fallback slug for a non-Latin channel name", () => {
    expect(
      channelSlugFromName("제품 피드백", "ABCDEF00-1234-4000-8000-000000000001"),
    ).toBe("channel-abcdef001234");
  });
});
