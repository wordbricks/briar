/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Workspace, Project } from "../types";
import {
  readActiveWorkspaceId,
  resolveActiveAccountSelection,
  writeActiveWorkspaceId,
} from "./active-workspace";

const workspaces: Workspace[] = [
  {
    id: "workspace-1",
    name: "First",
    handle: "first",
    logo: null,
    role: "owner",
    createdAt: "2026-07-25T00:00:00.000Z",
  },
  {
    id: "workspace-2",
    name: "Second",
    handle: "second",
    logo: null,
    role: "developer",
    createdAt: "2026-07-25T00:00:00.000Z",
  },
];

const projects: Project[] = [
  {
    id: "project-1",
    name: "First project",
    issueKeyPrefix: "FP",
    scheduleTabEnabled: true,
    icon: null,
    iconName: null,
    iconColor: null,
    workspaceId: "workspace-1",
    workspaceName: "First",
    role: "owner",
    createdAt: "2026-07-25T00:00:00.000Z",
  },
  {
    id: "project-2",
    name: "Second project",
    issueKeyPrefix: "SP",
    scheduleTabEnabled: true,
    icon: null,
    iconName: null,
    iconColor: null,
    workspaceId: "workspace-2",
    workspaceName: "Second",
    role: "developer",
    createdAt: "2026-07-25T00:00:00.000Z",
  },
];

describe("active workspace persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores the selected workspace and its first project", () => {
    writeActiveWorkspaceId("user-1", "workspace-2");

    expect(
      resolveActiveAccountSelection("user-1", workspaces, projects),
    ).toEqual({
      activeWorkspaceId: "workspace-2",
      activeProjectId: "project-2",
    });
  });

  it("stores selections independently for each user", () => {
    writeActiveWorkspaceId("user-1", "workspace-1");
    writeActiveWorkspaceId("user-2", "workspace-2");

    expect(readActiveWorkspaceId("user-1")).toBe("workspace-1");
    expect(readActiveWorkspaceId("user-2")).toBe("workspace-2");
  });

  it("falls back when the stored workspace is no longer accessible", () => {
    writeActiveWorkspaceId("user-1", "removed-workspace");

    expect(
      resolveActiveAccountSelection("user-1", workspaces, projects),
    ).toEqual({
      activeWorkspaceId: "workspace-1",
      activeProjectId: "project-1",
    });
  });

  it("restores an workspace without selecting another workspace's project", () => {
    writeActiveWorkspaceId("user-1", "workspace-2");

    expect(
      resolveActiveAccountSelection("user-1", workspaces, [projects[0]]),
    ).toEqual({
      activeWorkspaceId: "workspace-2",
      activeProjectId: null,
    });
  });

  it("locks a project window to its requested project regardless of stored selection", () => {
    writeActiveWorkspaceId("user-1", "workspace-1");

    expect(
      resolveActiveAccountSelection(
        "user-1",
        workspaces,
        projects,
        "project-2",
      ),
    ).toEqual({
      activeWorkspaceId: "workspace-2",
      activeProjectId: "project-2",
    });
  });

  it("does not fall through to another project when a locked project is unavailable", () => {
    expect(
      resolveActiveAccountSelection(
        "user-1",
        workspaces,
        projects,
        "removed-project",
      ),
    ).toEqual({ activeWorkspaceId: null, activeProjectId: null });
  });

  it("keeps working when local storage is unavailable", () => {
    const getItem = vi
      .spyOn(window.localStorage, "getItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });
    const setItem = vi
      .spyOn(window.localStorage, "setItem")
      .mockImplementation(() => {
        throw new Error("storage unavailable");
      });

    expect(() =>
      writeActiveWorkspaceId("user-1", "workspace-2"),
    ).not.toThrow();
    expect(readActiveWorkspaceId("user-1")).toBeNull();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
