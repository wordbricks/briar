import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompanionSettings } from "./CompanionSettings";

describe("CompanionSettings", () => {
  it("renders mobile account and language settings", () => {
    const markup = renderToStaticMarkup(
      <CompanionSettings
        onBack={() => undefined}
        user={{
          id: "user-1",
          name: "Jay",
          email: "jay@example.com",
        }}
      />,
    );

    expect(markup).toContain("<h1>설정</h1>");
    expect(markup).toContain("Jay");
    expect(markup).toContain("jay@example.com");
    expect(markup).toContain('aria-label="언어 선택"');
    expect(markup.match(/role="radio"/g)).toHaveLength(3);
  });
});
