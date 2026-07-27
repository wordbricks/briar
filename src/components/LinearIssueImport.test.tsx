/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { repositoryWorkflowBootstrap } from "../lib/auto-hunt-contract";
import { LinearIssueImport } from "./LinearIssueImport";

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
});
