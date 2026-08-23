/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { repositoryWorkflowBootstrap } from "../lib/auto-hunt-contract";
import { armMacPasswordEditor } from "../lib/macos-secure-input";
import { isMacDesktopTauri } from "../lib/platform";
import { LinearIssueImport } from "./LinearIssueImport";

vi.mock("../lib/platform", () => ({
  isMacDesktopTauri: vi.fn(() => false),
}));
vi.mock("../lib/macos-secure-input", () => ({
  armMacPasswordEditor: vi.fn(),
}));

type BooleanMock = {
  mockReset: () => BooleanMock;
  mockReturnValue: (value: boolean) => BooleanMock;
};
const macDesktopTauriMock = isMacDesktopTauri as unknown as BooleanMock;
const armPasswordEditorMock = armMacPasswordEditor as unknown as {
  mockClear: () => void;
  mock: { calls: unknown[][] };
};

afterEach(() => {
  macDesktopTauriMock.mockReset().mockReturnValue(false);
  armPasswordEditorMock.mockClear();
  document.body.replaceChildren();
});

describe("LinearIssueImport", () => {
  it("walks connect → team select → status mapping → import", async () => {
    const onConnect = vi.fn(async () => ({
      viewer: {
        name: "Jay",
        email: "jay@example.com",
        organizationName: "Wordbricks",
      },
      teams: [
        { id: "team-1", name: "Briar", key: "BRI" },
        { id: "team-2", name: "Platform", key: "PLAT" },
      ],
    }));
    const onLoadStates = vi.fn(async () => ({
      states: [
        {
          id: "state-1",
          name: "Todo",
          type: "unstarted",
          color: "#ccc",
          position: 0,
          teamId: "team-1",
          teamKey: "BRI",
          teamName: "Briar",
        },
        {
          id: "state-2",
          name: "Done",
          type: "completed",
          color: "#0a0",
          position: 1,
          teamId: "team-1",
          teamKey: "BRI",
          teamName: "Briar",
        },
      ],
    }));
    const onImport = vi.fn(async () => ({
      imported: 2,
      skipped: 0,
      failed: 0,
      total: 2,
      truncated: false,
    }));

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <LinearIssueImport
          active
          onConnect={onConnect}
          onImport={onImport}
          onLoadStates={onLoadStates}
          projectId="project-1"
          repositoryConnected
          workflow={repositoryWorkflowBootstrap}
        />,
      );
    });

    expect(container.textContent).toContain("Linear 이슈 가져오기");

    const apiKey = container.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    await act(async () => {
      if (!apiKey) return;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(apiKey, "lin_api_test_key");
      apiKey.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const connectButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("Linear 연결"));
    await act(async () => connectButton?.click());

    expect(onConnect).toHaveBeenCalledWith("lin_api_test_key");
    expect(container.textContent).toContain("가져올 팀 선택");
    expect(container.textContent).toContain("Briar");

    const continueButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("상태 매핑으로"));
    await act(async () => continueButton?.click());

    expect(onLoadStates).toHaveBeenCalledWith({
      apiKey: "lin_api_test_key",
      teamIds: ["team-1", "team-2"],
    });
    expect(container.textContent).toContain("Linear 상태");
    expect(container.textContent).toContain("Todo");
    expect(container.textContent).toContain("Done");

    const importButton = Array.from(
      container.querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.includes("이슈 가져오기"));
    await act(async () => importButton?.click());

    expect(onImport).toHaveBeenCalledWith({
      apiKey: "lin_api_test_key",
      teamIds: ["team-1", "team-2"],
      statusMapping: {
        "state-1": "status:queued",
        "state-2": "status:completed",
      },
    });
    expect(container.textContent).toContain("가져옴");

    await act(async () => root.unmount());
    container.remove();
  });

  it("blocks the import wizard until a repository is connected", async () => {
    const onConnect = vi.fn(async () => ({
      viewer: { name: "Jay", email: null, organizationName: "Org" },
      teams: [],
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <LinearIssueImport
          active
          onConnect={onConnect}
          onImport={async () => ({
            imported: 0,
            skipped: 0,
            failed: 0,
            total: 0,
            truncated: false,
          })}
          onLoadStates={async () => ({ states: [] })}
          projectId="project-1"
          repositoryConnected={false}
          workflow={repositoryWorkflowBootstrap}
        />,
      );
    });

    expect(container.textContent).toContain(
      "저장소를 연결한 뒤에 Linear 이슈를 가져올 수 있습니다.",
    );
    expect(container.querySelector('input[type="password"]')).toBeNull();
    expect(onConnect).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });

  it("uses a hard macOS window-focus boundary without weakening ordinary password blur", async () => {
    macDesktopTauriMock.mockReturnValue(true);
    const props = {
      active: true,
      onConnect: vi.fn(async () => ({
        viewer: { name: "Jay", email: null, organizationName: "Org" },
        teams: [],
      })),
      onImport: vi.fn(async () => ({
        imported: 0,
        skipped: 0,
        failed: 0,
        total: 0,
        truncated: false,
      })),
      onLoadStates: vi.fn(async () => ({ states: [] })),
      projectId: "project-1",
      repositoryConnected: true,
      workflow: repositoryWorkflowBootstrap,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => root.render(<LinearIssueImport {...props} />));
    const apiKey = container.querySelector<HTMLInputElement>(
      ".project-settings-linear-import-api-key",
    );
    expect(apiKey?.type).toBe("password");
    expect(apiKey?.getAttribute("aria-hidden")).toBeNull();
    expect(apiKey?.style.getPropertyValue("-webkit-text-security")).toBe(
      "disc",
    );

    await act(async () => apiKey?.focus());
    expect(armPasswordEditorMock.mock.calls).toHaveLength(1);

    await act(async () => apiKey?.blur());
    await act(async () => root.render(<LinearIssueImport {...props} />));
    expect(apiKey?.type).toBe("password");
    expect(apiKey?.getAttribute("aria-hidden")).toBeNull();

    await act(async () => apiKey?.focus());
    expect(armPasswordEditorMock.mock.calls).toHaveLength(2);
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(apiKey?.type).toBe("text");
    expect(apiKey?.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).not.toBe(apiKey);

    // The disarmed state is declarative and survives unrelated React renders.
    await act(async () => root.render(<LinearIssueImport {...props} />));
    expect(apiKey?.type).toBe("text");
    expect(apiKey?.getAttribute("aria-hidden")).toBe("true");

    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(apiKey?.type).toBe("password");
    expect(apiKey?.getAttribute("aria-hidden")).toBeNull();
    expect(document.activeElement).not.toBe(apiKey);
    expect(armPasswordEditorMock.mock.calls).toHaveLength(2);

    // A later switch without a newly focused password editor is a no-op.
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(apiKey?.type).toBe("password");
    expect(apiKey?.getAttribute("aria-hidden")).toBeNull();

    await act(async () => root.unmount());
    container.remove();
  });

  it("disarms the live macOS editor before hiding or removing it", async () => {
    macDesktopTauriMock.mockReturnValue(true);
    const props = {
      onConnect: vi.fn(async () => ({
        viewer: { name: "Jay", email: null, organizationName: "Org" },
        teams: [],
      })),
      onImport: vi.fn(async () => ({
        imported: 0,
        skipped: 0,
        failed: 0,
        total: 0,
        truncated: false,
      })),
      onLoadStates: vi.fn(async () => ({ states: [] })),
      projectId: "project-1",
      repositoryConnected: true,
      workflow: repositoryWorkflowBootstrap,
    };
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () =>
      root.render(<LinearIssueImport {...props} active />),
    );
    const apiKey = container.querySelector<HTMLInputElement>(
      ".project-settings-linear-import-api-key",
    );
    const typeDescriptor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "type",
    );
    const blurSpy = vi.spyOn(apiKey as HTMLInputElement, "blur");
    const transitions: Array<{
      ariaHidden: string | null;
      connected: boolean;
      disabled: boolean;
      value: string;
    }> = [];
    if (apiKey && typeDescriptor?.get && typeDescriptor.set) {
      Object.defineProperty(apiKey, "type", {
        configurable: true,
        get: () => typeDescriptor.get?.call(apiKey),
        set: (value: string) => {
          transitions.push({
            ariaHidden: apiKey.getAttribute("aria-hidden"),
            connected: apiKey.isConnected,
            disabled: apiKey.disabled,
            value,
          });
          typeDescriptor.set?.call(apiKey, value);
        },
      });
    }

    await act(async () => apiKey?.focus());
    await act(async () =>
      root.render(<LinearIssueImport {...props} active={false} />),
    );
    expect(
      transitions.find((transition) => transition.value === "text"),
    ).toEqual({
      ariaHidden: "true",
      connected: true,
      disabled: false,
      value: "text",
    });
    expect(apiKey?.type).toBe("text");
    expect(apiKey?.getAttribute("aria-hidden")).toBe("true");
    expect(blurSpy).not.toHaveBeenCalled();

    await act(async () =>
      root.render(<LinearIssueImport {...props} active />),
    );
    expect(apiKey?.type).toBe("password");
    expect(apiKey?.getAttribute("aria-hidden")).toBeNull();

    transitions.length = 0;
    await act(async () => apiKey?.focus());
    await act(async () => root.unmount());
    expect(
      transitions.find((transition) => transition.value === "text"),
    ).toEqual({
      ariaHidden: "true",
      connected: true,
      disabled: false,
      value: "text",
    });
    expect(blurSpy).not.toHaveBeenCalled();
    container.remove();
  });
});
