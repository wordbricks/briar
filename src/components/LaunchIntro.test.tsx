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
    expect(markup).toContain("Skip intro");
    expect(markup).toContain("--launch-character-index");
    expect(markup).toContain("launch-intro-content");
    expect(markup).not.toContain("launch-intro-window");
    expect(markup).not.toContain("launch-intro-gradient");
    expect(markup).not.toContain("launch-intro-grain");
    expect(markup).not.toContain("launch-intro-status");
  });

  it("marks the full-screen native presentation", () => {
    const markup = renderToStaticMarkup(
      <LaunchIntro native onComplete={() => undefined} />,
    );

    expect(markup).toContain("launch-intro-native");
  });

  it("marks a persistent development preview", () => {
    const markup = renderToStaticMarkup(
      <LaunchIntro preview onComplete={() => undefined} />,
    );

    expect(markup).toContain("launch-intro-preview");
  });
});
