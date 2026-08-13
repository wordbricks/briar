/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ProjectAgentSkillsEditor,
  projectAgentSkillInputs,
  projectAgentSkillsValid,
} from "./ProjectAgentSkillsEditor";

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

const mounted: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    await act(async () => item.root.unmount());
    item.container.remove();
  }
});

describe("ProjectAgentSkillsEditor", () => {
  it("accepts an empty Skill roster", () => {
    expect(projectAgentSkillsValid([])).toBe(true);
  });

  it("serializes only fields accepted by the Skill input contract", () => {
    const persistedSkill = {
      id: "skill-1",
      agentId: "agent-1",
      name: "Issue processing",
      instructions: "Process queued issues.",
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
        instructions: "Process queued issues.",
        provider: "codex",
        model: "gpt-5.6-sol",
        effort: "high",
        kind: "issue_processing",
        position: 0,
      },
    ]);
  });

  it("includes each Skill name in repeated runtime control names", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });

    await act(async () => {
      root.render(
        <ProjectAgentSkillsEditor
          defaultEffort={null}
          defaultModel={null}
          defaultProvider="codex"
          onChange={vi.fn()}
          skills={[
            {
              id: "skill-1",
              name: "이슈 처리",
              instructions: "대기 이슈를 처리합니다.",
              provider: "codex",
              model: null,
              effort: null,
              kind: "issue_processing",
              position: 0,
            },
            {
              id: "skill-2",
              name: "데스크탑 릴리즈",
              instructions: "데스크탑 앱을 릴리즈합니다.",
              provider: "claude",
              model: "sonnet",
              effort: "high",
              kind: "custom",
              position: 1,
            },
          ]}
        />,
      );
    });

    const labels = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-agent-skill-card .native-select button",
      ),
      (button) => button.getAttribute("aria-label"),
    );
    expect(labels).toEqual(
      expect.arrayContaining([
        "이슈 처리 · 프로바이더",
        "이슈 처리 · 모델",
        "이슈 처리 · Effort",
        "데스크탑 릴리즈 · 프로바이더",
        "데스크탑 릴리즈 · 모델",
        "데스크탑 릴리즈 · Effort",
      ]),
    );
    expect(container.textContent).not.toContain("기본 스킬");
    expect(container.textContent).not.toContain("기본으로 설정");
  });

  it("allows the final Skill to be deleted", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    mounted.push({ container, root });
    const onChange = vi.fn();

    await act(async () => {
      root.render(
        <ProjectAgentSkillsEditor
          defaultEffort={null}
          defaultModel={null}
          defaultProvider="codex"
          onChange={onChange}
          skills={[
            {
              id: "skill-1",
              name: "임시 스킬",
              instructions: "삭제할 수 있습니다.",
              provider: "codex",
              model: null,
              effort: null,
              kind: "custom",
              position: 0,
            },
          ]}
        />,
      );
    });

    const deleteButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="임시 스킬 스킬 삭제"]',
    );
    expect(deleteButton?.disabled).toBe(false);
    await act(async () => deleteButton?.click());
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
