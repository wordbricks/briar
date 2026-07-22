/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { ProjectSettings } from "./ProjectSettings";

describe("ProjectSettings", () => {
  it("configures the project approval policy", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectSettings
          isDeleting={false}
          isSidebarOpen
          onBack={() => undefined}
          onDelete={async () => undefined}
          onSidebarOpen={() => undefined}
          project={{
            id: "project-1",
            name: "Briar",
            createdAt: "2026-07-22T00:00:00Z",
          }}
        />,
      );
    });

    const select = container.querySelector<HTMLSelectElement>(
      "#project-approval-policy",
    );
    expect(Array.from(select?.options ?? []).map((option) => option.value)).toEqual([
      "untrusted",
      "on-request",
      "never",
    ]);
    await act(async () => {
      if (!select) return;
      select.value = "on-request";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector(".project-settings-llm")?.textContent).toContain(
      "Codex가 읽기 전용 경계를 넘어야 할 때 승인을 요청합니다.",
    );

    const saveButton = container.querySelector<HTMLButtonElement>(
      ".project-settings-llm-control button",
    );
    expect(saveButton?.textContent).toContain("저장");
    await act(async () => saveButton?.click());
    expect(saveButton?.textContent).toContain("저장됨");

    await act(async () => root.unmount());
    container.remove();
  });

  it("asks for confirmation once before deleting the project", async () => {
    const onDelete = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <ProjectSettings
          isDeleting={false}
          isSidebarOpen
          onBack={() => undefined}
          onDelete={onDelete}
          onSidebarOpen={() => undefined}
          project={{
            id: "project-1",
            name: "Briar",
            createdAt: "2026-07-22T00:00:00Z",
          }}
        />,
      );
    });

    const deleteButton = container.querySelector<HTMLButtonElement>(
      ".project-settings-danger > button",
    );
    await act(async () => deleteButton?.click());
    expect(onDelete).not.toHaveBeenCalled();
    expect(container.querySelector('[role="dialog"]')?.textContent).toContain(
      "Briar 프로젝트를 삭제할까요?",
    );

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".delete-project-confirm")?.click();
    });
    expect(onDelete).toHaveBeenCalledOnce();

    await act(async () => root.unmount());
    container.remove();
  });
});
