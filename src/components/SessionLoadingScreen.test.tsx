import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionLoadingScreen } from "./SessionLoadingScreen";

describe("SessionLoadingScreen", () => {
  it("renders the centered outline logo as an accessible status", () => {
    const markup = renderToStaticMarkup(<SessionLoadingScreen />);

    expect(markup).toContain('data-testid="session-loading-screen"');
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("로그인 정보를 확인하는 중입니다");
    expect(markup).toContain("briar-outline-gray.png");
    expect(markup).toContain("--session-loading-logo");
  });
});
