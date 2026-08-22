import { describe, expect, it } from "vitest";
import {
  buildCursorPromptParts,
  createCursorEventState,
  cursorPermissionDecisionResult,
  finalizeCursorMessage,
  normalizeCursorSessionUpdate,
  shouldAutoApproveCursorPermission,
  type CursorRunnerRequest,
} from "./cursor-runner-lib";

const request: CursorRunnerRequest = {
  type: "run",
  message: "Inspect the repository",
  workspaceRoot: "/repo",
  model: "gpt-5.4-medium-fast[reasoning=medium]",
  effort: "xhigh",
  approvalPolicy: "never",
  sandboxMode: "workspaceWrite",
  networkAccess: true,
  cursorBinary: "/usr/local/bin/cursor-agent",
};

describe("Cursor runner helpers", () => {
  it("preserves trusted instructions in the ACP prompt", async () => {
    expect(await buildCursorPromptParts({
      ...request,
      instructions: "Read the Briar workflow skill first.",
      outputSchema: { type: "object" },
    })).toEqual([
      {
        type: "text",
        text: 'Return only the JSON value that matches this schema, without Markdown fences or commentary:\n{"type":"object"}',
      },
      {
        type: "text",
        text: [
          "Follow these trusted Briar instructions:",
          "Read the Briar workflow skill first.",
          "User request:",
          "Inspect the repository",
        ].join("\n\n"),
      },
    ]);
  });

  it("uses one-turn permission responses", () => {
    const options = [
      { optionId: "always", kind: "allow_always" },
      { optionId: "once", kind: "allow_once" },
      { optionId: "reject", kind: "reject_once" },
    ];
    expect(cursorPermissionDecisionResult(options, true)).toEqual({
      outcome: { outcome: "selected", optionId: "once" },
    });
    expect(cursorPermissionDecisionResult(options, false)).toEqual({
      outcome: { outcome: "selected", optionId: "reject" },
    });
    expect(shouldAutoApproveCursorPermission(request)).toBe(true);
  });

  it("normalizes standard ACP Cursor updates", () => {
    const state = createCursorEventState();
    expect(normalizeCursorSessionUpdate({
      sessionId: "cursor-session",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Done" },
      },
    }, state).events).toEqual([{
      type: "messageStarted",
      id: "cursor-session:assistant:1",
      phase: "commentary",
      text: "Done",
    }]);
    expect(finalizeCursorMessage(state, "end_turn")).toEqual([
      {
        type: "messageCompleted",
        id: "cursor-session:assistant:1",
        phase: "final",
        text: "Done",
      },
      { type: "turnCompleted", status: "completed" },
    ]);
  });
});
