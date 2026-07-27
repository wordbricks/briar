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
  it("shows agent profile fields and the shared project runtime settings", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const agent = {
      id: "agent-1",
      projectId: "project-1",
      name: "Auto Hunt agent",
      provider: "codex" as const,
      model: null,
      responsibility: "Process queued issues.",
      skill: "# Auto Hunt agent\n\nProcess queued issues.",
      calendarColor: "#3275d5",
      kind: "auto_hunt" as const,
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
        ".project-agent-settings-fields input",
      )?.value,
    ).toBe("Auto Hunt agent");
    expect(container.textContent).toContain("프로젝트 실행 기본값");
    expect(
      container.querySelector("#project-agent-runtime-provider"),
    ).not.toBeNull();
    expect(container.querySelector("#project-agent-runtime-model")).not.toBeNull();
    expect(container.querySelector("#project-agent-runtime-effort")).not.toBeNull();
    expect(
      container.querySelector("#project-agent-runtime-approval"),
    ).not.toBeNull();
    expect(
      container.querySelector<HTMLInputElement>(
        'input[aria-label="캘린더 색상"]',
      )?.value,
    ).toBe("#3275d5");

    const providerTrigger = container.querySelector<HTMLButtonElement>(
      "#project-agent-runtime-provider",
    );
    await act(async () => providerTrigger?.click());
    expect(
      Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          "#project-agent-runtime-provider-listbox .select-menu-option",
        ),
      ).map((option) => option.dataset.value),
    ).toEqual(["codex", "claude", "grok"]);

    await act(async () => {
      document
        .querySelector<HTMLButtonElement>(
          '#project-agent-runtime-provider-listbox .select-menu-option[data-value="claude"]',
        )
        ?.click();
    });
    const runtimeSave = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-agent-settings-save",
      ),
    ).at(-1);
    expect(runtimeSave?.textContent).toContain("실행 기본값 저장");
    await act(async () => runtimeSave?.click());
    expect(runtimeSave?.textContent).toContain("저장됨");

    await act(async () => root.unmount());
    container.remove();
  });
});
