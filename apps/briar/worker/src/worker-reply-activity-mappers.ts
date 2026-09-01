import type {
  PublishReplyActivityRequest,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import {
  agentActivityKindFromProto,
  ChannelAgentActivityPublishInput,
  type ChannelAgentActivityPublishInput as ReplyActivityInput,
} from "../../src/lib/channel-agent-activity";
import { decodeRequestSync } from "./request-schema";

const maximumPublishSequence = BigInt(Number.MAX_SAFE_INTEGER - 1);
const decodeReplyActivityInput = decodeRequestSync(
  ChannelAgentActivityPublishInput,
);

export class ReplyActivityMappingError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ReplyActivityMappingError";
  }
}

export const replyActivityInputFromProto = (
  request: PublishReplyActivityRequest,
): ReplyActivityInput => {
  if (request.sequence < 1n || request.sequence > maximumPublishSequence) {
    throw new ReplyActivityMappingError(
      "Reply activity sequence is outside the publishable range",
    );
  }

  let activity: ReplyActivityInput["activity"] = null;
  if (request.activity !== undefined) {
    try {
      activity = {
        id: request.activity.id,
        kind: agentActivityKindFromProto(request.activity.kind),
        headline: request.activity.headline,
      };
    } catch (cause) {
      throw new ReplyActivityMappingError(
        "Reply activity kind is invalid",
        { cause },
      );
    }
  }

  return decodeReplyActivityInput({
    sequence: Number(request.sequence),
    activity,
  });
};
