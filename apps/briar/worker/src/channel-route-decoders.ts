import {
  ChannelAgentActivityPublishInput,
} from "../../src/lib/channel-agent-activity";
import {
  channelExecutionProposalAcceptInputSchema,
  channelIssueBatchProposalPayloadSchema,
  channelInputSchema,
  channelIssueProposalPayloadSchema,
  channelMemberInputSchema,
  channelMessageReactionInputSchema,
  channelProposalAcceptInputSchema,
  channelReadInputSchema,
  channelReplyClaimInputSchema,
  channelReplyLeaseInputSchema,
  channelUpdateInputSchema,
  channelWebhookInputSchema,
  directMessageInputSchema,
} from "../../src/lib/channels-contract";
import { decodeRequestSync } from "./request-schema";

export const decodeChannelInput = decodeRequestSync(channelInputSchema);
export const decodeDirectMessageInput = decodeRequestSync(
  directMessageInputSchema,
);
export const decodeChannelReadInput = decodeRequestSync(channelReadInputSchema);
export const decodeChannelUpdateInput = decodeRequestSync(
  channelUpdateInputSchema,
);
export const decodeChannelMemberInput = decodeRequestSync(
  channelMemberInputSchema,
);
export const decodeChannelWebhookInput = decodeRequestSync(
  channelWebhookInputSchema,
);
export const decodeChannelMessageReactionInput = decodeRequestSync(
  channelMessageReactionInputSchema,
);
export const decodeChannelProposalAcceptInput = decodeRequestSync(
  channelProposalAcceptInputSchema,
);
export const decodeChannelIssueProposalPayload = decodeRequestSync(
  channelIssueProposalPayloadSchema,
);
export const decodeChannelIssueBatchProposalPayload = decodeRequestSync(
  channelIssueBatchProposalPayloadSchema,
);
export const decodeChannelExecutionProposalAcceptInput = decodeRequestSync(
  channelExecutionProposalAcceptInputSchema,
);
export const decodeChannelReplyClaimInput = decodeRequestSync(
  channelReplyClaimInputSchema,
);
export const decodeChannelReplyLeaseInput = decodeRequestSync(
  channelReplyLeaseInputSchema,
);
export const decodeChannelAgentActivityPublishInput = decodeRequestSync(
  ChannelAgentActivityPublishInput,
);
