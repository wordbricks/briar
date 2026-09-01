import { createClient } from "@connectrpc/connect";
import {
  MergeQueueService,
} from "@briar/contracts/gen/briar/app/v1/merge_queue_pb";
import { requiredMessage } from "./mappers";
import { appCallOptions, appTransport } from "./core";
import {
  mergeQueueProfileFromProto,
  mergeQueueQuietWindowToProto,
  mergeQueueStatusFromProto,
} from "./merge-queue-mappers";

const mergeQueueClient = appTransport
  ? createClient(MergeQueueService, appTransport)
  : undefined;

const requireMergeQueueClient = () => {
  if (!mergeQueueClient) {
    throw new Error("Briar API URL이 설정되지 않았습니다.");
  }
  return mergeQueueClient;
};

export async function loadMergeQueueProfile(
  token: string,
  projectId: string,
) {
  const response = await requireMergeQueueClient().getMergeQueueProfile(
    { projectId },
    appCallOptions(token),
  );
  return {
    profile: response.profile
      ? mergeQueueProfileFromProto(response.profile)
      : null,
  };
}

export async function updateMergeQueueProfile(
  token: string,
  projectId: string,
  input: {
    enabled: boolean;
    readinessStageId: string;
    quietWindowMs?: number;
    maxBatchSize?: number;
  },
) {
  const response = await requireMergeQueueClient().updateMergeQueueProfile(
    {
      projectId,
      enabled: input.enabled,
      readinessStageId: input.readinessStageId || undefined,
      quietWindow: input.quietWindowMs === undefined
        ? undefined
        : mergeQueueQuietWindowToProto(input.quietWindowMs),
      maxBatchSize: input.maxBatchSize,
    },
    appCallOptions(token),
  );
  return {
    profile: mergeQueueProfileFromProto(requiredMessage(
      response.profile,
      "updateMergeQueueProfile.profile",
    )),
  };
}

export async function loadMergeQueueStatus(
  token: string,
  projectId: string,
) {
  return mergeQueueStatusFromProto(
    await requireMergeQueueClient().getMergeQueueStatus(
      { projectId },
      appCallOptions(token),
    ),
  );
}
