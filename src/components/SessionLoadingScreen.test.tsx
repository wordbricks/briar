import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionLoadingScreen } from "./SessionLoadingScreen";

const styles = readFileSync(
  new URL("../styles.css", import.meta.url),
  "utf8",
);

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

  it("renders the restoring-session logo at one third of its original size", () => {
    expect(styles).toContain(
      ".session-loading-logo { width:clamp(50.6667px,4.6667vw,60px);",
    );
  });
});
