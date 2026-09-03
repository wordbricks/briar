/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Organization, Project } from "../types";
import {
  readActiveOrganizationId,
  resolveActiveAccountSelection,
  writeActiveOrganizationId,
} from "./active-organization";

const organizations: Organization[] = [
  {
    id: "organization-1",
    name: "First",
    handle: "first",
    logo: null,
    role: "owner",
    createdAt: "2026-07-25T00:00:00.000Z",
  },
  {
    id: "organization-2",
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
    organizationId: "organization-1",
    organizationName: "First",
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
    organizationId: "organization-2",
    organizationName: "Second",
    role: "developer",
    createdAt: "2026-07-25T00:00:00.000Z",
  },
];

describe("active organization persistence", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("restores the selected organization and its first project", () => {
    writeActiveOrganizationId("user-1", "organization-2");

    expect(
      resolveActiveAccountSelection("user-1", organizations, projects),
    ).toEqual({
      activeOrganizationId: "organization-2",
      activeProjectId: "project-2",
    });
  });

  it("stores selections independently for each user", () => {
    writeActiveOrganizationId("user-1", "organization-1");
    writeActiveOrganizationId("user-2", "organization-2");

    expect(readActiveOrganizationId("user-1")).toBe("organization-1");
    expect(readActiveOrganizationId("user-2")).toBe("organization-2");
  });

  it("falls back when the stored organization is no longer accessible", () => {
    writeActiveOrganizationId("user-1", "removed-organization");

    expect(
      resolveActiveAccountSelection("user-1", organizations, projects),
    ).toEqual({
      activeOrganizationId: "organization-1",
      activeProjectId: "project-1",
    });
  });

  it("restores an organization without selecting another organization's project", () => {
    writeActiveOrganizationId("user-1", "organization-2");

    expect(
      resolveActiveAccountSelection("user-1", organizations, [projects[0]]),
    ).toEqual({
      activeOrganizationId: "organization-2",
      activeProjectId: null,
    });
  });

  it("locks a project window to its requested project regardless of stored selection", () => {
    writeActiveOrganizationId("user-1", "organization-1");

    expect(
      resolveActiveAccountSelection(
        "user-1",
        organizations,
        projects,
        "project-2",
      ),
    ).toEqual({
      activeOrganizationId: "organization-2",
      activeProjectId: "project-2",
    });
  });

  it("does not fall through to another project when a locked project is unavailable", () => {
    expect(
      resolveActiveAccountSelection(
        "user-1",
        organizations,
        projects,
        "removed-project",
      ),
    ).toEqual({ activeOrganizationId: null, activeProjectId: null });
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
      writeActiveOrganizationId("user-1", "organization-2"),
    ).not.toThrow();
    expect(readActiveOrganizationId("user-1")).toBeNull();

    getItem.mockRestore();
    setItem.mockRestore();
  });
});
