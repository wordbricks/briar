import {
  parseDetachedIssueReplyResult,
  parseDetachedJsonResult,
  type DetachedIssueReplyResult,
} from "./agent-runner";
import {
  collectReplyAttachments,
  decodeReplyAttachmentPaths,
} from "./reply-attachments";

export type ParsedIssueReplyAgentResult = {
  result: DetachedIssueReplyResult;
  attachmentPaths: string[];
};

export function parseIssueReplyAgentResult(
  text: string,
  options: { allowSkillExecutionProposal?: boolean } = {},
): ParsedIssueReplyAgentResult {
  let parsed: unknown;
  try {
    parsed = parseDetachedJsonResult(text);
  } catch {
    return {
      result: parseDetachedIssueReplyResult(text, options),
      attachmentPaths: [],
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      result: parseDetachedIssueReplyResult(text, options),
      attachmentPaths: [],
    };
  }
  const record = parsed as Record<string, unknown>;
  const attachmentPaths = decodeReplyAttachmentPaths(record.attachments ?? []);
  const { attachments: _attachments, ...result } = record;
  return {
    result: parseDetachedIssueReplyResult(JSON.stringify(result), options),
    attachmentPaths,
  };
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
