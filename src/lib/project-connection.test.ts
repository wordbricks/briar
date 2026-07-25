import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  addSshHost,
  connectLocalProject,
  inspectRepositoryReadiness,
  inspectVelen,
  listExecutionHosts,
} from "./project-connection";
import { defaultAutoHuntWorkflow } from "./auto-hunt-contract";
import { briarApiUrl } from "./api";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("remote project connection", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invoke.mockReset();
    invoke.mockResolvedValue({});
  });

  it("passes the selected SSH host to repository inspection and connection", async () => {
    await inspectRepositoryReadiness(
      "/home/dev/briar",
      defaultAutoHuntWorkflow,
      "ssh:ssh-1",
    );
    expect(invoke).toHaveBeenCalledWith("inspect_repository_readiness", {
      repositoryPath: "/home/dev/briar",
      workflow: defaultAutoHuntWorkflow,
      executionHostId: "ssh:ssh-1",
    });

    await connectLocalProject({
      projectId: "project-1",
      agentToken: "token",
      repositoryPath: "/home/dev/briar",
      executionHostId: "ssh:ssh-1",
      autoHunt: {
        velenOrg: "wordbricks",
        linearEnabled: false,
        workflow: defaultAutoHuntWorkflow,
      },
    });
    expect(invoke).toHaveBeenLastCalledWith("connect_local_project", {
      apiUrl: briarApiUrl,
      projectId: "project-1",
      agentToken: "token",
      repositoryPath: "/home/dev/briar",
      executionHostId: "ssh:ssh-1",
      autoHunt: expect.objectContaining({ velenOrg: "wordbricks" }),
    });
  });

  it("uses native host management and host-scoped Velen inspection", async () => {
    invoke
      .mockResolvedValueOnce([{ id: "local", label: "이 컴퓨터", kind: "local" }])
      .mockResolvedValueOnce({
        id: "ssh:ssh-1",
        label: "build-box",
        kind: "ssh",
      })
      .mockResolvedValueOnce({ authenticated: true });

    await listExecutionHosts();
    await addSshHost("build-box", "빌드 호스트");
    await inspectVelen("wordbricks", "ssh:ssh-1");

    expect(invoke).toHaveBeenNthCalledWith(1, "list_execution_hosts");
    expect(invoke).toHaveBeenNthCalledWith(2, "add_ssh_host", {
      alias: "build-box",
      label: "빌드 호스트",
    });
    expect(invoke).toHaveBeenNthCalledWith(3, "inspect_velen", {
      org: "wordbricks",
      executionHostId: "ssh:ssh-1",
    });
  });
});
