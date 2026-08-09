import { describe, expect, it } from "vitest";
import {
  agentWithSkillRuntime,
  defaultAgentSkill,
  defaultProjectAgentCopy,
  defaultProjectAgentSkillCopy,
  issueProcessingAgentSkill,
  normalizeProjectAgentLocale,
  projectAgentRuntimeInstructions,
  projectAgentSkill,
} from "./project-agent";
import { demoProjectAgents } from "./demo-project-agents";

describe("default project agent copy", () => {
  it("uses the requested Korean responsibility", () => {
    expect(defaultProjectAgentCopy("ko")).toEqual({
      name: "개발자 에이전트",
      responsibility: "대기 중인 모든 이슈를 처리합니다.",
    });
    expect(defaultProjectAgentSkillCopy("ko")).toEqual({
      name: "이슈 처리",
      instructions: "대기 중인 모든 이슈를 처리합니다.",
    });
  });

  it("localizes English and Chinese project agents", () => {
    expect(defaultProjectAgentCopy("en")).toEqual({
      name: "Developer agent",
      responsibility: "Process every queued issue.",
    });
    expect(defaultProjectAgentCopy("zh")).toEqual({
      name: "开发者智能体",
      responsibility: "处理所有排队中的问题。",
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
  it("selects the default and issue-processing skill and applies its runtime", () => {
    const agent = demoProjectAgents("project-1", "en")[0]!;
    const issueSkill = agent.skills[0]!;
    const customSkill = {
      ...issueSkill,
      id: "skill-release",
      name: "Desktop release",
      instructions: "Publish the desktop app.",
      provider: "claude" as const,
      model: "opus",
      effort: "high" as const,
      kind: "custom" as const,
      isDefault: true,
      position: 1,
    };
    const agentWithMultipleSkills = {
      ...agent,
      skills: [{ ...issueSkill, isDefault: false }, customSkill],
    };

    expect(defaultAgentSkill(agentWithMultipleSkills)?.id).toBe("skill-release");
    expect(issueProcessingAgentSkill(agentWithMultipleSkills)?.id).toBe(
      issueSkill.id,
    );
    expect(agentWithSkillRuntime(agentWithMultipleSkills, customSkill)).toMatchObject({
      provider: "claude",
      model: "opus",
      effort: "high",
      skill: expect.stringContaining("Desktop release (active)"),
    });
  });

  it("creates the same repository workflow contract for every agent", () => {
    const skill = projectAgentSkill(defaultProjectAgentCopy("en"));

    expect(skill).toContain("Process every queued issue.");
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

  it("attaches the agent skill and ordered project workflow at invocation", () => {
    const instructions = projectAgentRuntimeInstructions({
      skill: "# Auditor\n\nAudit the repository.",
      workflow: {
        version: 2,
        requirements: [],
        stages: [
          { id: "analyzing", label: "Analyze", required: true },
          { id: "local_qa", label: "Local QA", required: true },
        ],
        execution: { checkpoints: [] },
        completion: { requiredStages: ["analyzing", "local_qa"] },
      },
      invocation: "Run the scheduled automation.",
    });

    expect(instructions).toContain("# Auditor");
    expect(instructions.indexOf('"analyzing"')).toBeLessThan(
      instructions.indexOf('"local_qa"'),
    );
    expect(instructions).toContain("workflow snapshot overrides");
  });
});
