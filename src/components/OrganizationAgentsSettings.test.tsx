/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listOrganizationAgents = vi.fn();
const createOrganizationAgent = vi.fn();
const deleteOrganizationAgent = vi.fn();

vi.mock("../lib/api", () => ({
  listOrganizationAgents: (...args: unknown[]) =>
    listOrganizationAgents(...args),
  createOrganizationAgent: (...args: unknown[]) =>
    createOrganizationAgent(...args),
  deleteOrganizationAgent: (...args: unknown[]) =>
    deleteOrganizationAgent(...args),
}));

const { OrganizationAgentsSettings } = await import(
  "./OrganizationAgentsSettings"
);

const organizationAgent = {
  agentId: "agent-1",
  handle: "honey",
  name: "Honey",
  provider: "codex" as const,
  model: null,
  projectId: null,
  responsibility: "채널에서 제품 기획을 돕습니다.",
  createdAt: "2026-08-07T00:00:00.000Z",
};

const projectAgent = {
  ...organizationAgent,
  agentId: "agent-project",
  handle: "builder",
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
    expect(container.textContent).toContain("@honey");
    expect(container.textContent).not.toContain("Builder");
    expect(container.textContent).not.toContain("스케줄");
  });

  it("auto-generates an editable handle and creates an agent", async () => {
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
    const handle = document.querySelector<HTMLInputElement>(
      "#organization-agent-handle",
    )!;
    const responsibility = document.querySelector<HTMLTextAreaElement>(
      "#organization-agent-responsibility",
    )!;

    await act(async () => setInputValue(name, "Honey Bee"));
    expect(handle.value).toBe("honey-bee");

    await act(async () => setInputValue(handle, "planner"));
    await act(async () => setInputValue(name, "Honey Planner"));
    expect(handle.value).toBe("planner");

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
        handle: "planner",
        provider: "codex",
        model: null,
        effort: null,
        responsibility: "채널에서 기획 질문에 답합니다.",
      }),
    );
  });

  it("explains the generated fallback for names without Latin characters", async () => {
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

    expect(document.body.textContent).toContain(
      "라틴 문자가 없는 이름은 저장할 때 고유 ID 기반 핸들이 자동으로 지정됩니다.",
    );
  });
});
