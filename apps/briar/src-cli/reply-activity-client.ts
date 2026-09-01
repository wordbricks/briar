import { create } from "@bufbuild/protobuf";
import {
  AgentActivitySchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import {
  PublishReplyActivityRequestSchema,
  ReplyActivityService,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import {
  agentActivityKindToProto,
  type ChannelAgentActivityPublishInput,
} from "../src/lib/channel-agent-activity";

export function createReplyActivityClient(apiUrl: string) {
  const client = createClient(
    ReplyActivityService,
    createConnectTransport({
      baseUrl: apiUrl.replace(/\/+$/u, ""),
      useBinaryFormat: true,
    }),
  );

  return {
    publishReplyActivity: (input: {
      replyJobId: string;
      capability: string;
      activity: ChannelAgentActivityPublishInput;
      signal?: AbortSignal;
    }) => client.publishReplyActivity(
      create(PublishReplyActivityRequestSchema, {
        replyJobId: input.replyJobId,
        sequence: BigInt(input.activity.sequence),
        activity: input.activity.activity === null
          ? undefined
          : create(AgentActivitySchema, {
              id: input.activity.activity.id,
              kind: agentActivityKindToProto(input.activity.activity.kind),
              headline: input.activity.activity.headline,
            }),
      }),
      {
        headers: { Authorization: `Bearer ${input.capability}` },
        signal: input.signal,
      },
    ),
  };
}
