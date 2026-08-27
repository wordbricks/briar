/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot, type ReactTestRoot } from "../test/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ProjectAgentSkillsEditor,
  projectAgentSkillInputs,
  projectAgentSkillsValid,
} from "./ProjectAgentSkillsEditor";
import {
  agentSkillBodyMaxLength,
  agentSkillDescriptionMaxLength,
  agentSkillsMaxCount,
} from "../lib/agent-limits";

beforeAll(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

const mounted: Array<Pick<ReactTestRoot, "cleanup">> = [];

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    await item.cleanup();
  }
});

describe("ProjectAgentSkillsEditor", () => {
  it("serializes only fields accepted by the Skill input contract", () => {
    const persistedSkill = {
      id: "skill-1",
      agentId: "agent-1",
      name: "Issue processing",
      description: "Use for queued project issues.",
      body: "Process queued issues.",
      provider: "codex" as const,
      model: "gpt-5.6-sol",
      effort: "high" as const,
      kind: "issue_processing" as const,
      position: 9,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    };

    expect(projectAgentSkillInputs([persistedSkill])).toEqual([
      {
        id: "skill-1",
        name: "Issue processing",
        description: "Use for queued project issues.",
        body: "Process queued issues.",
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        kind: "issue_processing",
        executionMode: "task",
        approvalPolicy: "explicit",
        position: 0,
      },
    ]);
  });


  it("allows the final Skill to be deleted", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    mounted.push({ cleanup });
    const onChange = vi.fn();

    await renderReactTestRoot(
      root,
      <ProjectAgentSkillsEditor
        defaultEffort={null}
        defaultModel={null}
        defaultProvider="codex"
        onChange={onChange}
        skills={[
          {
            id: "skill-1",
            name: "임시 스킬",
            description: "삭제 동작을 검증할 때 사용합니다.",
            body: "삭제할 수 있습니다.",
            provider: "codex",
            model: null,
            effort: null,
            kind: "custom",
            position: 0,
          },
        ]}
      />,
    );

    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="임시 스킬 스킬 삭제"]',
    );
    expect(deleteButton?.disabled).toBe(false);
    await act(async () => deleteButton?.click());
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it("enforces description/body limits and rejects a sixth Skill", async () => {
    const skills = Array.from({ length: agentSkillsMaxCount }, (_, index) => ({
      id: `skill-${index}`,
      name: `Skill ${index}`,
      description: "x".repeat(agentSkillDescriptionMaxLength),
      body: "x".repeat(agentSkillBodyMaxLength),
      provider: "codex" as const,
      model: null,
      effort: null,
      kind: "custom" as const,
      position: index,
    }));
    expect(projectAgentSkillsValid(skills)).toBe(true);
    expect(projectAgentSkillsValid([
      ...skills,
      { ...skills[0]!, id: "skill-6", name: "Skill 6", position: 5 },
    ])).toBe(false);

    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    mounted.push({ cleanup });

    await renderReactTestRoot(
      root,
      <ProjectAgentSkillsEditor
        defaultEffort={null}
        defaultModel={null}
        defaultProvider="codex"
        onChange={vi.fn()}
        skills={skills}
      />,
    );

    const addButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("스킬 추가"),
    );
    expect(addButton?.disabled).toBe(true);
    expect(
      container.querySelector<HTMLTextAreaElement>(
        "#project-agent-skill-body-0",
      )?.maxLength,
    ).toBe(agentSkillBodyMaxLength);
    expect(
      container.querySelector<HTMLTextAreaElement>(
        "#project-agent-skill-description-0",
      )?.maxLength,
    ).toBe(agentSkillDescriptionMaxLength);
  });
});
