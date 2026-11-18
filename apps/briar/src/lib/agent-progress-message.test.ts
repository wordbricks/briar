import { describe, expect, it } from "vitest";
import {
  AGENT_PROGRESS_HEADLINE_MAX_LENGTH,
  agentProgressMessage,
} from "./agent-progress-message";

describe("Agent progress message contract", () => {
  it("reads a progress message, plain or fenced, and trims the headline", () => {
    expect(agentProgressMessage('{"progress":"  확인하겠습니다  "}')).toEqual({
      headline: "확인하겠습니다",
    });
    expect(
      agentProgressMessage('```json\n{"progress":"reading the runner"}\n```'),
    ).toEqual({ headline: "reading the runner" });
  });

  it("clamps an overrun instead of dropping the update", () => {
    /*
      Rejecting a long headline would hide it from the typing strip and let a
      runner adopt it as the turn's final answer — the two failures this type
      exists to prevent.
    */
    expect(
      agentProgressMessage(
        JSON.stringify({
          progress: "a".repeat(AGENT_PROGRESS_HEADLINE_MAX_LENGTH + 40),
        }),
      ),
    ).toEqual({
      headline: "a".repeat(AGENT_PROGRESS_HEADLINE_MAX_LENGTH),
    });
  });

  it("rejects an excess member, a missing headline, and an empty headline", () => {
    expect(agentProgressMessage('{"progress":"x","body":"y"}')).toBeNull();
    expect(agentProgressMessage('{"body":"final answer"}')).toBeNull();
    expect(agentProgressMessage('{"progress":"   "}')).toBeNull();
    expect(agentProgressMessage('{"progress":42}')).toBeNull();
  });

  it("never reads a reply envelope or prose as a progress message", () => {
    expect(agentProgressMessage(JSON.stringify({
      acknowledgementReaction: null,
      body: "현재 랜딩 구조를 확인해서 계획을 정리하겠습니다",
      attachments: [],
    }))).toBeNull();
    expect(agentProgressMessage("Reading the runner now.")).toBeNull();
    expect(agentProgressMessage('진행 상황: {"progress":"확인"} 입니다')).toBeNull();
  });

  it("returns null instead of throwing on malformed JSON", () => {
    expect(agentProgressMessage('{"progress":"unterminated')).toBeNull();
    expect(agentProgressMessage("{")).toBeNull();
    expect(agentProgressMessage("[]")).toBeNull();
    expect(agentProgressMessage("null")).toBeNull();
    expect(agentProgressMessage("")).toBeNull();
  });
});
