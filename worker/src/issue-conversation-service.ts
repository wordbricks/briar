import { listArchivedIssueMessages } from "./archive";
import {
  listIssueActionProposals,
  listIssueAgentReplyJobs,
  listIssueAgentSkillExecutionProposals,
  listIssueAttachments,
  listIssueExecutionProposals,
  listIssueMessages,
  listIssueReworkProposals,
} from "./db";
import {
  issueAgentReplyJson,
  issueMessageJson,
} from "./issue-conversation-json";

export async function listIssueMessagesWithArchive(
  db: D1Database,
  archivesBucket: R2Bucket,
  projectId: string,
  runId: string,
) {
  const [hot, archived] = await Promise.all([
    listIssueMessages(db, projectId, runId),
    listArchivedIssueMessages(db, archivesBucket, projectId, runId),
  ]);
  return [
    ...new Map(
      [...archived, ...hot].map((message) => [message.id, message]),
    ).values(),
  ].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id),
  );
}

export async function loadIssueConversationSnapshot(
  db: D1Database,
  archivesBucket: R2Bucket,
  projectId: string,
  runId: string,
) {
  const [
    messages,
    attachments,
    reworkProposals,
    actionProposals,
    executionProposals,
    skillExecutionProposals,
    agentReplies,
  ] = await Promise.all([
    listIssueMessagesWithArchive(db, archivesBucket, projectId, runId),
    listIssueAttachments(db, projectId, runId),
    listIssueReworkProposals(db, projectId, runId),
    listIssueActionProposals(db, projectId, runId),
    listIssueExecutionProposals(db, projectId, runId),
    listIssueAgentSkillExecutionProposals(db, projectId, runId),
    listIssueAgentReplyJobs(db, projectId, runId),
  ]);
  const proposalsByReply = new Map(
    [...reworkProposals, ...actionProposals].map((proposal) => [
      proposal.reply_message_id,
      proposal,
    ]),
  );
  return {
    messages: messages.map((message) =>
      issueMessageJson(
        message,
        attachments,
        proposalsByReply.get(message.id) ?? null,
        executionProposals.find(
          (proposal) => proposal.reply_message_id === message.id,
        ) ?? null,
        skillExecutionProposals.find(
          (proposal) => proposal.reply_message_id === message.id,
        ) ?? null,
      )
    ),
    agentReplies: agentReplies.map(issueAgentReplyJson),
  };
}
