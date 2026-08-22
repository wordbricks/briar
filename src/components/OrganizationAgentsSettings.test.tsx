/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listOrganizationAgents = vi.fn();
const createOrganizationAgent = vi.fn();
const updateOrganizationAgent = vi.fn();
const deleteOrganizationAgent = vi.fn();

vi.mock("../lib/api", () => ({
  listOrganizationAgents: (...args: unknown[]) =>
    listOrganizationAgents(...args),
  createOrganizationAgent: (...args: unknown[]) =>
    createOrganizationAgent(...args),
  updateOrganizationAgent: (...args: unknown[]) =>
    updateOrganizationAgent(...args),
  deleteOrganizationAgent: (...args: unknown[]) =>
    deleteOrganizationAgent(...args),
}));

const { OrganizationAgentsSettings } = await import(
  "./OrganizationAgentsSettings"
);

const organizationAgent = {
  agentId: "agent-1",
  name: "Honey",
  provider: "codex" as const,
  model: null,
  effort: null,
  projectId: null,
  description: "제품 기획 질문을 돕는 에이전트",
  responsibility: "채널에서 제품 기획을 돕습니다.",
  skills: [
    {
      id: "00000000-0000-4000-8000-000000000011",
      agentId: "agent-1",
      name: "Product planning",
      description: "제품 기획 질문을 받았을 때 사용합니다.",
      body: "제품 기획 질문에 답합니다.",
      provider: "codex" as const,
      model: null,
      effort: null,
      kind: "custom" as const,
      position: 0,
      createdAt: "2026-08-07T00:00:00.000Z",
      updatedAt: "2026-08-07T00:00:00.000Z",
    },
  ],
  createdAt: "2026-08-07T00:00:00.000Z",
};

const projectAgent = {
  ...organizationAgent,
  agentId: "agent-project",
  name: "Builder",
  projectId: "project-1",
};

const setInputValue = (
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) => {
  const prototype =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("OrganizationAgentsSettings", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    vi.clearAllMocks();
    listOrganizationAgents.mockResolvedValue({
      agents: [organizationAgent, projectAgent],
      canManage: true,
    });
    createOrganizationAgent.mockResolvedValue({ agent: organizationAgent });
    updateOrganizationAgent.mockResolvedValue({ agent: organizationAgent });
    deleteOrganizationAgent.mockResolvedValue({ deleted: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const render = async () => {
    await act(async () => {
      root.render(
        <OrganizationAgentsSettings
          organizationId="organization-1"
          organizationName="Wordbricks"
          token="token"
        />,
      );
    });
    await act(async () => Promise.resolve());
  };

  it("shows only repository-free organization agents", async () => {
    await render();

    expect(container.textContent).toContain("Honey");
    expect(container.textContent).not.toContain("@honey");
    expect(container.textContent).not.toContain("Builder");
    expect(container.textContent).not.toContain("스케줄");
  });

  it("shows the Agent-level runtime on an organization Agent card", async () => {
    listOrganizationAgents.mockResolvedValue({
      agents: [
        {
          ...organizationAgent,
          skills: [
            {
              ...organizationAgent.skills[0],
              provider: "claude",
              model: "sonnet",
            },
          ],
        },
      ],
      canManage: true,
    });
    await render();

    expect(container.textContent).toContain("Codex");
    expect(container.textContent).not.toContain("Claude · sonnet");
  });

  it("saves per-Skill runtime settings for an organization Agent", async () => {
    await render();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Honey · 스킬"]')!
        .click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "저장")!
        .click();
    });

    expect(updateOrganizationAgent).toHaveBeenCalledWith(
      "token",
      "organization-1",
      "agent-1",
      expect.objectContaining({
        responsibility: organizationAgent.responsibility,
        skills: [
          expect.objectContaining({
            id: "00000000-0000-4000-8000-000000000011",
            name: "Product planning",
            provider: "codex",
          }),
        ],
      }),
    );
  });

  it("shows Skill save failures inside the edit dialog", async () => {
    updateOrganizationAgent.mockRejectedValue(
      new Error("스킬 저장에 실패했습니다."),
    );
    await render();

    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Honey · 스킬"]')!
        .click();
    });
    await act(async () => {
      Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.trim() === "저장")!
        .click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(
      document.querySelector<HTMLElement>('[role="dialog"] [role="alert"]')
        ?.textContent,
    ).toContain("스킬 저장에 실패했습니다.");
  });

  it("creates an agent using its name as the mention identity", async () => {
    listOrganizationAgents.mockResolvedValue({ agents: [], canManage: true });
    createOrganizationAgent.mockResolvedValue({
      agent: { ...organizationAgent, agentId: "agent-new" },
    });
    await render();

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("에이전트 만들기"))
        ?.click();
    });

    const name = document.querySelector<HTMLInputElement>(
      "#organization-agent-name",
    )!;
    const responsibility = document.querySelector<HTMLTextAreaElement>(
      "#organization-agent-responsibility",
    )!;
    const description = document.querySelector<HTMLTextAreaElement>(
      "#organization-agent-description",
    )!;

    await act(async () => setInputValue(name, "Honey Bee"));
    await act(async () => setInputValue(name, "Honey Planner"));
    await act(async () =>
      setInputValue(description, "제품 기획 질문에 답하는 에이전트"),
    );
    expect(document.querySelector("#organization-agent-handle")).toBeNull();

    await act(async () =>
      setInputValue(responsibility, "채널에서 기획 질문에 답합니다."),
    );
    await act(async () => {
      document
        .querySelector<HTMLFormElement>("#organization-agent-create-form")!
        .dispatchEvent(
          new Event("submit", { bubbles: true, cancelable: true }),
        );
    });

    expect(createOrganizationAgent).toHaveBeenCalledWith(
      "token",
      "organization-1",
      expect.objectContaining({
        name: "Honey Planner",
        provider: "codex",
        model: null,
        effort: null,
        description: "제품 기획 질문에 답하는 에이전트",
        responsibility: "채널에서 기획 질문에 답합니다.",
      }),
    );
  });

  it("accepts non-Latin Agent names without generating a handle", async () => {
    listOrganizationAgents.mockResolvedValue({ agents: [], canManage: true });
    await render();

    await act(async () => {
      Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
        .find((button) => button.textContent?.includes("에이전트 만들기"))
        ?.click();
    });
    await act(async () =>
      setInputValue(
        document.querySelector<HTMLInputElement>(
          "#organization-agent-name",
        )!,
        "꿀벌",
      ),
    );

    expect(document.querySelector("#organization-agent-handle")).toBeNull();
  });
});
