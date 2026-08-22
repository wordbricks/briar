import { describe, expect, it } from "vitest";
import {
  agentWithSkillsRuntime,
  agentWithSkillRuntime,
  defaultProjectAgentCopy,
  defaultProjectAgentSkillCopy,
  normalizeProjectAgentLocale,
  projectAgentSkill,
} from "./project-agent";
import { demoProjectAgents } from "./demo-project-agents";

describe("default project agent copy", () => {
  it("uses the requested Korean responsibility", () => {
    expect(defaultProjectAgentCopy("ko")).toEqual({
      name: "개발자 에이전트",
      description: "프로젝트의 개발과 코드 관련 작업을 수행하는 에이전트입니다.",
      responsibility: "프로젝트의 개발과 코드 관련 작업을 책임집니다.",
    });
    expect(defaultProjectAgentSkillCopy("ko")).toEqual({
      name: "이슈 처리",
      description: "프로젝트의 이슈를 구현하고 검증해야 할 때 사용합니다.",
      body: "프로젝트의 개발과 코드 관련 작업을 책임집니다.",
    });
  });

  it("localizes English and Chinese project agents", () => {
    expect(defaultProjectAgentCopy("en")).toEqual({
      name: "Developer agent",
      description: "Handles development and code-related work for the project.",
      responsibility: "Owns the project's development and code-related work.",
    });
    expect(defaultProjectAgentCopy("zh")).toEqual({
      name: "开发者智能体",
      description: "负责项目开发和代码相关工作的智能体。",
      responsibility: "负责项目的开发和代码相关工作。",
    });
  });

  it("normalizes language tags and falls back to English", () => {
    expect(normalizeProjectAgentLocale("ko-KR")).toBe("ko");
    expect(normalizeProjectAgentLocale("zh-CN")).toBe("zh");
    expect(normalizeProjectAgentLocale("en-US")).toBe("en");
    expect(normalizeProjectAgentLocale(null)).toBe("en");
  });
});

describe("project agent skills", () => {
  it("applies explicit and unselected skill runtimes", () => {
    const agent = demoProjectAgents("project-1", "en")[0]!;
    const issueSkill = agent.skills[0]!;
    const customSkill = {
      ...issueSkill,
      id: "skill-release",
      name: "Desktop release",
      description: "Use for desktop release requests.",
      body: "Publish the desktop app.",
      provider: "claude" as const,
      model: "opus",
      effort: "high" as const,
      kind: "custom" as const,
      position: 1,
    };
    const agentWithMultipleSkills = {
      ...agent,
      skills: [issueSkill, customSkill],
    };

    expect(agentWithSkillRuntime(agentWithMultipleSkills, customSkill)).toMatchObject({
      provider: "claude",
      model: "opus",
      effort: "high",
      skill: expect.stringContaining("Desktop release (active)"),
    });
    expect(agentWithSkillsRuntime(agentWithMultipleSkills)).toMatchObject({
      provider: agent.provider,
      model: agent.model,
      effort: agent.effort,
      skill: expect.stringContaining("No Skill was preselected"),
    });
  });

  it("creates the same repository workflow contract for every agent", () => {
    const skill = projectAgentSkill(defaultProjectAgentCopy("en"));

    expect(skill).toContain("Owns the project's development and code-related work.");
    expect(skill).toContain("attached project workflow");
    expect(skill).not.toContain("briar queue claim");
  });

  it("creates a repository workflow skill", () => {
    const skill = projectAgentSkill({
      name: "Auditor",
      responsibility: "Audit the repository.",
    });

    expect(skill).toContain("# Auditor");
    expect(skill).toContain("attached project workflow");
    expect(skill).not.toContain("briar queue claim");
  });
});
