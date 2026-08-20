import * as Schema from "effect/Schema";
import {
  AgentProviderCapabilityCatalog,
  ModelEffort,
} from "../../src/lib/agent-provider-contract";
import {
  agentProviders,
  type AgentProvider,
} from "../../src/lib/agent-provider";
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

export const ClaimInput = strictSchema(Schema.Struct({
  claimedBy: trimmedText(1, 128),
  workerId: Schema.optional(trimmedText(1, 128)),
  projectId: Schema.optional(UuidString),
  runId: Schema.optional(UuidString),
}));

export const WorkerClaimInput = strictSchema(Schema.Struct({
  claimedBy: trimmedText(1, 128),
  workerId: trimmedText(1, 128),
  projectId: UuidString,
  repliesOnly: defaulted(Schema.Boolean, false),
}));

export const IssueReplyClaimInput = strictSchema(Schema.Struct({
  claimedBy: trimmedText(1, 128),
  workerId: trimmedText(1, 128),
  projectId: UuidString,
}));

const MergeGroupClaimToken = Schema.String.check(
  Schema.isStartsWith("briar_merge_group_claim_"),
);
const GitObjectSha = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{40}$/u),
);
const MergeGroupClaimFence = {
  projectId: UuidString,
  workerId: trimmedText(1, 128),
  claimToken: MergeGroupClaimToken,
  headSha: GitObjectSha,
};

export const MergeGroupLeaseInput = strictSchema(Schema.Struct({
  projectId: UuidString,
  workerId: trimmedText(1, 128),
  claimToken: MergeGroupClaimToken,
}));
export const MergeGroupValidationInput = strictSchema(Schema.Struct({
  ...MergeGroupClaimFence,
  passed: Schema.Boolean,
  detail: Schema.optional(Schema.NullOr(trimmedText(1, 4_000))),
}));
export const MergeGroupPublicationInput = strictSchema(Schema.Struct({
  ...MergeGroupClaimFence,
}));
export const MergeGroupReleaseInput = strictSchema(Schema.Struct({
  projectId: UuidString,
  workerId: trimmedText(1, 128),
  claimToken: MergeGroupClaimToken,
  reason: Schema.Literals(["planned_update", "infra_error"]),
  detail: Schema.optional(Schema.NullOr(trimmedText(1, 4_000))),
}));
export const MergeGroupSupersedeInput = strictSchema(Schema.Struct({
  projectId: UuidString,
  workerId: trimmedText(1, 128),
  claimToken: MergeGroupClaimToken,
  detail: trimmedText(1, 4_000),
}));
export const MergeGroupCiProfileInput = strictSchema(Schema.Struct({
  enabled: Schema.Boolean,
  baseRef: Schema.Literal("refs/heads/main"),
  workerId: Schema.NullOr(UuidString),
}));

const ProviderHealth = strictSchema(Schema.Struct({
  installed: Schema.Boolean,
  authenticated: Schema.Boolean,
  healthy: Schema.Boolean,
  reason: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(64))),
  ),
  usageExhausted: Schema.optional(Schema.Boolean),
  maxUsedPercent: Schema.optional(Schema.NullOr(
    Schema.Finite.check(
      Schema.isGreaterThanOrEqualTo(0),
      Schema.isLessThanOrEqualTo(100),
    ),
  )),
}));

const ProviderHealthFields = {
  codex: ProviderHealth,
  claude: ProviderHealth,
  cursor: ProviderHealth,
  grok: ProviderHealth,
  agy: ProviderHealth,
  opencode: ProviderHealth,
  openrouter: ProviderHealth,
} satisfies Record<AgentProvider, typeof ProviderHealth>;

const ProviderHealthMap = strictSchema(Schema.Struct(ProviderHealthFields));

const Versions = Schema.Record(
  Schema.String,
  Schema.String.check(Schema.isMaxLength(64)),
).check(
  Schema.makeFilter((versions) =>
    Object.keys(versions)
      .filter((key) => key.length > 64)
      .map((key) => ({
        path: [key],
        issue: "Version keys must contain at most 64 characters",
      }))
  ),
);

const WorkerRegistrationFields = {
  label: trimmedText(1, 100),
  deviceIdentity: Schema.String.check(
    Schema.isPattern(/^briar_device_[0-9a-f]{64}$/u),
  ),
  agentProvider: Schema.Literals(agentProviders),
  providers: Schema.optional(
    mutableArray(Schema.Literals(agentProviders)).check(
      Schema.isMaxLength(agentProviders.length),
    ),
  ),
  providerHealth: Schema.optional(ProviderHealthMap),
  providerCapabilities: Schema.optional(AgentProviderCapabilityCatalog),
  maxConcurrentSessions: Schema.optional(
    integerBetween(1, MAX_WORKER_CONCURRENT_SESSIONS),
  ),
  versions: defaulted(Versions, {}),
} as const;

export const WorkerRegister = strictSchema(Schema.Struct(
  WorkerRegistrationFields,
));

export const WorkerBind = strictSchema(Schema.Struct({
  deviceIdentity: WorkerRegistrationFields.deviceIdentity,
  agentProvider: WorkerRegistrationFields.agentProvider,
  providers: WorkerRegistrationFields.providers,
  providerHealth: WorkerRegistrationFields.providerHealth,
  providerCapabilities: WorkerRegistrationFields.providerCapabilities,
  versions: WorkerRegistrationFields.versions,
}));

export const WorkerConcurrency = strictSchema(Schema.Struct({
  maxConcurrentSessions: integerBetween(1, MAX_WORKER_CONCURRENT_SESSIONS),
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

const WorkerHeartbeatCapabilities = Schema.StructWithRest(
  Schema.Struct({
    providerCapabilities: Schema.optional(AgentProviderCapabilityCatalog),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
);

export const WorkerHeartbeat = strictSchema(Schema.Struct({
  versions: Schema.optional(Versions),
  acceptingWork: Schema.optional(Schema.Boolean),
  readinessState: Schema.optional(
    Schema.Literals(["ready", "busy", "needs_attention"]),
  ),
  readinessDetail: Schema.optional(
    Schema.NullOr(Schema.Trim.check(Schema.isMaxLength(500))),
  ),
  capabilities: Schema.optional(WorkerHeartbeatCapabilities),
}));

export const WorkerLabel = strictSchema(Schema.Struct({
  label: trimmedText(1, 100),
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

export const decodeClaimInput = decodeRequestSync(ClaimInput);
export const decodeWorkerClaimInput = decodeRequestSync(WorkerClaimInput);
export const decodeIssueReplyClaimInput = decodeRequestSync(
  IssueReplyClaimInput,
);
export const decodeMergeGroupLeaseInput = decodeRequestSync(
  MergeGroupLeaseInput,
);
export const decodeMergeGroupValidationInput = decodeRequestSync(
  MergeGroupValidationInput,
);
export const decodeMergeGroupPublicationInput = decodeRequestSync(
  MergeGroupPublicationInput,
);
export const decodeMergeGroupReleaseInput = decodeRequestSync(
  MergeGroupReleaseInput,
);
export const decodeMergeGroupSupersedeInput = decodeRequestSync(
  MergeGroupSupersedeInput,
);
export const decodeMergeGroupCiProfileInput = decodeRequestSync(
  MergeGroupCiProfileInput,
);
export const decodeWorkerRegister = decodeRequestSync(WorkerRegister);
export const decodeWorkerBind = decodeRequestSync(WorkerBind);
export const decodeWorkerConcurrency = decodeRequestSync(WorkerConcurrency);
export const decodeWorkerSettings = decodeRequestSync(WorkerSettings);
export const decodeExecutionWorkerPolicy = decodeRequestSync(
  ExecutionWorkerPolicy,
);
export const decodeWorkerHeartbeat = decodeRequestSync(WorkerHeartbeat);
export const decodeWorkerLabel = decodeRequestSync(WorkerLabel);
export const decodeDispatchRun = decodeRequestSync(DispatchRun);
export const decodeLeaseRenew = decodeRequestSync(LeaseRenew);
export const decodeProjectAgentScheduleRunRenew = decodeRequestSync(
  ProjectAgentScheduleRunRenew,
);
export const decodeProjectAgentScheduleRunCompletion = decodeRequestSync(
  ProjectAgentScheduleRunCompletion,
);
