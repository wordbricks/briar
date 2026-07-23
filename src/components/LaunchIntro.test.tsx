import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LaunchIntro } from "./LaunchIntro";

describe("LaunchIntro", () => {
  it("renders the localized intro with a skip control", () => {
    const markup = renderToStaticMarkup(
      <LaunchIntro onComplete={() => undefined} />,
    );

    expect(markup).toContain('data-testid="launch-intro"');
    expect(markup).toContain("Briar 시작 화면");
    expect(markup).toContain("건너뛰기");
    expect(markup).toContain("--launch-character-index");
  });

  it("marks the full-screen native presentation", () => {
    const markup = renderToStaticMarkup(
      <LaunchIntro native onComplete={() => undefined} />,
    );

    expect(markup).toContain("launch-intro-native");
  });
});
