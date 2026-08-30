import { describe, expect, it } from "vitest";
import { decodeInboxReadVersions } from "./inbox-contract";
import { decodeOrganizationResponse } from "./organization-contract";
import { decodeProjectResponse } from "./project-contract";

const projectId = "22222222-2222-4222-8222-222222222222";

describe("API response contracts", () => {
  it("requires the shared project fields and strips response extensions", () => {
    const project = {
      id: projectId,
      name: "Briar",
      issueKeyPrefix: "BR",
      scheduleTabEnabled: true,
      icon: null,
      organizationId: "33333333-3333-4333-8333-333333333333",
      organizationName: "Wordbricks",
      role: "owner",
      createdAt: "2026-08-20T00:00:00.000Z",
      futureField: true,
    } as const;

    expect(decodeProjectResponse(project)).toEqual({
      id: projectId,
      name: "Briar",
      issueKeyPrefix: "BR",
      scheduleTabEnabled: true,
      icon: null,
      organizationId: "33333333-3333-4333-8333-333333333333",
      organizationName: "Wordbricks",
      role: "owner",
      createdAt: "2026-08-20T00:00:00.000Z",
    });
    expect(
      decodeProjectResponse({
        ...project,
        icon: "https://example.com/future-icon.png",
      }).icon,
    ).toBeNull();

    expect(() =>
      decodeProjectResponse({
        ...project,
        createdAt: "not-a-datetime",
      }),
    ).toThrow();
    const { icon: _icon, ...missingIcon } = project;
    expect(() => decodeProjectResponse(missingIcon)).toThrow();
    const { issueKeyPrefix: _issueKeyPrefix, ...missingIssueKeyPrefix } = project;
    expect(() => decodeProjectResponse(missingIssueKeyPrefix)).toThrow();
    const { scheduleTabEnabled: _scheduleTabEnabled, ...missingScheduleTabEnabled } = project;
    expect(() => decodeProjectResponse(missingScheduleTabEnabled)).toThrow();
  });

  it("keeps organization logo defaults and record key/value validation", () => {
    expect(
      decodeOrganizationResponse({
        id: "33333333-3333-4333-8333-333333333333",
        name: "Wordbricks",
        handle: "wordbricks",
        role: "owner",
        createdAt: "2026-08-20T00:00:00.000Z",
        ignored: "server-extension",
      }),
    ).not.toHaveProperty("ignored");
    expect(decodeInboxReadVersions({ issue: "v2" })).toEqual({ issue: "v2" });
    expect(() => decodeInboxReadVersions({ "": "v2" })).toThrow();
    expect(() => decodeInboxReadVersions({ issue: "" })).toThrow();
  });
});
