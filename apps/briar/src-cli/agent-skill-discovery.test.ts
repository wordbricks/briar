import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DetachedAgent } from "./agent-runner";
import {
  cleanupDetachedAgentSkillCatalog,
  detachedAgentSkillDocument,
  materializeDetachedAgentSkillCatalog,
} from "./agent-skill-discovery";

const agent: DetachedAgent = {
  id: "agent-1",
  name: "Release Agent",
  provider: "codex",
  model: "gpt-5",
  effort: "high",
  responsibility: "Prepare releases.",
  skill: "",
  skills: [
    {
      id: "skill-ios",
      name: "iOS release",
      description:
        "Use when a request concerns TestFlight or an iOS release, even when it does not name this Skill.",
      body: "Verify signing, archive the app, and upload the build.",
      provider: "codex",
      model: "gpt-5",
      effort: "high",
      kind: "custom",
      position: 0,
    },
    {
      id: "skill-notes",
      name: "Release notes",
      description: "Use when the user asks for customer-facing release notes.",
      body: "Write concise copy.",
      provider: "codex",
      model: null,
      effort: null,
      kind: "custom",
      position: 1,
    },
  ],
};

describe("detached Agent Skill discovery", () => {
  it("generates a discoverable SKILL.md from stored description and body", () => {
    const document = detachedAgentSkillDocument(agent.skills[1]!, 1);
    expect(document.name).toBe("release-notes-2");
    expect(document.description).toContain(
      "Use when the user asks for customer-facing release notes.",
    );
    expect(document.markdown).toContain("name: release-notes-2");
    expect(document.markdown).toContain("# Release notes");
    expect(document.markdown).toContain("Write concise copy.");
  });

  it("materializes isolated Skill files and removes the exact catalog", async () => {
    const temporaryParentPath = await mkdtemp(
      join(tmpdir(), "briar-skill-catalog-test-"),
    );
    try {
      const catalog = await materializeDetachedAgentSkillCatalog(agent, {
        temporaryParentPath,
      });
      expect(catalog?.entries.map((entry) => entry.skillId)).toEqual([
        "skill-ios",
        "skill-notes",
      ]);
      expect(catalog?.entries[0]?.description).toContain("TestFlight");
      await expect(readFile(join(catalog!.rootPath, ".gitignore"), "utf8"))
        .resolves.toBe("*\n");
      const markdown = await readFile(catalog!.entries[0]!.path, "utf8");
      expect(markdown).toContain("description: ");
      expect(markdown).toContain(
        "Verify signing, archive the app, and upload the build.",
      );

      const rootPath = catalog!.rootPath;
      await cleanupDetachedAgentSkillCatalog(catalog);
      await expect(stat(rootPath)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await rm(temporaryParentPath, { recursive: true, force: true });
    }
  });
});
