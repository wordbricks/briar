import { bundledSkillGuides } from "./bundled-skill-guides";

export type SkillGuide = {
  name: string;
  description: string;
  markdown: string;
};

export const skillGuides: SkillGuide[] = bundledSkillGuides.map((guide) => ({
  ...guide,
}));

export function getSkillGuide(name: string) {
  return skillGuides.find((guide) => guide.name === name) ?? null;
}
