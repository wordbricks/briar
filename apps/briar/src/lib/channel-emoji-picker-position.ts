export type ChannelEmojiPickerPlacement = "above" | "below";

type Rectangle = Pick<
  DOMRect,
  "bottom" | "height" | "left" | "right" | "top" | "width"
>;

export type ChannelEmojiPickerViewport = {
  height: number;
  left?: number;
  top?: number;
  width: number;
};

export type ChannelEmojiPickerPosition = {
  left: number;
  placement: ChannelEmojiPickerPlacement;
  top: number;
};

export const CHANNEL_EMOJI_PICKER_EDGE_GAP = 12;
export const CHANNEL_EMOJI_PICKER_ANCHOR_GAP = 8;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(Math.max(value, minimum), maximum);

/**
 * Places the picker next to its trigger while keeping the whole overlay inside
 * the currently visible viewport. The picker prefers opening below, but flips
 * above when that side has more usable room.
 */
export function getChannelEmojiPickerPosition(
  anchor: Rectangle,
  picker: Pick<Rectangle, "height" | "width">,
  viewport: ChannelEmojiPickerViewport,
): ChannelEmojiPickerPosition {
  const viewportLeft = viewport.left ?? 0;
  const viewportTop = viewport.top ?? 0;
  const viewportRight = viewportLeft + viewport.width;
  const viewportBottom = viewportTop + viewport.height;
  const minimumLeft = viewportLeft + CHANNEL_EMOJI_PICKER_EDGE_GAP;
  const maximumLeft = Math.max(
    minimumLeft,
    viewportRight - CHANNEL_EMOJI_PICKER_EDGE_GAP - picker.width,
  );

  let left = anchor.left;
  if (left + picker.width > viewportRight - CHANNEL_EMOJI_PICKER_EDGE_GAP) {
    left = anchor.right - picker.width;
  }
  left = clamp(left, minimumLeft, maximumLeft);

  const minimumTop = viewportTop + CHANNEL_EMOJI_PICKER_EDGE_GAP;
  const maximumTop = Math.max(
    minimumTop,
    viewportBottom - CHANNEL_EMOJI_PICKER_EDGE_GAP - picker.height,
  );
  const belowTop = anchor.bottom + CHANNEL_EMOJI_PICKER_ANCHOR_GAP;
  const aboveTop = anchor.top - CHANNEL_EMOJI_PICKER_ANCHOR_GAP - picker.height;
  const roomBelow = viewportBottom - CHANNEL_EMOJI_PICKER_EDGE_GAP - belowTop;
  const roomAbove = anchor.top - CHANNEL_EMOJI_PICKER_ANCHOR_GAP - minimumTop;
  const placement: ChannelEmojiPickerPlacement =
    picker.height <= roomBelow || roomBelow >= roomAbove ? "below" : "above";

  return {
    left,
    placement,
    top: clamp(placement === "below" ? belowTop : aboveTop, minimumTop, maximumTop),
  };
}
