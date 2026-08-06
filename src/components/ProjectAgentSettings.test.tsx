/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ProjectAgentSettings } from "./ProjectAgentSettings";

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});
describe("ProjectAgentSettings", () => {
  it("edits the agent provider and model with the profile", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const agent = {
      id: "agent-1",
      projectId: "project-1",
      name: "Issue processing agent",
      avatar: null,
      codexPet: null,
      provider: "codex" as const,
      model: null,
      responsibility: "Process queued issues.",
      skill: "# Issue processing agent\n\nProcess queued issues.",
      calendarColor: "#3275d5",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    };
    const onSave = vi.fn(async (input) => ({
      ...agent,
      ...input,
      name: input.name ?? "Codex Agent",
    }));
    const onDelete = vi.fn(async () => undefined);

    await act(async () => {
      root.render(
        <ProjectAgentSettings
          agent={agent}
          isDeleteDisabled={false}
          isSidebarOpen
          onBack={() => undefined}
          onDelete={onDelete}
          onSave={onSave}
          project={{
            id: "project-1",
            name: "Briar",
            createdAt: "2026-07-26T00:00:00.000Z",
          }}
        />,
      );
      await Promise.resolve();
    });

    expect(
      container.querySelector(
        ".page-header.app-page-header.project-agents-heading.project-agent-settings-heading",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(
        ".project-agent-detail-title .project-agent-settings-back",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector(".project-agents-scroll.project-agent-settings-scroll"),
    ).not.toBeNull();
    expect(
      container.querySelector(
        ".project-agents-body.project-agent-settings-body",
      ),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLInputElement>(
        '.project-agent-settings-fields input[placeholder="예: Jay 이슈 처리 에이전트"]',
      )?.value,
    ).toBe("Issue processing agent");
    expect(
      container.querySelector('input[aria-label="이미지 업로드"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Codex Pet에서 선택");
    expect(
      container.querySelector(".project-agent-settings-fields .native-select"),
    ).not.toBeNull();
    expect(
      container.querySelectorAll(".project-agent-settings-fields .native-select"),
    ).toHaveLength(2);
    expect(container.textContent).toContain("실행 설정");
    expect(container.textContent).not.toContain("프로젝트 실행 기본값");
    expect(container.querySelector("#project-runtime-provider")).toBeNull();
    expect(container.textContent).toContain("에이전트 삭제");
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="캘린더 색상"]',
      )?.value,
    ).toBe("#3275d5");

    const [providerTrigger] = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-agent-settings-fields .native-select button",
      ),
    );
    await act(async () => providerTrigger?.click());
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="claude"]',
        )
        ?.click();
    });
    const [, modelTrigger] = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-agent-settings-fields .native-select button",
      ),
    );
    await act(async () => modelTrigger?.click());
    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '.select-menu-option[data-value="opus"]',
        )
        ?.click();
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form.project-agent-settings-card")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ provider: "claude", model: "opus" }),
    );

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "에이전트 삭제")
        ?.click();
    });
    expect(document.body.textContent).toContain(
      "‘Issue processing agent’ 에이전트를 삭제할까요?",
    );
    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(".project-agent-delete-confirm")
        ?.click();
      await Promise.resolve();
    });
    expect(onDelete).toHaveBeenCalledTimes(1);

    await act(async () => root.unmount());
    container.remove();
  });
});
