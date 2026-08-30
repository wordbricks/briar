import * as Schema from "effect/Schema";
import {
  defaulted,
  strictSchema,
  trimmedText,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";
import { WorkerUpdateHandoffWorkType } from "./worker-update-model";

const WorkerUpdateCheckpoint = strictSchema(Schema.Struct({
  conversationId: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(512))),
  ),
  workspacePath: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(2_000))),
  ),
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

export const decodeWorkerUpdateHandoff = decodeRequestSync(
  WorkerUpdateHandoff,
);
