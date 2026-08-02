import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanionSettings } from "./CompanionSettings";

describe("CompanionSettings", () => {
  it("renders mobile account, appearance, notification, and language settings", () => {
    const markup = renderToStaticMarkup(
      <CompanionSettings
        onBack={() => undefined}
        onAccountDelete={async () => undefined}
        user={{
          id: "user-1",
          name: "Jay",
          email: "jay@example.com",
        }}
      />,
    );

    expect(markup).toMatch(/<h1[^>]*>설정<\/h1>/);
    expect(markup).toContain("Jay");
    expect(markup).toContain("jay@example.com");
    expect(markup).toContain("계정 탈퇴 및 데이터 삭제");
    expect(markup).toContain('aria-label="앱 아이콘 선택"');
    expect(markup).toContain('aria-label="테마"');
    expect(markup).toContain("시스템");
    expect(markup).toContain("라이트");
    expect(markup).toContain("다크");
    expect(markup).toContain("받은 편지함 메시지의 중요도별 시스템 알림");
    expect(markup.match(/role="switch"/g)).toHaveLength(4);
    expect(markup).toContain('aria-label="언어 선택"');
    expect(markup.match(/role="radio"/g)).toHaveLength(10);
  });
});
