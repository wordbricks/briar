/**
 * Language-aware issue title limits.
 *
 * Dense scripts (Hangul, Han, Kana) pack more meaning per character, so their
 * titles stay shorter. Latin and other scripts keep a higher budget. The
 * absolute ceiling matches the D1 CHECK constraint on hunt run titles.
 */

/** Storage ceiling shared with D1 `length(trim(title)) between 1 and 300`. */
export const issueTitleAbsoluteMaxLength = 300;

/** Per-script limits reflecting typical title density. */
export const issueTitleMaxLengthByScript = {
  hangul: 100,
  han: 80,
  kana: 100,
  latin: 200,
} as const;

export type IssueTitleScript = keyof typeof issueTitleMaxLengthByScript;

export type IssueTitleLocale = "ko" | "en" | "zh";

/** Default limit when the title is empty (UI maxLength before typing). */
export const issueTitleMaxLengthByLocale: Record<IssueTitleLocale, number> = {
  ko: issueTitleMaxLengthByScript.hangul,
  en: issueTitleMaxLengthByScript.latin,
  zh: issueTitleMaxLengthByScript.han,
};

const hangulLetter =
  /[\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uAC00-\uD7A3\uD7B0-\uD7FF]/u;
const hanLetter =
  /[\u2E80-\u2EFF\u2F00-\u2FDF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/u;
const kanaLetter =
  /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\uFF66-\uFF9D]/u;
const letterPattern = /\p{L}/u;

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** Count user-visible characters (grapheme clusters when available). */
export function issueTitleLength(title: string): number {
  if (graphemeSegmenter) {
    return [...graphemeSegmenter.segment(title)].length;
  }
  return [...title].length;
}

function scriptOfLetter(character: string): IssueTitleScript | null {
  if (hangulLetter.test(character)) return "hangul";
  if (hanLetter.test(character)) return "han";
  if (kanaLetter.test(character)) return "kana";
  if (letterPattern.test(character)) return "latin";
  return null;
}

/**
 * Dominant writing system for limit selection. Uses letter characters only so
 * punctuation and digits do not skew mixed titles.
 */
export function detectIssueTitleScript(title: string): IssueTitleScript {
  const counts: Record<IssueTitleScript, number> = {
    hangul: 0,
    han: 0,
    kana: 0,
    latin: 0,
  };
  let letters = 0;
  for (const character of title) {
    const script = scriptOfLetter(character);
    if (!script) continue;
    counts[script] += 1;
    letters += 1;
  }
  if (letters === 0) return "latin";

  // Prefer dense scripts when they make up a meaningful share of the title.
  const threshold = Math.max(1, Math.ceil(letters * 0.3));
  if (counts.hangul >= threshold) return "hangul";
  if (counts.han >= threshold) return "han";
  if (counts.kana >= threshold) return "kana";
  return "latin";
}

/** Max length appropriate for the title's writing system. */
export function issueTitleMaxLengthFor(title: string): number {
  return issueTitleMaxLengthByScript[detectIssueTitleScript(title)];
}

/**
 * Input-field ceiling: empty fields follow the UI locale; once text exists the
 * content script wins so an English title typed under a Korean UI still gets
 * the Latin budget.
 */
export function issueTitleInputMaxLength(
  title: string,
  locale: IssueTitleLocale = "en",
): number {
  if (!title.trim()) {
    return issueTitleMaxLengthByLocale[locale] ?? issueTitleMaxLengthByScript.latin;
  }
  return issueTitleMaxLengthFor(title);
}

export function isIssueTitleWithinLimit(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed) return false;
  return issueTitleLength(trimmed) <= issueTitleMaxLengthFor(trimmed);
}

/** Korean guidance used by Slack (integration copy is Korean-first today). */
export function issueTitleTooLongMessageKo(title: string): string {
  const max = issueTitleMaxLengthFor(title);
  const length = issueTitleLength(title.trim());
  return `제목이 너무 깁니다. ${max}자 이내로 줄여 주세요. (현재 ${length}자)`;
}

export function issueTitleTooLongMessageEn(title: string): string {
  const max = issueTitleMaxLengthFor(title);
  const length = issueTitleLength(title.trim());
  return `The title is too long. Please shorten it to ${max} characters or fewer. (currently ${length})`;
}

/** Shared Zod-friendly refine for issue title fields after trim/min checks. */
export function issueTitleOverLimitMessage(title: string): string | null {
  const trimmed = title.trim();
  if (!trimmed) return null;
  if (issueTitleLength(trimmed) <= issueTitleMaxLengthFor(trimmed)) return null;
  return issueTitleTooLongMessageEn(trimmed);
}
