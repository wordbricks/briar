/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ProjectAgentSkillsEditor,
  projectAgentSkillInputs,
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
      isDefault: true,
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
        isDefault: true,
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
              isDefault: true,
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
              isDefault: false,
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
  });
});
