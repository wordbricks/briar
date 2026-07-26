/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CreateProjectAgentDialog,
  ProjectAgents,
} from "./ProjectAgents";

const mounted: Array<{ container: HTMLDivElement; root: ReturnType<typeof createRoot> }> = [];

beforeAll(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    await act(async () => item.root.unmount());
    item.container.remove();
  }
});

async function mount(node: React.ReactNode) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  await act(async () => root.render(node));
  return container;
}

describe("ProjectAgents", () => {
  it("shows the example responsibility-based agent roster in demo mode", async () => {
    const container = await mount(
      <ProjectAgents
        isSidebarOpen
        project={{
          id: "project-1",
          name: "Briar",
          createdAt: "2026-07-26T00:00:00.000Z",
        }}
        token={null}
      />,
    );
    await act(async () => Promise.resolve());

    expect(container.textContent).toContain("자동 사냥 에이전트");
    expect(container.textContent).toContain("Sentry 오류 탐지 에이전트");
    expect(container.textContent).toContain("Feedback 분석 에이전트");
    expect(container.textContent).toContain(
      "모든 대기중인 이슈에 대해서 자동사냥을 수행하는것",
    );
  });

  it("submits provider, default model, and a concrete responsibility", async () => {
    const onCreate = vi.fn(async () => undefined);
    const container = await mount(
      <CreateProjectAgentDialog
        isSubmitting={false}
        onClose={() => undefined}
        onCreate={onCreate}
      />,
    );

    const name = container.querySelector<HTMLInputElement>("input");
    const responsibility =
      container.querySelector<HTMLTextAreaElement>("textarea");
    await act(async () => {
      if (name) {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set?.call(name, "Jay 자동 사냥 에이전트");
        name.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (responsibility) {
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        )?.set?.call(
          responsibility,
          "Jay한테 assign된 todo 이슈를 3개씩 처리하는 에이전트",
        );
        responsibility.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await act(async () => {
      container
        .querySelector<HTMLFormElement>("form")
        ?.dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
      await Promise.resolve();
    });

    expect(onCreate).toHaveBeenCalledWith({
      name: "Jay 자동 사냥 에이전트",
      provider: "codex",
      model: null,
      responsibility:
        "Jay한테 assign된 todo 이슈를 3개씩 처리하는 에이전트",
    });
  });
});
