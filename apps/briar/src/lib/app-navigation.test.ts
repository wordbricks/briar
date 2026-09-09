import { describe, expect, it } from "vitest";
import {
  channelIdFromNavigationLocation,
  channelNavigationLocation,
  channelPageNavigationLocation,
  issueNavigationLocation,
  organizationNavigationLocation,
  workspaceIdFromNavigationLocation,
  pageFromNavigationLocation,
  projectIdFromNavigationLocation,
  projectNavigationLocation,
  runIdFromNavigationLocation,
  settingsNavigationLocation,
  settingsTargetFromNavigationLocation,
} from "./app-navigation";

describe("app navigation locations", () => {
  it("keeps top-level pages unchanged", () => {
    expect(pageFromNavigationLocation("inbox")).toBe("inbox");
    expect(runIdFromNavigationLocation("inbox")).toBeNull();
    expect(channelIdFromNavigationLocation("inbox")).toBeNull();
  });

  it("stores and restores an issue with its project context", () => {
    const location = issueNavigationLocation(
      "project/with spaces",
      "run/with special:value",
    );

    expect(location).toBe(
      "issues/project%2Fwith%20spaces/run%2Fwith%20special%3Avalue",
    );
    expect(pageFromNavigationLocation(location)).toBe("issues");
    expect(projectIdFromNavigationLocation(location)).toBe(
      "project/with spaces",
    );
    expect(runIdFromNavigationLocation(location)).toBe(
      "run/with special:value",
    );
  });

  it.each(["lobby", "projects", "issues", "agents", "schedule"] as const)(
    "stores and restores the %s page with its project context",
    (page) => {
      const location = projectNavigationLocation(
        page,
        "project/with spaces",
      );

      expect(location).toBe(`projects/project%2Fwith%20spaces/${page}`);
      expect(pageFromNavigationLocation(location)).toBe(page);
      expect(projectIdFromNavigationLocation(location)).toBe(
        "project/with spaces",
      );
    },
  );

  it.each(["channels", "dms"] as const)(
    "stores and restores a %s conversation with its workspace context",
    (page) => {
      const location = channelNavigationLocation(
        page,
        "workspace/one",
        "channel/with spaces",
      );

      expect(location).toBe(
        `${page}/workspace%2Fone/channel%2Fwith%20spaces`,
      );
      expect(pageFromNavigationLocation(location)).toBe(page);
      expect(workspaceIdFromNavigationLocation(location)).toBe(
        "workspace/one",
      );
      expect(channelIdFromNavigationLocation(location)).toBe(
        "channel/with spaces",
      );
    },
  );

  it("retains the active project while visiting a workspace channel", () => {
    const location = channelNavigationLocation(
      "channels",
      "workspace",
      "channel",
      "project/one",
    );

    expect(location).toBe(
      "channels/workspace/channel/project%2Fone",
    );
    expect(projectIdFromNavigationLocation(location)).toBe("project/one");
    expect(workspaceIdFromNavigationLocation(location)).toBe(
      "workspace",
    );
    expect(channelIdFromNavigationLocation(location)).toBe("channel");
  });

  it("stores an empty conversation page without losing its context", () => {
    const location = channelPageNavigationLocation(
      "dms",
      "workspace/one",
      "project/one",
    );

    expect(location).toBe(
      "channel-pages/dms/workspace%2Fone/project%2Fone",
    );
    expect(pageFromNavigationLocation(location)).toBe("dms");
    expect(workspaceIdFromNavigationLocation(location)).toBe(
      "workspace/one",
    );
    expect(projectIdFromNavigationLocation(location)).toBe("project/one");
    expect(channelIdFromNavigationLocation(location)).toBeNull();
  });

  it("stores Inbox with its workspace context", () => {
    const location = organizationNavigationLocation("workspace/one");

    expect(location).toBe("workspaces/workspace%2Fone/inbox");
    expect(pageFromNavigationLocation(location)).toBe("inbox");
    expect(workspaceIdFromNavigationLocation(location)).toBe(
      "workspace/one",
    );
  });

  it("stores My issues with its workspace context", () => {
    const location = organizationNavigationLocation(
      "workspace/one",
      "my-issues",
    );

    expect(location).toBe("workspaces/workspace%2Fone/my-issues");
    expect(pageFromNavigationLocation(location)).toBe("my-issues");
    expect(workspaceIdFromNavigationLocation(location)).toBe(
      "workspace/one",
    );
  });

  it("rejects the removed workspace-scoped Projects location", () => {
    const location = "workspaces/workspace%2Fone/projects" as never;

    expect(pageFromNavigationLocation(location)).toBe("lobby");
    expect(workspaceIdFromNavigationLocation(location)).toBeNull();
    expect(projectIdFromNavigationLocation(location)).toBeNull();
  });

  it.each([
    { scope: "application", section: "keybindings" },
    {
      scope: "workspace",
      workspaceId: "workspace/one",
      section: "agents",
    },
    {
      scope: "project",
      projectId: "project/one",
      section: "workflow",
    },
  ] as const)("stores a $scope settings target", (target) => {
    const location = settingsNavigationLocation(target);

    expect(pageFromNavigationLocation(location)).toBe("settings");
    expect(settingsTargetFromNavigationLocation(location)).toEqual(target);
    expect(projectIdFromNavigationLocation(location)).toBe(
      target.scope === "project" ? target.projectId : null,
    );
    expect(workspaceIdFromNavigationLocation(location)).toBe(
      target.scope === "workspace" ? target.workspaceId : null,
    );
  });

  it("does not expose an invalid encoded issue id", () => {
    expect(
      runIdFromNavigationLocation("issues/project/%E0%A4%A"),
    ).toBeNull();
    expect(
      projectIdFromNavigationLocation("issues/%E0%A4%A/run"),
    ).toBeNull();
    expect(
      pageFromNavigationLocation("issues/%E0%A4%A/run"),
    ).toBe("lobby");
  });

  it("does not expose incomplete scoped locations", () => {
    expect(
      channelIdFromNavigationLocation(
        "channels/workspace" as never,
      ),
    ).toBeNull();
    expect(
      runIdFromNavigationLocation("issues/project" as never),
    ).toBeNull();
    expect(
      pageFromNavigationLocation("issues/project/run/extra" as never),
    ).toBe("lobby");
  });

  it("rejects a scoped location atomically when any segment is invalid", () => {
    const invalidWorkspace =
      "channels/%E0%A4%A/channel/project" as never;

    expect(pageFromNavigationLocation(invalidWorkspace)).toBe("lobby");
    expect(workspaceIdFromNavigationLocation(invalidWorkspace)).toBeNull();
    expect(channelIdFromNavigationLocation(invalidWorkspace)).toBeNull();
    expect(projectIdFromNavigationLocation(invalidWorkspace)).toBeNull();

    const invalidSettings =
      "settings/project/%E0%A4%A/general" as never;
    expect(pageFromNavigationLocation(invalidSettings)).toBe("lobby");
    expect(settingsTargetFromNavigationLocation(invalidSettings)).toBeNull();
    expect(projectIdFromNavigationLocation(invalidSettings)).toBeNull();
  });

  it("rejects empty destination identifiers at construction", () => {
    expect(() => issueNavigationLocation("", "run")).toThrow();
    expect(() => issueNavigationLocation("project", "")).toThrow();
    expect(() =>
      channelNavigationLocation("channels", "", "channel"),
    ).toThrow();
    expect(() =>
      channelNavigationLocation("dms", "workspace", ""),
    ).toThrow();
    expect(() =>
      channelNavigationLocation("dms", "workspace", "channel", ""),
    ).toThrow();
    expect(() => projectNavigationLocation("issues", "")).toThrow();
    expect(() => channelPageNavigationLocation("channels", "")).toThrow();
    expect(() =>
      channelPageNavigationLocation("channels", "workspace", ""),
    ).toThrow();
    expect(() => organizationNavigationLocation("")).toThrow();
    expect(() =>
      settingsNavigationLocation({
        scope: "workspace",
        workspaceId: "",
        section: "general",
      }),
    ).toThrow();
  });

  it("keeps issue and conversation parsers isolated", () => {
    const issue = issueNavigationLocation("project", "run");
    const channel = channelNavigationLocation(
      "channels",
      "workspace",
      "channel",
    );

    expect(channelIdFromNavigationLocation(issue)).toBeNull();
    expect(workspaceIdFromNavigationLocation(issue)).toBeNull();
    expect(runIdFromNavigationLocation(channel)).toBeNull();
    expect(projectIdFromNavigationLocation(channel)).toBeNull();
  });
});
