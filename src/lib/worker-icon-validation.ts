export const maxWorkerLogoDataUrlLength = 400_000;
export const maxWorkerEmojiLength = 32;

const emojiPattern = /(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3)/u;

export function isWorkerEmoji(value: string): boolean {
  const emoji = value.trim();
  if (
    emoji.length === 0 ||
    emoji.length > maxWorkerEmojiLength ||
    !emojiPattern.test(emoji)
  ) {
    return false;
  }
  return [
    ...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
      emoji,
    ),
  ].length === 1;
}

export function isWorkerLogoDataUrl(value: string): boolean {
  return (
    value.length <= maxWorkerLogoDataUrlLength &&
    /^data:image\/(?:jpeg|png|webp);base64,/u.test(value)
  );
}
