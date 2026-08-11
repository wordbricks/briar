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
  handle: "auto-hunt-agent",
  name: "Auto Hunt agent",
  avatar: null,
  codexPet: null,
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Run the queued issue workflow.",
  skill: "# Auto Hunt agent\n\nRun the queued issue workflow.",
  skills: [],
  calendarColor: "#3275d5",
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
      intervalValue: 1,
      intervalUnit: "day",
      daysOfWeek: [],
      notificationLevel: "important_updates",
      timeZone: expect.any(String),
    });
  });

  it("submits a custom multi-day weekly cadence", async () => {
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

    const click = async (element: Element | null | undefined) => {
      expect(element).not.toBeNull();
      await act(async () => {
        element?.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      });
    };
    await click(
      container.querySelector(
        ".project-schedule-frequency [role=\"combobox\"]",
      ),
    );
    await click(
      [...document.querySelectorAll('[role="option"]')].find(
        (option) =>
          option.textContent === "사용자화" ||
          option.textContent === "Custom",
      ),
    );

    const name = container.querySelector<HTMLInputElement>(
      'input:not([type="time"]):not([type="number"])',
    );
    const interval = container.querySelector<HTMLInputElement>(
      'input[type="number"]',
    );
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(name, "격주 릴리스 점검");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set?.call(interval, "2");
      interval?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const dayButtons = container.querySelectorAll(
      ".project-schedule-day-picker button",
    );
    await click(dayButtons[2]);
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
      name: "격주 릴리스 점검",
      recurrence: "custom",
      timeOfDay: "09:00",
      dayOfWeek: null,
      intervalValue: 2,
      intervalUnit: "week",
      daysOfWeek: [1, 2],
      notificationLevel: "important_updates",
      timeZone: expect.any(String),
    });
  });
});
