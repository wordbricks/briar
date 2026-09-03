import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (...segments: string[]) =>
  readFileSync(resolve(...segments), "utf8");

const launchIntro = read("src", "styles", "launch-intro.css");
const appStyles = read("src", "styles.css");
const appEntry = read("src", "main.tsx");
const introEntry = read("src", "intro-main.tsx");
const introDocument = read("intro.html");

describe("launch intro stylesheet", () => {
  it("owns every launch intro rule so both entries render it identically", () => {
    const strayRules = appStyles
      .split("\n")
      .filter((line) => line.includes("launch-intro") && !line.startsWith("/*"));
    expect(strayRules).toEqual([]);

    for (const selector of [
      ".launch-intro {",
      ".launch-intro::before",
      ".launch-intro-native::before",
      ".launch-intro-skip {",
      ".launch-intro-content {",
      ".launch-intro-brand {",
      ".launch-intro-copy {",
      ".launch-intro-character {",
      "html.launch-intro-document",
      "@keyframes launch-intro-curtain",
    ]) {
      expect(launchIntro).toContain(selector);
    }
  });

  it("keeps the accessibility overrides that used to live in styles.css", () => {
    expect(launchIntro).toContain("prefers-reduced-motion");
    expect(launchIntro).toContain("prefers-reduced-transparency");
    expect(launchIntro).toContain("prefers-contrast");
    expect(launchIntro).toContain("max-width:760px");
  });

  it("suppresses the timed curtain only while the reveal is pending", () => {
    // The base rule keeps the five second delay for the in-app intro.
    expect(launchIntro).toContain(
      "animation:launch-intro-curtain var(--launch-intro-fade-duration) var(--launch-intro-hold-duration) ease-out both;",
    );
    expect(launchIntro).toContain(".launch-intro-gated { animation-name:none; }");
    expect(launchIntro).toContain(
      ".launch-intro-gated.launch-intro-fading { animation-name:launch-intro-curtain; animation-delay:0s; }",
    );
    // Setting only the longhands keeps the reduced-motion duration override
    // (declared later in this file) in charge of how long the fade runs.
    expect(launchIntro).not.toContain(
      ".launch-intro-gated.launch-intro-fading { animation:",
    );
  });

  it("is loaded by the app shell and by the standalone intro window", () => {
    expect(appEntry).toContain('import "./styles/launch-intro.css";');
    // Order matters: the extracted rules must stay after styles.css.
    expect(appEntry.indexOf('import "./styles.css";')).toBeLessThan(
      appEntry.indexOf('import "./styles/launch-intro.css";'),
    );
    expect(introEntry).toContain('import "./styles/launch-intro.css";');
    expect(introEntry).toContain('import "./styles/tokens.css";');
    // globals.css carries these for the app shell; the intro entry skips it.
    expect(introEntry).toContain('import "./styles/fonts.css";');
  });

  it("preloads the detected locale like the app entry does", () => {
    // Without this the intro window would render the Korean fallback copy for
    // en/zh users, because non-default locales are lazy chunks.
    for (const source of [appEntry, introEntry]) {
      expect(source).toContain("detectLocale()");
      expect(source).toContain("loadLocaleMessages(");
      expect(source).toContain("initial={{ locale, messages }}");
    }
  });

  it("keeps the intro window off the app bundle", () => {
    expect(introDocument).toContain('src="/src/intro-main.tsx"');
    expect(introDocument).not.toContain("/src/main.tsx");
    expect(introEntry).not.toContain("./App");
    expect(introEntry).not.toContain("styles.css");
  });
});
