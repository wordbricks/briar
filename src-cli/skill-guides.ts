import { bundledSkillGuides } from "./bundled-skill-guides";

export type SkillGuide = {
  name: string;
  description: string;
  markdown: string;
};

export type BrowserAutomationProvider = "ego-browser" | "agent-browser";

const browserAutomationProviderToken = "{{BROWSER_AUTOMATION_PROVIDER}}";

export const skillGuides: SkillGuide[] = bundledSkillGuides.map((guide) => ({
  ...guide,
}));

export function getSkillGuide(name: string) {
  return skillGuides.find((guide) => guide.name === name) ?? null;
}

export function configureBrowserSkillGuide(
  markdown: string,
  provider: BrowserAutomationProvider,
) {
  return markdown.replaceAll(browserAutomationProviderToken, provider);
}
