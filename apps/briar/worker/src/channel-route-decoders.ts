import {
  ChannelAgentActivityPublishInput,
} from "../../src/lib/channel-agent-activity";
import {
  channelExecutionProposalAcceptInputSchema,
  channelIssueBatchProposalPayloadSchema,
  channelIssueProposalPayloadSchema,
  channelMessageReactionInputSchema,
  channelProposalAcceptInputSchema,
  channelReadInputSchema,
  channelReplyClaimInputSchema,
  channelReplyLeaseInputSchema,
  channelReplySessionCheckpointInputSchema,
  directMessageInputSchema,
} from "../../src/lib/channels-contract";
import { decodeRequestSync } from "./request-schema";

export const decodeDirectMessageInput = decodeRequestSync(
  directMessageInputSchema,
);
export const decodeChannelReadInput = decodeRequestSync(channelReadInputSchema);
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
export const decodeChannelReplySessionCheckpointInput = decodeRequestSync(
  channelReplySessionCheckpointInputSchema,
);
export const decodeChannelAgentActivityPublishInput = decodeRequestSync(
  ChannelAgentActivityPublishInput,
);
