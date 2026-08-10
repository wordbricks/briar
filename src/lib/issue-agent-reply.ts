import type { OrganizationMember } from "../types";
import { mentionAtCaret as issueMentionAtCaret } from "./mention-token";

export { mentionsBriar } from "./briar-mention";
export { issueMentionAtCaret };

export {
  agentReplyParentMessageId,
  shouldBriarReply,
  type IssueReplyContextMessage,
} from "./issue-reply-decision";

export function issueMentionHandle(
  member: Pick<OrganizationMember, "email" | "userId">,
) {
  const localPart = member.email.split("@")[0]?.toLowerCase() ?? "";
  const normalized = localPart
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
    .replace(/^[._-]+|[._-]+$/gu, "");
  return (
    normalized ||
    member.userId.toLowerCase().replace(/[^a-z0-9_-]+/gu, "-")
  );
}

export function mentionsIssueHandle(body: string, handle: string) {
  const escaped = handle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  return new RegExp(
    `(^|[^\\p{L}\\p{N}_.-])@${escaped}(?=$|[^\\p{L}\\p{N}_.-])`,
    "iu",
  ).test(body);
}
