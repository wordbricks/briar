import type { ParsedIssueAgentReply } from "../src/lib/agent-reply-contract";
import {
  collectReplyAttachments,
} from "./reply-attachments";

export function parseIssueReplyAgentResult(
  text: string,
  decodeJson: (text: string) => ParsedIssueAgentReply,
  options: { allowSkillExecutionProposal?: boolean } = {},
): ParsedIssueAgentReply {
  const parsed = decodeJson(text);
  if (
    parsed.result.skillExecutionProposal &&
    !options.allowSkillExecutionProposal
  ) {
    throw new Error("Agent Skill execution target is not authorized");
  }
  return parsed;
}

export function collectIssueReplyAttachments(input: {
  workspacePath: string;
  paths: readonly string[];
}) {
  return collectReplyAttachments({
    ...input,
    replyLabel: "Issue reply",
  });
}
