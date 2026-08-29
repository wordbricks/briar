import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  detachedAgentSkills,
  type DetachedAgent,
  type DetachedAgentSkill,
} from "./agent-runner";

const skillDescriptionMaxLength = 1_000;

export type DetachedAgentSkillCatalogEntry = {
  skillId: string;
  name: string;
  description: string;
  path: string;
};

export type DetachedAgentSkillCatalogLifetime =
  | "provider-turn"
  | "retained-conversation";

export type DetachedAgentSkillCatalog = {
  rootPath: string;
  entries: DetachedAgentSkillCatalogEntry[];
  lifetime: DetachedAgentSkillCatalogLifetime;
};

const boundedDescription = (value: string) => {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (normalized.length <= skillDescriptionMaxLength) return normalized;
  return `${normalized.slice(0, skillDescriptionMaxLength - 1).trimEnd()}…`;
};

function skillSlug(name: string, position: number) {
  const slug = name
    .normalize("NFKD")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48)
    .replace(/-+$/gu, "");
  return `${slug || "briar-skill"}-${position + 1}`;
}

export function detachedAgentSkillDocument(
  skill: DetachedAgentSkill,
  position: number,
) {
  const description = boundedDescription(skill.description);
  const name = skillSlug(skill.name, position);
  const displayName = skill.name.replace(/\s+/gu, " ").trim();
  const body = skill.body.trim() || "No additional instructions are configured.";
  return {
    description,
    markdown: [
      "---",
      `name: ${name}`,
      `description: ${JSON.stringify(description)}`,
      "---",
      "",
      `# ${displayName}`,
      "",
      body,
      "",
    ].join("\n"),
    name,
  };
}

export async function materializeDetachedAgentSkillCatalog(
  agent: DetachedAgent,
  options: {
    temporaryParentPath?: string;
    lifetime?: DetachedAgentSkillCatalogLifetime;
  } = {},
): Promise<DetachedAgentSkillCatalog | null> {
  const skills = detachedAgentSkills(agent);
  if (skills.length === 0) return null;
  const lifetime = options.lifetime ?? "provider-turn";
  const temporaryParentPath = options.temporaryParentPath ?? tmpdir();
  if (lifetime === "retained-conversation" && !options.temporaryParentPath) {
    throw new Error(
      "A retained Agent Skill catalog requires a conversation workspace",
    );
  }
  const rootPath = lifetime === "retained-conversation"
    ? join(temporaryParentPath, ".briar-agent-skills")
    : await mkdtemp(join(temporaryParentPath, ".briar-agent-skills-"));
  try {
    if (lifetime === "retained-conversation") {
      // Rebuild the exact session-scoped directory on each new reply so a
      // changed Agent profile cannot leave stale Skill bodies behind. The
      // retained workspace owns the directory after this function returns.
      await rm(rootPath, { recursive: true, force: true });
      await mkdir(rootPath, { recursive: true, mode: 0o700 });
    }
    // Keep the catalog out of repository status and broad staging commands
    // while leaving it readable inside every provider's workspace sandbox.
    await writeFile(join(rootPath, ".gitignore"), "*\n", {
      encoding: "utf8",
      mode: 0o600,
    });
    const entries = await Promise.all(skills.map(async (skill, position) => {
      const document = detachedAgentSkillDocument(skill, position);
      const skillDirectory = join(rootPath, document.name);
      await mkdir(skillDirectory, { mode: 0o700 });
      const path = join(skillDirectory, "SKILL.md");
      await writeFile(path, document.markdown, {
        encoding: "utf8",
        mode: 0o600,
      });
      return {
        skillId: skill.id,
        name: skill.name,
        description: document.description,
        path,
      };
    }));
    return { rootPath, entries, lifetime };
  } catch (error) {
    await rm(rootPath, { recursive: true, force: true });
    throw error;
  }
}

export async function cleanupDetachedAgentSkillCatalog(
  catalog: DetachedAgentSkillCatalog | null,
) {
  if (!catalog) return;
  await rm(catalog.rootPath, { recursive: true, force: true });
}
