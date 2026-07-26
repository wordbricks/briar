/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type { ProjectAgent } from "../types";
import { CreateProjectAgentScheduleDialog } from "./ProjectSchedule";

const agent: ProjectAgent = {
  id: "11111111-1111-4111-8111-111111111111",
  projectId: "22222222-2222-4222-8222-222222222222",
  name: "Auto Hunt agent",
  provider: "codex",
  model: null,
  responsibility: "Run the queued issue workflow.",
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
};

const mounted: Array<{
  container: HTMLDivElement;
  root: ReturnType<typeof createRoot>;
}> = [];

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

describe("CreateProjectAgentScheduleDialog", () => {
  it("submits the selected agent, recurrence, local time, and time zone", async () => {
    const onCreate = vi.fn(async () => undefined);
    const container = await mount(
      <I18nProvider>
        <CreateProjectAgentScheduleDialog
          agents={[agent]}
          isSubmitting={false}
          onClose={() => undefined}
          onCreate={onCreate}
        />
      </I18nProvider>,
    );

    const name = container.querySelector<HTMLInputElement>(
      'input:not([type="time"])',
    );
    expect(name).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(name, "평일 저장소 점검");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
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
      agentId: agent.id,
      name: "평일 저장소 점검",
      recurrence: "weekdays",
      timeOfDay: "09:00",
      dayOfWeek: null,
      timeZone: expect.any(String),
    });
  });
});
