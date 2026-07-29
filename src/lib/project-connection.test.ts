import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectLocalProject,
  inspectRepositoryReadiness,
  inspectVelen,
} from "./project-connection";
import { repositoryWorkflowBootstrap } from "./auto-hunt-contract";
import { briarApiUrl } from "./api";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

describe("local project connection", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    invoke.mockReset();
    invoke.mockResolvedValue({});
  });

  it("inspects and connects the selected local repository", async () => {
    await inspectRepositoryReadiness(
      "/home/dev/briar",
      repositoryWorkflowBootstrap,
    );
    expect(invoke).toHaveBeenCalledWith("inspect_repository_readiness", {
      repositoryPath: "/home/dev/briar",
      workflow: repositoryWorkflowBootstrap,
    });

    await connectLocalProject({
      projectId: "project-1",
      agentToken: "token",
      repositoryPath: "/home/dev/briar",
      autoHunt: {
        velenOrg: "wordbricks",
        linearEnabled: false,
        workflow: repositoryWorkflowBootstrap,
      },
    });
    expect(invoke).toHaveBeenLastCalledWith("connect_local_project", {
      apiUrl: briarApiUrl,
      projectId: "project-1",
      agentToken: "token",
      repositoryPath: "/home/dev/briar",
      autoHunt: expect.objectContaining({ velenOrg: "wordbricks" }),
    });
  });

  it("inspects Velen on the local machine", async () => {
    invoke.mockResolvedValueOnce({ authenticated: true });
    await inspectVelen("wordbricks");
    expect(invoke).toHaveBeenCalledWith("inspect_velen", {
      org: "wordbricks",
    });
  });
});
