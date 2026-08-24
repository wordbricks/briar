import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaIssue from "effect/SchemaIssue";
import * as SchemaTransformation from "effect/SchemaTransformation";
import {
  autoHuntEvidenceTypeMaxLength,
  autoHuntEvidenceTypePattern,
  autoHuntRequirementKinds,
  normalizeAutoHuntWorkflow,
} from "../src/lib/auto-hunt-contract";
import { agentProviders } from "../src/lib/agent-provider";
import { IsoDateTimeWithOffset } from "../src/lib/date-time-schema";

const ignoreExcessProperties = {
  onExcessProperty: "ignore",
} as const;
const preserveExcessProperties = {
  onExcessProperty: "preserve",
} as const;
const rejectExcessProperties = {
  onExcessProperty: "error",
} as const;

const strip = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: ignoreExcessProperties });
const passthrough = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: preserveExcessProperties });
const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: rejectExcessProperties });

const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));
const defaulted = <S extends Schema.Constraint>(
  schema: S,
  value: S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.succeed(value))(schema);
const defaultedWith = <S extends Schema.Constraint>(
  schema: S,
  value: () => S["Type"],
): Schema.withDecodingDefaultType<S> =>
  Schema.withDecodingDefaultType<S>(Effect.sync(value))(schema);

export const WorkflowStageId = Schema.String.check(
  Schema.isPattern(/^[a-z][a-z0-9_-]{0,63}$/u),
);

export const EvidenceType = Schema.Trim.check(
  Schema.isLengthBetween(1, autoHuntEvidenceTypeMaxLength),
  Schema.isPattern(autoHuntEvidenceTypePattern),
);

const WorkflowRequirement = strict(Schema.Struct({
  id: Schema.mutableKey(WorkflowStageId),
  label: Schema.mutableKey(Schema.NonEmptyString),
  kind: Schema.mutableKey(Schema.Literals(autoHuntRequirementKinds)),
  tool: Schema.mutableKey(
    Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9_.+-]+$/u)),
  ),
  reason: Schema.mutableKey(Schema.NonEmptyString),
}));

const WorkflowStage = strip(Schema.Struct({
  id: Schema.mutableKey(WorkflowStageId),
  label: Schema.mutableKey(Schema.NonEmptyString),
  required: Schema.mutableKey(Schema.Boolean),
  evidence: Schema.mutableKey(
    Schema.optional(mutableArray(EvidenceType)),
  ),
  checks: Schema.mutableKey(
    Schema.optional(mutableArray(Schema.NonEmptyString)),
  ),
}));

const WorkflowCheckpoint = strict(Schema.Struct({
  key: Schema.mutableKey(WorkflowStageId),
  stage: Schema.mutableKey(WorkflowStageId),
  position: Schema.mutableKey(Schema.Literals(["before", "after"])),
}));

const WorkflowExecutionInput = strip(Schema.Struct({
  checkpoints: Schema.mutableKey(
    Schema.optional(
      mutableArray(WorkflowCheckpoint).check(Schema.isMaxLength(100)),
    ),
  ),
}));

const WorkflowCompletionInput = strip(Schema.Struct({
  requiredStages: Schema.mutableKey(mutableArray(WorkflowStageId)),
}));

const WorkflowConfigInput = strict(Schema.Struct({
  version: Schema.mutableKey(Schema.Literal(2)),
  requirements: Schema.mutableKey(
    Schema.optional(mutableArray(WorkflowRequirement)),
  ),
  stages: Schema.mutableKey(
    mutableArray(WorkflowStage).check(Schema.isMinLength(1)),
  ),
  execution: Schema.mutableKey(Schema.optional(WorkflowExecutionInput)),
  completion: Schema.mutableKey(Schema.optional(WorkflowCompletionInput)),
}));

const NormalizedWorkflowExecution = strip(Schema.Struct({
  checkpoints: Schema.mutableKey(mutableArray(WorkflowCheckpoint)),
}));

const NormalizedWorkflowCompletion = strip(Schema.Struct({
  requiredStages: Schema.mutableKey(mutableArray(WorkflowStageId)),
}));

const NormalizedWorkflowConfig = strict(Schema.Struct({
  version: Schema.mutableKey(Schema.Literal(2)),
  requirements: Schema.mutableKey(mutableArray(WorkflowRequirement)),
  stages: Schema.mutableKey(mutableArray(WorkflowStage)),
  execution: Schema.mutableKey(NormalizedWorkflowExecution),
  completion: Schema.mutableKey(NormalizedWorkflowCompletion),
}));

type WorkflowConfigInput = typeof WorkflowConfigInput.Type;
type NormalizedWorkflowConfig = typeof NormalizedWorkflowConfig.Type;

export const WorkflowConfig = WorkflowConfigInput.pipe(
  Schema.decodeTo(
    NormalizedWorkflowConfig,
    SchemaTransformation.transformOrFail<NormalizedWorkflowConfig, WorkflowConfigInput>({
      decode: (workflow, options) =>
        Effect.try({
          try: () => normalizeAutoHuntWorkflow(workflow),
          catch: (error) =>
            new SchemaIssue.InvalidValue(
              {
                message: error instanceof Error
                  ? error.message
                  : "Invalid issue processing workflow",
              },
              workflow,
              options,
            ),
        }),
      encode: (workflow) => Effect.succeed(workflow),
    }),
  ),
);

const WorktreeConfig = passthrough(Schema.Struct({
  enabled: Schema.mutableKey(Schema.optional(Schema.Boolean)),
  root: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
  branchPrefix: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
}));

const SandboxConfig = passthrough(Schema.Struct({
  /** False confines Auto Hunt writes to the assigned workspace. Defaults to true. */
  fullAccess: Schema.mutableKey(Schema.optional(Schema.Boolean)),
}));

const ClaimWorktree = strip(Schema.Struct({
  path: Schema.mutableKey(Schema.NonEmptyString),
  branch: Schema.mutableKey(Schema.NonEmptyString),
  baseRef: Schema.mutableKey(Schema.NonEmptyString),
  baseSha: Schema.mutableKey(Schema.NonEmptyString),
}));

const LinearConfig = passthrough(Schema.Struct({
  enabled: Schema.mutableKey(Schema.Boolean),
  source: Schema.mutableKey(
    Schema.optional(
      Schema.String.check(
        Schema.isPattern(/^linear:\/\/[A-Za-z0-9._-]+$/u),
      ),
    ),
  ),
  teamKey: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
}));

const AutoHuntConfig = passthrough(Schema.Struct({
  velenOrg: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
  dataSource: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
  worktrees: Schema.mutableKey(Schema.optional(WorktreeConfig)),
  sandbox: Schema.mutableKey(Schema.optional(SandboxConfig)),
  linear: Schema.mutableKey(Schema.optional(LinearConfig)),
  githubRepository: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
  workflow: Schema.mutableKey(Schema.optional(WorkflowConfig)),
}));

const Uuid = Schema.String.check(Schema.isUUID());
const ManagedComputerDeviceId = Schema.String.check(
  Schema.isPattern(/^managed-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u),
);
const WorkerDeviceId = Schema.Union([Uuid, ManagedComputerDeviceId]);
const UrlString = Schema.String.check(
  Schema.makeFilter((value) => URL.canParse(value) || "Expected a valid URL"),
);
const PositiveWorkerConcurrency = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(16),
);

const LlmConfig = passthrough(Schema.Struct({
  provider: Schema.mutableKey(Schema.Literals(agentProviders)),
}));

const ExecutionWorkerConfig = strip(Schema.Struct({
  deviceId: Schema.mutableKey(WorkerDeviceId),
  workerId: Schema.mutableKey(Schema.NonEmptyString),
  organizationId: Schema.mutableKey(Uuid),
  token: Schema.mutableKey(
    Schema.optional(Schema.String.check(Schema.isStartsWith("briar_worker_"))),
  ),
  label: Schema.mutableKey(
    Schema.String.check(Schema.isLengthBetween(1, 100)),
  ),
  maxConcurrentSessions: Schema.mutableKey(
    defaulted(PositiveWorkerConcurrency, 1),
  ),
}));

const ActiveClaim = strip(Schema.Struct({
  runId: Schema.mutableKey(Uuid),
  sourceKey: Schema.mutableKey(Schema.NonEmptyString),
  token: Schema.mutableKey(
    Schema.optional(
      Schema.String.check(Schema.isStartsWith("briar_claim_")),
    ),
  ),
  leaseExpiresAt: Schema.mutableKey(IsoDateTimeWithOffset),
  worktree: Schema.mutableKey(Schema.optional(ClaimWorktree)),
  finished: Schema.mutableKey(Schema.optional(Schema.Boolean)),
  terminalStatus: Schema.mutableKey(
    Schema.optional(
      Schema.Literals(["completed", "cancelled", "blocked", "failed"]),
    ),
  ),
  finishedAt: Schema.mutableKey(Schema.optional(IsoDateTimeWithOffset)),
}));

export const ProjectConfig = passthrough(Schema.Struct({
  id: Schema.mutableKey(Uuid),
  repositoryPath: Schema.mutableKey(Schema.String),
  agentToken: Schema.mutableKey(Schema.optional(Schema.String)),
  apiUrl: Schema.mutableKey(Schema.optional(UrlString)),
  repositoryRemote: Schema.mutableKey(Schema.optional(Schema.String)),
  llm: Schema.mutableKey(Schema.optional(LlmConfig)),
  autoHunt: Schema.mutableKey(Schema.optional(AutoHuntConfig)),
  executionWorker: Schema.mutableKey(
    Schema.optional(ExecutionWorkerConfig),
  ),
  activeClaim: Schema.mutableKey(Schema.optional(ActiveClaim)),
}));
export type ProjectConfig = typeof ProjectConfig.Type;

const ManagedComputerConfig = strip(Schema.Struct({
  managedComputerId: Schema.mutableKey(Uuid),
  deviceId: Schema.mutableKey(ManagedComputerDeviceId),
  organizationId: Schema.mutableKey(Uuid),
  credentialFile: Schema.mutableKey(Schema.String.check(
    Schema.makeFilter((value) =>
      value.startsWith("/") || "Managed computer credential path must be absolute"
    ),
  )),
}));

const AgentProviderSettings = strip(Schema.Struct({
  codex: Schema.mutableKey(defaulted(Schema.Boolean, true)),
  claude: Schema.mutableKey(defaulted(Schema.Boolean, true)),
  cursor: Schema.mutableKey(defaulted(Schema.Boolean, true)),
  grok: Schema.mutableKey(defaulted(Schema.Boolean, true)),
  agy: Schema.mutableKey(defaulted(Schema.Boolean, true)),
  opencode: Schema.mutableKey(defaulted(Schema.Boolean, true)),
  openrouter: Schema.mutableKey(defaulted(Schema.Boolean, true)),
}));

const defaultAgentProviderSettings = () => ({
  codex: true,
  claude: true,
  cursor: true,
  grok: true,
  agy: true,
  opencode: true,
  openrouter: true,
});

const AppSettings = passthrough(Schema.Struct({
  preventSleepWhileRunning: Schema.mutableKey(
    defaulted(Schema.Boolean, false),
  ),
  browserAutomationProvider: Schema.mutableKey(
    defaulted(
      Schema.Literals(["ego-browser", "agent-browser", "aside"]),
      "ego-browser",
    ),
  ),
}));

const defaultAppSettings = () => ({
  preventSleepWhileRunning: false,
  browserAutomationProvider: "ego-browser" as const,
});

export const Config = passthrough(Schema.Struct({
  apiUrl: Schema.mutableKey(UrlString),
  userToken: Schema.mutableKey(Schema.optional(Schema.String)),
  agentProviders: Schema.mutableKey(
    defaultedWith(AgentProviderSettings, defaultAgentProviderSettings),
  ),
  openrouterApiKey: Schema.mutableKey(
    Schema.optional(
      Schema.Trim.check(Schema.isLengthBetween(10, 500)),
    ),
  ),
  appSettings: Schema.mutableKey(
    defaultedWith(AppSettings, defaultAppSettings),
  ),
  workerDeviceIdentity: Schema.mutableKey(
    Schema.optional(
      Schema.String.check(
        Schema.isPattern(/^briar_device_[0-9a-f]{64}$/u),
      ),
    ),
  ),
  managedComputer: Schema.mutableKey(
    Schema.optional(ManagedComputerConfig),
  ),
  projects: Schema.mutableKey(
    defaultedWith(mutableArray(ProjectConfig), () => []),
  ),
}));
export type Config = typeof Config.Type;

export const decodeConfig = Schema.decodeUnknownSync(Config, {
  errors: "all",
});

const formatConfigIssue = SchemaIssue.makeFormatterStandardSchemaV1();

export function configErrorLocations(error: unknown): string[] {
  if (!Schema.isSchemaError(error)) return ["config"];
  return [
    ...new Set(
      formatConfigIssue(error.issue).issues.map((issue) =>
        issue.path && issue.path.length > 0
          ? issue.path.join(".")
          : "config"
      ),
    ),
  ].slice(0, 3);
}
