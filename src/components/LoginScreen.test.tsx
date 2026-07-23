import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoginScreen } from "./LoginScreen";

const baseProps = {
  error: null,
  loading: false,
  onCancel: () => undefined,
  onLogin: () => undefined,
};

describe("LoginScreen", () => {
  it("shows a close button while device authorization is pending", () => {
    const markup = renderToStaticMarkup(
      <LoginScreen {...baseProps} loginCode="RZEHG4T5" />,
    );

    expect(markup).toContain('aria-label="로그인 닫기"');
  });

  it("does not show a close button before login starts", () => {
    const markup = renderToStaticMarkup(
      <LoginScreen {...baseProps} loginCode={null} />,
    );

    expect(markup).not.toContain('aria-label="로그인 닫기"');
  });

  it("does not show the desktop sign-in security footnote", () => {
    const markup = renderToStaticMarkup(
      <LoginScreen {...baseProps} loginCode={null} />,
    );

    expect(markup).not.toContain("login-footnote");
    expect(markup).not.toContain("시스템 브라우저에서 안전하게");
  });

  it("describes Android sign-in as an in-app flow", () => {
    const markup = renderToStaticMarkup(
      <LoginScreen
        {...baseProps}
        companionMode
        loginCode="F65P9NQN"
      />,
    );

    expect(markup).toContain("인앱 로그인에서 Google 계정으로 계속하세요");
    expect(markup).toContain("자동으로 앱으로 돌아옵니다");
    expect(markup).toContain("안전한 인앱 브라우저");
    expect(markup).not.toContain("브라우저에서 로그인 후");
  });
});
