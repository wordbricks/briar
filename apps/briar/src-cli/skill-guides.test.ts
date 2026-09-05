import { describe, expect, it } from "vitest";
import {
  configureBrowserSkillGuide,
  getSkillGuide,
  skillGuides,
  type BrowserAutomationProvider,
} from "./skill-guides";

const browserGuide = () => {
  const guide = getSkillGuide("browser");
  if (!guide) throw new Error("the browser skill guide should be bundled");
  return guide;
};

describe("skill guides", () => {
  it("bundles every guide with a name and a description", () => {
    expect(skillGuides.length).toBeGreaterThan(0);
    for (const guide of skillGuides) {
      expect(guide.name).not.toBe("");
      expect(guide.description).not.toBe("");
      expect(guide.markdown).not.toBe("");
    }
  });

  it("substitutes the configured provider into the browser guide", () => {
    const providers: BrowserAutomationProvider[] = [
      "ego-browser",
      "agent-browser",
      "aside",
    ];
    for (const provider of providers) {
      const markdown = configureBrowserSkillGuide(browserGuide().markdown, provider);
      expect(markdown).not.toContain("{{BROWSER_AUTOMATION_PROVIDER}}");
      expect(markdown).toContain(`configured_browser='${provider}'`);
    }
  });
});

describe("browser guide agent-browser section", () => {
  it("starts every session from the shared state and merges back before closing", () => {
    const markdown = browserGuide().markdown;

    expect(markdown).toContain('state="$($BRIAR_CLI browser-state ensure)"');
    expect(markdown).toContain(
      `agent-browser --session "$session" --state "$state" open`,
    );
    expect(markdown).toContain(
      `agent-browser --session "$session" state save "$tmp" && $BRIAR_CLI browser-state merge "$tmp"`,
    );
    expect(markdown.indexOf("browser-state merge")).toBeLessThan(
      markdown.indexOf(`agent-browser --session "$session" close`),
    );
  });

  it("hands a required sign-in to the user in a headed session", () => {
    const markdown = browserGuide().markdown;

    expect(markdown).toContain("Never type credentials into a page");
    expect(markdown).toContain(
      `agent-browser --session "$session" --headed --state "$state" open`,
    );
  });

  it("warns that the shared state file holds plaintext cookies", () => {
    expect(browserGuide().markdown).toContain(
      "The shared `agent-browser` state file holds plaintext cookies",
    );
  });
});
