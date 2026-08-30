import * as Schema from "effect/Schema";
import { ModelEffort } from "../../src/lib/agent-provider-contract";
import { agentProviders } from "../../src/lib/agent-provider";
import { StructuredAgentResult } from "../../src/lib/agent-result";
import {
  isWorkerEmoji,
  isWorkerLogoDataUrl,
  maxWorkerEmojiLength,
  maxWorkerLogoDataUrlLength,
} from "../../src/lib/worker-icon-validation";
import { MAX_WORKER_CONCURRENT_SESSIONS } from "./worker-limits";
import {
  defaulted,
  integerBetween,
  mutableArray,
  strictSchema,
  trimmedText,
  UuidString,
} from "./schema-codecs";
import { decodeRequestSync } from "./request-schema";

export const WorkerClaimInput = strictSchema(Schema.Struct({
  claimedBy: trimmedText(1, 128),
  workerId: trimmedText(1, 128),
  projectId: UuidString,
}));

export const IssueReplyClaimInput = strictSchema(Schema.Struct({
  claimedBy: trimmedText(1, 128),
  workerId: trimmedText(1, 128),
  projectId: UuidString,
}));

const WorkerIcon = Schema.Union([
  strictSchema(Schema.Struct({
    type: Schema.Literal("emoji"),
    value: Schema.Trim.check(
      Schema.isLengthBetween(1, maxWorkerEmojiLength),
      Schema.makeFilter((value) =>
        isWorkerEmoji(value) || "Worker emoji must be one emoji"
      ),
    ),
  })),
  strictSchema(Schema.Struct({
    type: Schema.Literal("image"),
    value: Schema.String.check(
      Schema.isMaxLength(maxWorkerLogoDataUrlLength),
      Schema.makeFilter((value) =>
        isWorkerLogoDataUrl(value) ||
        "Worker image must be a supported data URL"
      ),
    ),
  })),
]);

export const WorkerSettings = strictSchema(Schema.Struct({
  maxConcurrentSessions: Schema.optional(
    integerBetween(1, MAX_WORKER_CONCURRENT_SESSIONS),
  ),
  icon: Schema.optional(Schema.NullOr(WorkerIcon)),
}).check(
  Schema.makeFilter((input) =>
    input.maxConcurrentSessions !== undefined || input.icon !== undefined
      ? undefined
      : "At least one Worker setting is required"
  ),
));

export const ExecutionWorkerPolicy = strictSchema(Schema.Struct({
  selectionMode: Schema.Literals(["any", "allowlist"]),
  defaultWorkerId: Schema.NullOr(trimmedText(1, 128)),
  allowedWorkerIds: defaulted(
    mutableArray(trimmedText(1, 128)).check(Schema.isMaxLength(100)),
    [],
  ),
}));

export const DispatchRun = strictSchema(Schema.Struct({
  agentId: Schema.optional(Schema.NullOr(UuidString)),
  provider: Schema.optional(Schema.Literals(agentProviders)),
  model: Schema.optional(Schema.NullOr(trimmedText(1, 100))),
  effort: Schema.optional(Schema.NullOr(ModelEffort)),
  persistPreferences: Schema.optional(Schema.Boolean),
  workerId: Schema.optional(Schema.NullOr(trimmedText(1, 128))),
  requestId: UuidString,
}).check(
  Schema.makeFilter((input) => {
    const provider = input.provider ?? null;
    const model = input.model ?? null;
    const effort = input.effort ?? null;
    const issues: Array<Schema.FilterIssue> = [];
    if (!provider && (model || effort)) {
      issues.push({
        path: [],
        issue: "A provider is required for a model or effort preference",
      });
    }
    if (!model && effort) {
      issues.push({
        path: [],
        issue: "A model is required for an effort preference",
      });
    }
    return issues.length > 0 ? issues : undefined;
  }),
));

export const LeaseRenew = strictSchema(Schema.Struct({
  claimToken: trimmedText(1, 200),
  projectId: Schema.optional(UuidString),
}));

export const ProjectAgentScheduleClaimToken = Schema.Trim.check(
  Schema.isPattern(/^briar_schedule_claim_[0-9a-f]{64}$/u),
);

export const ProjectAgentScheduleRunRenew = strictSchema(Schema.Struct({
  claimToken: ProjectAgentScheduleClaimToken,
}));

export const ProjectAgentScheduleRunCompletion = strictSchema(Schema.Struct({
  claimToken: ProjectAgentScheduleClaimToken,
  status: Schema.Literals(["completed", "failed"]),
  resultSummary: Schema.optional(Schema.NullOr(trimmedText(1, 100_000))),
  structuredResult: StructuredAgentResult,
  error: Schema.optional(Schema.NullOr(trimmedText(1, 4_000))),
}).check(
  Schema.makeFilter((input) => {
    const issues: Array<Schema.FilterIssue> = [];
    if (input.status === "completed" && !input.resultSummary) {
      issues.push({
        path: ["resultSummary"],
        issue: "completed runs require a result summary",
      });
    }
    if (
      input.resultSummary &&
      input.resultSummary !== input.structuredResult.summary
    ) {
      issues.push({
        path: ["resultSummary"],
        issue: "resultSummary must match structuredResult.summary",
      });
    }
    if (
      input.status === "completed" &&
      input.structuredResult.outcome === "failed"
    ) {
      issues.push({
        path: ["structuredResult", "outcome"],
        issue: "completed schedule runs cannot report a failed outcome",
      });
    }
    if (
      input.status === "failed" &&
      input.structuredResult.outcome !== "failed"
    ) {
      issues.push({
        path: ["structuredResult", "outcome"],
        issue: "failed schedule runs require a failed structured outcome",
      });
    }
    if (input.status === "failed" && !input.error) {
      issues.push({
        path: ["error"],
        issue: "failed runs require an error",
      });
    }
    return issues.length > 0 ? issues : undefined;
  }),
));

export const decodeWorkerClaimInput = decodeRequestSync(WorkerClaimInput);
export const decodeIssueReplyClaimInput = decodeRequestSync(
  IssueReplyClaimInput,
);
export const decodeWorkerSettings = decodeRequestSync(WorkerSettings);
export const decodeExecutionWorkerPolicy = decodeRequestSync(
  ExecutionWorkerPolicy,
);
export const decodeDispatchRun = decodeRequestSync(DispatchRun);
export const decodeLeaseRenew = decodeRequestSync(LeaseRenew);
export const decodeProjectAgentScheduleRunRenew = decodeRequestSync(
  ProjectAgentScheduleRunRenew,
);
export const decodeProjectAgentScheduleRunCompletion = decodeRequestSync(
  ProjectAgentScheduleRunCompletion,
);
