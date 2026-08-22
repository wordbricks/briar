import { describe, expect, it } from "vitest";
import { getChannelEmojiPickerPosition } from "./channel-emoji-picker-position";

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
) => ({
  bottom: top + height,
  height,
  left,
  right: left + width,
  top,
  width,
});

describe("getChannelEmojiPickerPosition", () => {
  it("opens below the trigger when the picker fits", () => {
    expect(
      getChannelEmojiPickerPosition(rect(80, 50, 30, 28), rect(0, 0, 704, 320), {
        height: 800,
        width: 1200,
      }),
    ).toEqual({ left: 80, placement: "below", top: 86 });
  });

  it("flips above a trigger near the bottom of the viewport", () => {
    expect(
      getChannelEmojiPickerPosition(rect(80, 700, 30, 28), rect(0, 0, 704, 320), {
        height: 800,
        width: 1200,
      }),
    ).toEqual({ left: 80, placement: "above", top: 372 });
  });

  it("right-aligns to the trigger and preserves the viewport edge gap", () => {
    expect(
      getChannelEmojiPickerPosition(rect(1140, 50, 30, 28), rect(0, 0, 704, 320), {
        height: 800,
        width: 1200,
      }),
    ).toEqual({ left: 466, placement: "below", top: 86 });
  });

  it("clamps to an offset visual viewport when neither side fully fits", () => {
    expect(
      getChannelEmojiPickerPosition(rect(10, 110, 30, 28), rect(0, 0, 320, 276), {
        height: 300,
        left: 20,
        top: 100,
        width: 344,
      }),
    ).toEqual({ left: 32, placement: "below", top: 112 });
  });
});
