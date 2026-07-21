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
});
