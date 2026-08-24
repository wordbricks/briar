export type Locale = "ko" | "en" | "zh";

export const localeTags = {
  ko: "ko-KR",
  en: "en-US",
  zh: "zh-CN",
} satisfies Record<Locale, string>;
