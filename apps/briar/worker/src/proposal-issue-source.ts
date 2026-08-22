const channelProposalIssueSourcePrefix = "briar-channel-approved:";
const legacyChannelProposalIssueSourcePrefix = "briar-channel-proposal:";
const conversationProposalIssueSourcePrefix =
  "briar-conversation-approved:";
const legacyConversationProposalIssueSourcePrefix =
  "briar-conversation-proposal:";

const randomProposalSourceSuffix = () =>
  `${crypto.randomUUID().replaceAll("-", "")}${
    crypto.randomUUID().replaceAll("-", "")
  }`;

export const newChannelProposalIssueSourceKey = () =>
  `${channelProposalIssueSourcePrefix}${randomProposalSourceSuffix()}`;

export const newConversationProposalIssueSourceKey = () =>
  `${conversationProposalIssueSourcePrefix}${randomProposalSourceSuffix()}`;

export const isReservedProposalIssueSourceKey = (sourceKey: string) =>
  sourceKey.startsWith(channelProposalIssueSourcePrefix) ||
  sourceKey.startsWith(legacyChannelProposalIssueSourcePrefix) ||
  sourceKey.startsWith(conversationProposalIssueSourcePrefix) ||
  sourceKey.startsWith(legacyConversationProposalIssueSourcePrefix);
