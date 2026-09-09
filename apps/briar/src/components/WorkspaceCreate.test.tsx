/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkspaceCreate } from "./WorkspaceCreate";

const setInputValue = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

afterEach(() => {
  vi.useRealTimers();
});

describe("WorkspaceCreate", () => {
  it("generates a handle from the name and creates the workspace", async () => {
    vi.useFakeTimers();
    const onCheckHandle = vi.fn().mockResolvedValue(true);
    const onCreate = vi.fn().mockResolvedValue(undefined);
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <WorkspaceCreate
        onBack={() => undefined}
        onCheckHandle={onCheckHandle}
        onCreate={onCreate}
      />,
    );

    const surface = container.querySelector(".workspace-create");
    expect(surface?.hasAttribute("data-tauri-drag-region")).toBe(true);
    const header = surface?.querySelector(".workspace-create-header");
    expect(header?.hasAttribute("data-tauri-drag-region")).toBe(true);
    expect(
      header?.querySelector("button")?.hasAttribute("data-tauri-drag-region"),
    ).toBe(false);
    const [name, handle] = Array.from(
      container.querySelectorAll<HTMLInputElement>("input"),
    );
    await act(async () => setInputValue(name!, "My Workspace 2026"));
    expect(handle?.value).toBe("my-workspace-2026");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(onCheckHandle).toHaveBeenCalledWith("my-workspace-2026");

    await act(async () => {
      container.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    expect(onCreate).toHaveBeenCalledWith({
      name: "My Workspace 2026",
      handle: "my-workspace-2026",
    });

    await cleanup();
  });

  it("shows a warning and blocks submission when the handle is taken", async () => {
    vi.useFakeTimers();
    const onCheckHandle = vi.fn().mockResolvedValue(false);
    const onCreate = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <WorkspaceCreate
        onBack={() => undefined}
        onCheckHandle={onCheckHandle}
        onCreate={onCreate}
      />,
    );

    const name = container.querySelector<HTMLInputElement>(
      'input[autocomplete="workspace"]',
    );
    await act(async () => setInputValue(name!, "Briar"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "이미 사용 중인 핸들",
    );
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent === "워크스페이스 만들기",
      )?.disabled,
    ).toBe(true);
    expect(onCreate).not.toHaveBeenCalled();

    await cleanup();
  });
});
