import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { channelReplyCompletionSchema } from "../src/lib/channels-contract";
import {
  collectReplyAttachments,
  decodeReplyAttachmentPaths,
  replyCompleteRequestBody,
} from "./reply-attachments";

const decodeChannelReplyCompletion = Schema.decodeUnknownSync(
  channelReplyCompletionSchema,
);

type ChannelReplyCompletion = typeof channelReplyCompletionSchema.Type;

export type ParsedChannelReplyAgentResult = {
  result: ChannelReplyCompletion;
  attachmentPaths: string[];
};

export function parseChannelReplyAgentResult(
  parsed: unknown,
): ParsedChannelReplyAgentResult {
  if (!Predicate.isObject(parsed)) {
    return {
      result: decodeChannelReplyCompletion(parsed),
      attachmentPaths: [],
    };
  }
  if (parsed.contextRequests !== null && parsed.contextRequests !== undefined) {
    throw new Error("A completed channel reply cannot request more context");
  }
  if (parsed.memoryRequests !== null && parsed.memoryRequests !== undefined) {
    throw new Error("A completed channel reply cannot request memory");
  }
  const attachmentPaths = decodeReplyAttachmentPaths(
    parsed.attachments ?? [],
  );
  const {
    attachments: _ignored,
    contextRequests: _contextRequests,
    memoryRequests: _memoryRequests,
    ...rest
  } = parsed;
  return {
    result: decodeChannelReplyCompletion(rest),
    attachmentPaths,
  };
}

export function channelReplyCompleteRequestBody(input: {
  organizationId: string;
  workerId: string;
  claimToken: string;
  conversationId?: string | null;
  result: ChannelReplyCompletion;
  attachments: readonly File[];
}) {
  return replyCompleteRequestBody({
    payload: {
      organizationId: input.organizationId,
      workerId: input.workerId,
      claimToken: input.claimToken,
      conversationId: input.conversationId ?? null,
      result: input.result,
    },
    attachments: input.attachments,
  });
}

/**
 * Read reply attachments before the disposable workspace is deleted. Paths stay
 * inside that workspace so a model cannot attach an arbitrary host file.
 */
export async function collectChannelReplyAttachments(input: {
  workspacePath: string;
  paths: readonly string[];
}): Promise<File[]> {
  return collectReplyAttachments({
    ...input,
    replyLabel: "Channel reply",
  });
}
