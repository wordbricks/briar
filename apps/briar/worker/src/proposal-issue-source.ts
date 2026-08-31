const channelProposalIssueSourcePrefix = "briar-channel-approved:";
const channelBatchProposalIssueSourcePrefix =
  "briar-channel-batch-approved:";
const conversationProposalIssueSourcePrefix =
  "briar-conversation-approved:";

const randomProposalSourceSuffix = () =>
  `${crypto.randomUUID().replaceAll("-", "")}${
    crypto.randomUUID().replaceAll("-", "")
  }`;

export const newChannelProposalIssueSourceKey = () =>
  `${channelProposalIssueSourcePrefix}${randomProposalSourceSuffix()}`;

export const newChannelBatchProposalIssueSourceKey = () =>
  `${channelBatchProposalIssueSourcePrefix}${randomProposalSourceSuffix()}`;

export const newConversationProposalIssueSourceKey = () =>
  `${conversationProposalIssueSourcePrefix}${randomProposalSourceSuffix()}`;

export const isReservedProposalIssueSourceKey = (sourceKey: string) =>
  sourceKey.startsWith(channelProposalIssueSourcePrefix) ||
  sourceKey.startsWith(channelBatchProposalIssueSourcePrefix) ||
  sourceKey.startsWith(conversationProposalIssueSourcePrefix);
