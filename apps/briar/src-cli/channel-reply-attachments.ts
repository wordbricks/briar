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

export function parseChannelReplyAgentResult(parsed: unknown): {
  result: ChannelReplyCompletion;
  attachmentPaths: string[];
} {
  if (!Predicate.isObject(parsed)) {
    return {
      result: decodeChannelReplyCompletion(parsed),
      attachmentPaths: [],
    };
  }
  if (parsed.contextRequests !== null && parsed.contextRequests !== undefined) {
    throw new Error("A completed channel reply cannot request more context");
  }
  const attachmentPaths = decodeReplyAttachmentPaths(
    parsed.attachments ?? [],
  );
  const {
    attachments: _ignored,
    contextRequests: _contextRequests,
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
  result: ChannelReplyCompletion;
  attachments: readonly File[];
}) {
  return replyCompleteRequestBody({
    payload: {
      organizationId: input.organizationId,
      workerId: input.workerId,
      claimToken: input.claimToken,
      result: input.result,
    },
    attachments: input.attachments,
  });
}

/**
 * Read reply images before the disposable workspace is deleted. Paths stay
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
