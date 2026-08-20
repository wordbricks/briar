import * as Schema from "effect/Schema";
import { isSemanticVersion } from "../../src/lib/semantic-version";
import {
  defaulted,
  strictSchema,
  trimmedText,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

export const WorkerUpdateHandoffWorkType = Schema.Literals([
  "issue",
  "projectAgentTask",
  "issueReply",
  "channelReply",
]);

const SemanticVersion = Schema.Trim.check(
  Schema.makeFilter((value) =>
    isSemanticVersion(value) || "Semantic version required"
  ),
);

const WorkerUpdateCheckpoint = strictSchema(Schema.Struct({
  conversationId: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(512))),
  ),
  workspacePath: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(2_000))),
  ),
}));

const WorkerUpdatePrepare = strictSchema(Schema.Struct({
  targetVersion: SemanticVersion,
}));

const WorkerUpdateHandoff = strictSchema(Schema.Struct({
  requestId: UuidString,
  projectId: UuidString,
  workType: WorkerUpdateHandoffWorkType,
  workId: UuidString,
  runId: Schema.optional(Schema.NullOr(UuidString)),
  claimToken: trimmedText(20, 256),
  checkpoint: defaulted(WorkerUpdateCheckpoint, {}),
}));

export const decodeWorkerUpdatePrepare = decodeRequestSync(
  WorkerUpdatePrepare,
);
export const decodeWorkerUpdateHandoff = decodeRequestSync(
  WorkerUpdateHandoff,
);
export const decodeWorkerUpdateRequestId = decodeRequestSync(UuidString);
