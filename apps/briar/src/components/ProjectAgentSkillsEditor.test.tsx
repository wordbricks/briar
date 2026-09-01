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
            executionMode: "task",
            approvalPolicy: "explicit",
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

  it("does not expose provider, model, or effort controls for conversation Skills", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    mounted.push({ cleanup });

    await renderReactTestRoot(
      root,
      <ProjectAgentSkillsEditor
        defaultEffort="high"
        defaultModel="gpt-5.6-sol"
        defaultProvider="codex"
        onChange={vi.fn()}
        skills={[{
          id: "conversation-skill-1",
          name: "대화 스킬",
          description: "현재 대화에서 실행합니다.",
          body: "현재 대화의 설정을 사용합니다.",
          provider: "codex",
          model: "gpt-5.6-sol",
          effort: "high",
          kind: "custom",
          executionMode: "conversation",
          approvalPolicy: "explicit",
          position: 0,
        }]}
      />,
    );

    expect(container.querySelector('button[aria-label*="프로바이더"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="모델"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="Effort"]')).toBeNull();
    expect(container.querySelector('button[aria-label*="실행 위치"]')).not.toBeNull();
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
      executionMode: "task" as const,
      approvalPolicy: "explicit" as const,
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
