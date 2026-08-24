/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import { DirectMessages } from "./DirectMessages";

const {
  createDirectMessage,
  loadOrganizationMembers,
  listOrganizationAgents,
} = vi.hoisted(() => ({
  createDirectMessage: vi.fn(),
  loadOrganizationMembers: vi.fn(),
  listOrganizationAgents: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/api")>()),
  createDirectMessage,
  loadOrganizationMembers,
  listOrganizationAgents,
}));

describe("DirectMessages", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    loadOrganizationMembers.mockResolvedValue([
      {
        userId: "user-2",
        name: "Mina",
        email: "mina@example.com",
        image: null,
        role: "member",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
    listOrganizationAgents.mockResolvedValue({
      canManage: true,
      agents: [{
        agentId: "aa000000-0000-4000-8000-000000000001",
        name: "Falcon",
        avatar: null,
        provider: "codex",
        model: null,
        effort: null,
        projectId: "project-1",
        projectName: "Falcon Project",
        description: "Research agent",
        responsibility: "Research",
        skills: [],
        createdAt: "2026-01-01T00:00:00.000Z",
      }],
    });
    createDirectMessage.mockResolvedValue({
      channel: {
        id: "dm-1",
        organizationId: "org-1",
        kind: "dm",
        slug: "dm-1",
        name: "Falcon",
        topic: null,
        visibility: "private",
        defaultProjectId: null,
        archivedAt: null,
        memberCount: 1,
        agentCount: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("creates an Agent DM from the recipient picker", async () => {
    const onChannelSelect = vi.fn();
    const onChannelsChange = vi.fn();
    await act(async () => {
      root.render(
        <I18nProvider>
          <DirectMessages
            activeChannelId={null}
            channels={[]}
            currentUserId="user-1"
            onChannelSelect={onChannelSelect}
            onChannelsChange={onChannelsChange}
            organizationId="org-1"
            token="token"
          />
        </I18nProvider>,
      );
    });
    await act(async () => Promise.resolve());

    const falcon = [...container.querySelectorAll<HTMLButtonElement>(
      ".dm-candidate-popover > button",
    )].find((button) => button.textContent?.includes("Falcon"));
    expect(falcon).toBeTruthy();
    expect(falcon!.textContent).toContain("Falcon Project");
    await act(async () => falcon!.click());
    const start = container.querySelector<HTMLButtonElement>(".dm-start-button")!;
    expect(start.disabled).toBe(false);
    await act(async () => start.click());

    expect(createDirectMessage).toHaveBeenCalledWith("token", "org-1", {
      memberIds: [],
      agentIds: ["aa000000-0000-4000-8000-000000000001"],
    });
    expect(onChannelSelect).toHaveBeenCalledWith("dm-1");
    expect(onChannelsChange).toHaveBeenCalledOnce();
  });

  it("finds Project Agents by their project name", async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <DirectMessages
            activeChannelId={null}
            channels={[]}
            currentUserId="user-1"
            onChannelSelect={vi.fn()}
            onChannelsChange={vi.fn()}
            organizationId="org-1"
            token="token"
          />
        </I18nProvider>,
      );
    });
    await act(async () => Promise.resolve());

    const search = container.querySelector<HTMLInputElement>(
      ".dm-recipient-field input",
    )!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
        ?.set?.call(search, "Falcon Project");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const results = container.querySelectorAll<HTMLButtonElement>(
      ".dm-candidate-popover > button",
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.textContent).toContain("Falcon");
  });
});
