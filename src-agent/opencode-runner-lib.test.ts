import { describe, expect, it } from "vitest";

import {
  buildOpenCodePermissionRules,
  buildOpenCodePrompt,
  createOpenCodeEventState,
  mapEffortToOpenCode,
  normalizeOpenCodeEvent,
  parseOpenCodeModel,
  parseOpenCodeServerUrl,
  shouldAutoApproveOpenCodePermission,
  type OpenCodeRunnerRequest,
} from "./opencode-runner-lib";

const request = (overrides: Partial<OpenCodeRunnerRequest> = {}): OpenCodeRunnerRequest => ({
  type: "run",
  message: "Fix the tests",
  workspaceRoot: "/repo",
  approvalPolicy: "on-request",
  sandboxMode: "workspaceWrite",
  networkAccess: false,
  opencodeBinary: "/bin/opencode",
  ...overrides,
});

describe("OpenCode runner helpers", () => {
  it("parses the server URL and provider-qualified models", () => {
    expect(
      parseOpenCodeServerUrl("opencode server listening on http://127.0.0.1:4321\n"),
    ).toBe("http://127.0.0.1:4321");
    expect(parseOpenCodeModel("anthropic/claude-sonnet-4-5")).toEqual({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-5",
    });
    expect(parseOpenCodeModel("sonnet")).toBeUndefined();
  });

  it("maps unsupported high effort aliases to OpenCode's high variant", () => {
    expect(mapEffortToOpenCode("ultra")).toBe("high");
    expect(mapEffortToOpenCode("medium")).toBe("medium");
  });

  it("combines instructions, schemas, and the user prompt", () => {
    expect(
      buildOpenCodePrompt(
        request({ instructions: "Be concise", outputSchema: { type: "object" } }),
      ),
    ).toContain("Additional instructions for this turn:\nBe concise");
    expect(buildOpenCodePrompt(request({ outputSchema: { type: "object" } }))).toContain(
      '"type":"object"',
    );
  });

  it("auto-approves never policy but preserves read-only write denial", () => {
    expect(
      shouldAutoApproveOpenCodePermission(
        request({ approvalPolicy: "never" }),
        "edit",
      ),
    ).toBe(true);
    expect(
      shouldAutoApproveOpenCodePermission(
        request({ approvalPolicy: "never", sandboxMode: "readOnly" }),
        "edit",
      ),
    ).toBe(false);
    expect(
      buildOpenCodePermissionRules(request({ sandboxMode: "readOnly" })),
    ).toContainEqual({ permission: "edit", pattern: "*", action: "deny" });
    expect(
      shouldAutoApproveOpenCodePermission(
        request({ approvalPolicy: "never" }),
        "external_directory",
      ),
    ).toBe(false);
    expect(
      buildOpenCodePermissionRules(request({ approvalPolicy: "never" })),
    ).toContainEqual({
      permission: "webfetch",
      pattern: "*",
      action: "deny",
    });
  });

  it("normalizes assistant part updates without replaying snapshots", () => {
    const state = createOpenCodeEventState();
    normalizeOpenCodeEvent(
      {
        type: "message.updated",
        properties: { sessionID: "ses_1", info: { id: "msg_1", role: "assistant" } },
      },
      "ses_1",
      state,
    );
    const part = (text: string) => ({
      id: "part_1",
      sessionID: "ses_1",
      messageID: "msg_1",
      type: "text" as const,
      text,
    });
    expect(
      normalizeOpenCodeEvent(
        { type: "message.part.updated", properties: { sessionID: "ses_1", part: part("Hi") } },
        "ses_1",
        state,
      ),
    ).toMatchObject({ type: "messageStarted", text: "Hi" });
    expect(
      normalizeOpenCodeEvent(
        {
          type: "message.part.updated",
          properties: { sessionID: "ses_1", part: part("Hi there") },
        },
        "ses_1",
        state,
      ),
    ).toEqual({ type: "messageDelta", id: "part_1", delta: " there" });
  });
});
