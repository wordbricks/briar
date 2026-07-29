import { describe, expect, it } from "vitest";
import {
  defaultProjectAgentCopy,
  normalizeProjectAgentLocale,
  projectAgentRuntimeInstructions,
  projectAgentSkill,
} from "./project-agent";

describe("default project agent copy", () => {
  it("uses the requested Korean responsibility", () => {
    expect(defaultProjectAgentCopy("ko")).toEqual({
      name: "자동 사냥 에이전트",
      responsibility: "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
    });
  });

  it("localizes English and Chinese project agents", () => {
    expect(defaultProjectAgentCopy("en")).toEqual({
      name: "Auto Hunt agent",
      responsibility: "Perform Auto Hunt for every queued issue.",
    });
    expect(defaultProjectAgentCopy("zh")).toEqual({
      name: "自动狩猎智能体",
      responsibility: "对所有排队中的问题执行自动狩猎。",
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
  it("creates the same repository workflow contract for every agent", () => {
    const skill = projectAgentSkill(defaultProjectAgentCopy("en"));

    expect(skill).toContain("Perform Auto Hunt for every queued issue.");
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
        version: 1,
        stages: [
          { id: "analyzing", label: "Analyze", required: true },
          { id: "local_qa", label: "Local QA", required: true },
        ],
        execution: { stopAfterStage: "local_qa" },
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
