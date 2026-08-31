import {
  channelExecutionProposalAcceptInputSchema,
  channelMessageReactionInputSchema,
  channelProposalAcceptInputSchema,
  channelReadInputSchema,
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
export const decodeChannelExecutionProposalAcceptInput = decodeRequestSync(
  channelExecutionProposalAcceptInputSchema,
);
