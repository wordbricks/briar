import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { getSkillGuide, skillGuides } from "./skill-guides";

describe("bundled skill guides", () => {
  it("lists canonical guides deterministically", () => {
    expect(skillGuides.map(({ name, description }) => ({ name, description }))).toEqual([
      {
        name: "briar-workflow",
        description: "Execute and track repository work through a Briar workflow.",
      },
    ]);
  });

  it("serves the complete workflow guide from the binary source", () => {
    const guide = getSkillGuide("briar-workflow");
    expect(guide?.markdown).toContain("# Briar Workflow");
    expect(guide?.markdown).toContain("briar queue claim");
    expect(guide?.markdown).toContain("briar run evidence add");
    expect(guide?.markdown).toContain("briar run rework");
    expect(guide?.markdown).toContain("## Optional Velen and Linear");
    expect(guide?.markdown).toContain("nontechnical PM or CEO");
    expect(guide?.markdown).toContain("--structured-result-file '<blocked-result.json>'");
    expect(guide?.markdown).toContain("how they can tell it worked");
    expect(guide?.markdown).toContain("collapsed technical detail");
    expect(getSkillGuide("missing")).toBeNull();
  });

  it("keeps the installed skill as a discovery stub", async () => {
    const stub = await readFile("skills/briar-workflow/SKILL.md", "utf8");
    expect(stub).toContain("briar skills get briar-workflow");
    expect(stub).toContain("discovery stub");
    expect(stub).not.toContain("briar run event add --run");
    expect(stub).not.toContain("references/");
  });
});
