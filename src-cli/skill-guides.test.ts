import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  configureBrowserSkillGuide,
  getSkillGuide,
  skillGuides,
} from "./skill-guides";

describe("bundled skill guides", () => {
  it("lists canonical guides deterministically", () => {
    expect(skillGuides.map(({ name, description }) => ({ name, description }))).toEqual([
      {
        name: "briar-workflow",
        description: "Execute and track repository work through a Briar workflow.",
      },
      {
        name: "browser",
        description: "Verify interfaces and capture result evidence with an agent browser.",
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
    expect(guide?.markdown).toContain("main result card");
    expect(guide?.markdown).toContain("Problem and scope");
    expect(guide?.markdown).toContain("Before and after");
    expect(guide?.markdown).toContain("short `##` section headings");
    expect(guide?.markdown).toContain("bullet points under each");
    expect(guide?.markdown).toContain("`**bold**` emphasis");
    expect(guide?.markdown).toContain("Choose details by consequence, not by technology");
    expect(guide?.markdown).toContain("interface change");
    expect(guide?.markdown).toContain("integration");
    expect(guide?.markdown).toContain("operational change");
    expect(guide?.markdown).toContain("user-visible interface");
    expect(guide?.markdown).toContain("repeated `--image` arguments");
    expect(guide?.markdown).toContain("--structured-result-file '<blocked-result.json>'");
    expect(guide?.markdown).toContain("how they can tell it worked");
    expect(guide?.markdown).toContain("collapsed technical detail");
    expect(getSkillGuide("missing")).toBeNull();
  });

  it("serves the browser automation guide", () => {
    const guide = getSkillGuide("browser");
    expect(guide?.markdown).toContain("# Browser Automation");
    expect(guide?.markdown).toContain("ego-browser nodejs");
    expect(guide?.markdown).toContain("agent-browser skills get core --full");
    expect(guide?.markdown).toContain("aside mcp --help");
    expect(guide?.markdown).toContain("## Verification with Aside");
    expect(guide?.markdown).toContain("{{BROWSER_AUTOMATION_PROVIDER}}");
    expect(guide?.markdown).toContain("Briar Settings → Browser");
    expect(guide?.markdown).toContain("briar run evidence add");
    expect(guide?.markdown).toContain("--image");
  });

  it("binds the configured browser without adding a fallback", () => {
    const guide = getSkillGuide("browser");
    const configured = configureBrowserSkillGuide(
      guide?.markdown ?? "",
      "agent-browser",
    );

    expect(configured).toContain(
      "selected **`agent-browser`** in **Briar Settings → Browser**",
    );
    expect(configured).toContain("Never switch to another browser tool automatically");
    expect(configured).not.toContain("{{BROWSER_AUTOMATION_PROVIDER}}");
  });

  it("keeps the installed skill as a discovery stub", async () => {
    const stub = await readFile("skills/briar-workflow/SKILL.md", "utf8");
    expect(stub).toContain("briar skills get briar-workflow");
    expect(stub).toContain("discovery stub");
    expect(stub).not.toContain("briar run event add --run");
    expect(stub).not.toContain("references/");

    const browserStub = await readFile("skills/browser/SKILL.md", "utf8");
    expect(browserStub).toContain("briar skills get browser");
    expect(browserStub).toContain("discovery stub");
  });
});
