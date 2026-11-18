import type { QueuedAttachment } from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { ParsedChannelReplyAgentResult } from "../src/lib/channel-agent-reply-contract";
import {
  isIssueAttachmentStorableType,
  maxIssueAttachmentCount,
} from "../src/lib/issue-attachments";

type ChannelReplyResult = ParsedChannelReplyAgentResult["result"];

/**
 * Fills an issue proposal's `attachmentIds` from the messages this turn is
 * answering when the Agent named none.
 *
 * "Here is the file, make an issue about it" is the common shape, and a model
 * that describes the file in prose without listing its id produces an issue the
 * Worker cannot do the work from. The value still travels inside the approved
 * payload the card renders, so the member sees exactly which files the issue
 * will carry — this is a default applied before the proposal is sent, not a
 * server-side copy of files nobody approved.
 *
 * A batch is left alone deliberately. Which of up to eight issues a file
 * belongs to is a judgement only the Agent can make, and copying the same file
 * onto all of them would be a worse guess than copying it onto none.
 */
export function channelReplyIssueAttachmentDefaults(
  result: ChannelReplyResult,
  triggerAttachments: readonly QueuedAttachment[],
): ChannelReplyResult {
  if (!result.issueProposal) return result;
  if (result.issueProposal.issue.attachmentIds.length > 0) return result;
  const attachmentIds = triggerAttachments
    .filter((attachment) => isIssueAttachmentStorableType(attachment.contentType))
    .map((attachment) => attachment.id.toLowerCase())
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .slice(0, maxIssueAttachmentCount);
  if (attachmentIds.length === 0) return result;
  return {
    ...result,
    issueProposal: {
      ...result.issueProposal,
      issue: { ...result.issueProposal.issue, attachmentIds },
    },
  };
}
