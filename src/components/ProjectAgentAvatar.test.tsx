/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { ProjectAgent } from "../types";
import { ProjectAgentAvatar } from "./ProjectAgentAvatar";

const loadProjectAgentSpriteSheet = vi.hoisted(() => vi.fn());

vi.mock("../lib/api", () => ({
  loadProjectAgentSpriteSheet,
}));

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
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => "blob:agent-sprite-sheet"),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: vi.fn(),
  });
});

afterEach(async () => {
  while (mounted.length > 0) {
    const item = mounted.pop()!;
    await act(async () => item.root.unmount());
    item.container.remove();
  }
  vi.clearAllMocks();
});

const agent: ProjectAgent = {
  id: "agent-1",
  projectId: "project-1",
  name: "Codex Pet agent",
  avatar: "data:image/png;base64,avatar",
  codexPet: {
    slug: "pet",
    name: "Pet",
    author: "Author",
    license: "CC BY-NC 4.0",
    spriteVersion: 2,
    spriteSheetUrl: "/projects/project-1/agents/agent-1/spritesheet",
  },
  provider: "codex",
  model: null,
  effort: null,
  responsibility: "Run tasks",
  skill: "# Agent",
  skills: [],
  calendarColor: "#3275d5",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
};

function createMount() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  return { container, root };
}

describe("ProjectAgentAvatar", () => {
  it("plays the Codex Pet running row while the agent session is active", async () => {
    loadProjectAgentSpriteSheet.mockResolvedValue(
      new Blob(["sprite"], { type: "image/webp" }),
    );
    const { container, root } = createMount();

    await act(async () => {
      root.render(
        <ProjectAgentAvatar agent={agent} isRunning token="access-token" />,
      );
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(
          container.querySelector('[data-animation="running"]'),
        ).not.toBeNull(),
      );
    });

    expect(loadProjectAgentSpriteSheet).toHaveBeenCalledWith(
      "access-token",
      "project-1",
      "agent-1",
    );
    expect(
      container.querySelector(".project-agent-codex-pet-sprite.version-2"),
    ).not.toBeNull();

    await act(async () => {
      root.render(
        <ProjectAgentAvatar
          agent={agent}
          isRunning={false}
          token="access-token"
        />,
      );
    });

    expect(container.querySelector('[data-animation="running"]')).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      agent.avatar,
    );
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(
      "blob:agent-sprite-sheet",
    );
  });

  it("keeps a regular uploaded avatar static during a running session", async () => {
    const { codexPet: _codexPet, ...regularAgent } = agent;
    const { container, root } = createMount();

    await act(async () => {
      root.render(
        <ProjectAgentAvatar
          agent={{ ...regularAgent, codexPet: null }}
          isRunning
          token="access-token"
        />,
      );
    });

    expect(loadProjectAgentSpriteSheet).not.toHaveBeenCalled();
    expect(container.querySelector('[data-animation="running"]')).toBeNull();
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      agent.avatar,
    );
  });
});
