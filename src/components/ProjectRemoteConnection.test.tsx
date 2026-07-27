/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import {
  addSshHost,
  listExecutionHosts,
  listRemoteDirectory,
  loadProjectExecutionConnection,
  updateProjectExecutionConnection,
} from "../lib/project-connection";
import { ProjectRemoteConnection } from "./ProjectRemoteConnection";

vi.mock("../lib/project-connection", () => ({
  addSshHost: vi.fn(),
  listExecutionHosts: vi.fn(),
  listRemoteDirectory: vi.fn(),
  loadProjectExecutionConnection: vi.fn(),
  updateProjectExecutionConnection: vi.fn(),
}));

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe("ProjectRemoteConnection", () => {
  it("browses an SSH host and connects the selected Git repository", async () => {
    vi.mocked(listExecutionHosts).mockResolvedValue([
      { id: "local", kind: "local", label: "이 컴퓨터" },
      {
        id: "ssh:ssh-1",
        alias: "kiwi",
        hostname: "10.0.0.5",
        kind: "ssh",
        label: "kiwi",
      },
    ]);
    vi.mocked(loadProjectExecutionConnection).mockResolvedValue({
      executionHostId: "local",
      repositoryPath: "/Users/dev/local",
    });
    vi.mocked(listRemoteDirectory)
      .mockResolvedValueOnce({
        path: "/Users/dev",
        entries: [{ name: "briar", path: "/Users/dev/briar" }],
        gitRepository: false,
      })
      .mockResolvedValueOnce({
        path: "/Users/dev/briar",
        parentPath: "/Users/dev",
        entries: [{ name: "src", path: "/Users/dev/briar/src" }],
        gitRepository: true,
        repositoryRemote: "git@github.com:wordbricks/briar.git",
      });
    vi.mocked(updateProjectExecutionConnection).mockResolvedValue({
      executionHostId: "ssh:ssh-1",
      repositoryPath: "/Users/dev/briar",
      repositoryRemote: "git@github.com:wordbricks/briar.git",
    });
    vi.mocked(addSshHost).mockRejectedValue(new Error("not used"));

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<ProjectRemoteConnection projectId="project-1" />);
      await flush();
    });

    expect(container.textContent).toContain("kiwi");
    expect(container.textContent).toContain("briar");
    expect(listRemoteDirectory).toHaveBeenCalledWith("ssh:ssh-1", undefined);

    const briarFolder = Array.from(
      container.querySelectorAll<HTMLButtonElement>(
        ".project-remote-folders > li > button",
      ),
    ).find((button) => button.textContent?.includes("briar"));
    await act(async () => {
      briarFolder?.click();
      await flush();
    });

    expect(container.textContent).toContain("Git 저장소를 연결할 수 있습니다.");
    const connect = container.querySelector<HTMLButtonElement>(
      ".project-remote-connect",
    );
    expect(connect?.disabled).toBe(false);
    await act(async () => {
      connect?.click();
      await flush();
    });

    expect(updateProjectExecutionConnection).toHaveBeenCalledWith({
      projectId: "project-1",
      executionHostId: "ssh:ssh-1",
      repositoryPath: "/Users/dev/briar",
    });
    expect(container.textContent).toContain(
      "이 프로젝트의 실행 위치를 원격 저장소로 변경했습니다.",
    );

    await act(async () => root.unmount());
    container.remove();
  });
});
