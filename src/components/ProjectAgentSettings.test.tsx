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
  it("keeps agent settings focused on the agent profile", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const agent = {
      id: "agent-1",
      projectId: "project-1",
      name: "Auto Hunt agent",
      avatar: null,
      codexPet: null,
      provider: "codex" as const,
      model: null,
      responsibility: "Process queued issues.",
      skill: "# Auto Hunt agent\n\nProcess queued issues.",
      calendarColor: "#3275d5",
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    };
    const onSave = vi.fn(async () => agent);

    await act(async () => {
      root.render(
        <ProjectAgentSettings
          agent={agent}
          isSidebarOpen
          onBack={() => undefined}
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
      container.querySelector<HTMLInputElement>(
        '.project-agent-settings-fields input[placeholder="예: Jay 자동 사냥 에이전트"]',
      )?.value,
    ).toBe("Auto Hunt agent");
    expect(
      container.querySelector('input[aria-label="이미지 업로드"]'),
    ).not.toBeNull();
    expect(container.textContent).toContain("Codex Pet에서 선택");
    expect(
      container.querySelector(".project-agent-settings-fields .native-select"),
    ).toBeNull();
    expect(container.textContent).not.toContain("프로젝트 실행 기본값");
    expect(container.querySelector("#project-runtime-provider")).toBeNull();
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="캘린더 색상"]',
      )?.value,
    ).toBe("#3275d5");

    await act(async () => root.unmount());
    container.remove();
  });
});
