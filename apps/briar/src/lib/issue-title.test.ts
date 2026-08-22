import { describe, expect, it } from "vitest";
import {
  detectIssueTitleScript,
  issueTitleAbsoluteMaxLength,
  issueTitleInputMaxLength,
  issueTitleLength,
  issueTitleMaxLengthByScript,
  issueTitleMaxLengthFor,
  issueTitleTooLongMessageKo,
  isIssueTitleWithinLimit,
} from "./issue-title";

describe("issue title limits", () => {
  it("counts grapheme clusters for user-visible length", () => {
    expect(issueTitleLength("안녕")).toBe(2);
    expect(issueTitleLength("hello")).toBe(5);
    expect(issueTitleLength("가👨‍👩‍👧‍👦나")).toBe(3);
  });

  it("detects Hangul, Han, Kana, and Latin scripts", () => {
    expect(detectIssueTitleScript("로그인 버튼이 동작하지 않아요")).toBe("hangul");
    expect(detectIssueTitleScript("登录按钮无法点击")).toBe("han");
    expect(detectIssueTitleScript("ログインボタンが動きません")).toBe("kana");
    expect(detectIssueTitleScript("Checkout is blank")).toBe("latin");
  });

  it("applies denser limits for CJK scripts and a higher Latin budget", () => {
    expect(issueTitleMaxLengthFor("한글 제목")).toBe(
      issueTitleMaxLengthByScript.hangul,
    );
    expect(issueTitleMaxLengthFor("中文标题")).toBe(issueTitleMaxLengthByScript.han);
    expect(issueTitleMaxLengthFor("カタカナ")).toBe(
      issueTitleMaxLengthByScript.kana,
    );
    expect(issueTitleMaxLengthFor("English title")).toBe(
      issueTitleMaxLengthByScript.latin,
    );
    expect(issueTitleAbsoluteMaxLength).toBe(300);
    expect(issueTitleMaxLengthByScript.hangul).toBeLessThan(
      issueTitleMaxLengthByScript.latin,
    );
    expect(issueTitleMaxLengthByScript.han).toBeLessThan(
      issueTitleMaxLengthByScript.hangul,
    );
  });

  it("rejects titles that exceed the language-aware limit", () => {
    const hangulOver = "가".repeat(issueTitleMaxLengthByScript.hangul + 1);
    const latinOk = "a".repeat(issueTitleMaxLengthByScript.latin);
    const latinOver = "a".repeat(issueTitleMaxLengthByScript.latin + 1);

    expect(isIssueTitleWithinLimit(hangulOver)).toBe(false);
    expect(isIssueTitleWithinLimit(latinOk)).toBe(true);
    expect(isIssueTitleWithinLimit(latinOver)).toBe(false);
    expect(issueTitleTooLongMessageKo(hangulOver)).toContain(
      `${issueTitleMaxLengthByScript.hangul}자`,
    );
    expect(issueTitleTooLongMessageKo(hangulOver)).toContain(
      `${issueTitleMaxLengthByScript.hangul + 1}자`,
    );
  });

  it("uses locale defaults for empty input and content script once typed", () => {
    expect(issueTitleInputMaxLength("", "ko")).toBe(
      issueTitleMaxLengthByScript.hangul,
    );
    expect(issueTitleInputMaxLength("", "en")).toBe(
      issueTitleMaxLengthByScript.latin,
    );
    expect(issueTitleInputMaxLength("", "zh")).toBe(
      issueTitleMaxLengthByScript.han,
    );
    expect(issueTitleInputMaxLength("Checkout is blank", "ko")).toBe(
      issueTitleMaxLengthByScript.latin,
    );
  });
});
