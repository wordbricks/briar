import { create } from "@bufbuild/protobuf";
import {
  PublishReplyActivityResponseSchema,
  ReplyActivityService,
  type PublishReplyActivityRequest,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import type { ConnectRouter, ServiceImpl } from "@connectrpc/connect";

import { isWorkerEmoji } from "../../src/lib/worker-icon-validation";
import { HttpError } from "./http-response";
import {
  publishReplyActivityApplication,
  ReplyActivityApplicationError,
  type ReplyActivityApplicationServices,
} from "./worker-reply-activity-application";
import {
  replyActivityInputFromProto,
  ReplyActivityMappingError,
} from "./worker-reply-activity-mappers";

export type WorkerConnectReplyActivityInput = {
  readonly request: Request;
  readonly env: Env;
  readonly db: D1Database;
};

const bearerCapability = (request: Request) => {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/iu.exec(authorization);
  if (!match) {
    throw new HttpError(401, "Reply activity capability is required");
  }
  return match[1];
};

const publishReplyActivity = async (
  input: WorkerConnectReplyActivityInput,
  request: PublishReplyActivityRequest,
  services: Partial<ReplyActivityApplicationServices>,
) => {
  const token = bearerCapability(input.request);
  let activity;
  try {
    if (request.acknowledgementReaction !== undefined) {
      const emoji = request.acknowledgementReaction;
      if (emoji.length > 32 || emoji !== emoji.trim() || !isWorkerEmoji(emoji) || request.activity) {
        throw new ReplyActivityMappingError("Invalid acknowledgement reaction");
      }
      activity = { sequence: 1, activity: null };
    } else {
      activity = replyActivityInputFromProto(request);
    }
  } catch (error) {
    if (error instanceof ReplyActivityMappingError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }

  try {
    await publishReplyActivityApplication({
      env: input.env,
      db: input.db,
      token,
      replyJobId: request.replyJobId,
      activity,
      acknowledgementReaction: request.acknowledgementReaction,
    }, services);
  } catch (error) {
    if (error instanceof ReplyActivityApplicationError) {
      throw new HttpError(401, error.message);
    }
    throw error;
  }

  return create(PublishReplyActivityResponseSchema);
};

export const createReplyActivityService = (
  input: WorkerConnectReplyActivityInput,
  services: Partial<ReplyActivityApplicationServices> = {},
): ServiceImpl<typeof ReplyActivityService> => ({
  publishReplyActivity: (request) => publishReplyActivity(input, request, services),
});

export const registerReplyActivityService = (
  router: ConnectRouter,
  input: WorkerConnectReplyActivityInput,
) => router.service(ReplyActivityService, createReplyActivityService(input));
