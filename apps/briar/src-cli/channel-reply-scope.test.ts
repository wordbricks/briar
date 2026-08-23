import { describe, expect, it } from "vitest";
import { assertChannelReplyWorkspaceScope } from "./channel-reply-scope";

describe("channel reply workspace scope", () => {
  it("rejects a Project Agent claim before a different repository can open", () => {
    expect(() =>
      assertChannelReplyWorkspaceScope(
        {
          projectId: "33333333-3333-4333-8333-333333333333",
          scope: {
            kind: "project",
            organizationId: "11111111-1111-4111-8111-111111111111",
            projectId: "33333333-3333-4333-8333-333333333333",
          },
        },
        "22222222-2222-4222-8222-222222222222",
      )
    ).toThrow("does not match local worker project");
  });

  it("allows an Organization Agent to run without opening a repository", () => {
    expect(() =>
      assertChannelReplyWorkspaceScope(
        {
          projectId: null,
          scope: {
            kind: "organization",
            organizationId: "11111111-1111-4111-8111-111111111111",
          },
        },
        "22222222-2222-4222-8222-222222222222",
      )
    ).not.toThrow();
  });
});
