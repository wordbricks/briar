import {
  create,
  fromJson,
  fromJsonString,
  toJsonString,
  type JsonValue,
} from "@bufbuild/protobuf";
import {
  timestampDate,
  timestampFromDate,
  type Timestamp,
} from "@bufbuild/protobuf/wkt";
import {
  LocalApprovalPolicy,
  LocalBrowserAutomationProvider,
  LocalClaimTerminalStatus,
  LocalConfigSchema,
  type LocalActiveClaimConfig,
  type LocalAutoHuntConfig,
  type LocalConfig,
  type LocalProjectConfig,
  type LocalProjectLlmConfig,
} from "@briar/contracts/gen/briar/local/v1/config_pb";
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
import {
  agentProviderFromProto,
  agentProviderToProto,
  requiredMessage,
  safeNumber,
} from "../src/lib/app-rpc/mappers";
import {
  workflowFromProto,
  workflowToProto,
} from "../src/lib/app-rpc/team-configuration-mappers";
import {
  agentProviders,
  backfilledAddedProviders,
  effectiveEnabledProviders,
  normalizeAddedProviders,
  openCodeUpstreamOf,
  type AgentProvider,
} from "../src/lib/agent-provider";
import { IsoDateTimeWithOffset } from "../src/lib/date-time-schema";

const rejectExcessProperties = { onExcessProperty: "error" } as const;
const strict = <S extends Schema.Top>(schema: S) =>
  schema.annotate({ parseOptions: rejectExcessProperties });
const mutableArray = <S extends Schema.Top>(item: S) =>
  Schema.mutable(Schema.Array(item));

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
const WorkflowStage = strict(Schema.Struct({
  id: Schema.mutableKey(WorkflowStageId),
  label: Schema.mutableKey(Schema.NonEmptyString),
  required: Schema.mutableKey(Schema.Boolean),
  evidence: Schema.mutableKey(Schema.optional(mutableArray(EvidenceType))),
  checks: Schema.mutableKey(Schema.optional(mutableArray(Schema.NonEmptyString))),
}));
const WorkflowCheckpoint = strict(Schema.Struct({
  key: Schema.mutableKey(WorkflowStageId),
  stage: Schema.mutableKey(WorkflowStageId),
  position: Schema.mutableKey(Schema.Literals(["before", "after"])),
}));
const WorkflowExecutionInput = strict(Schema.Struct({
  checkpoints: Schema.mutableKey(
    mutableArray(WorkflowCheckpoint).check(Schema.isMaxLength(100)),
  ),
}));
const WorkflowCompletionInput = strict(Schema.Struct({
  requiredStages: Schema.mutableKey(mutableArray(WorkflowStageId)),
}));
const WorkflowConfigInput = strict(Schema.Struct({
  version: Schema.mutableKey(Schema.Literal(2)),
  requirements: Schema.mutableKey(mutableArray(WorkflowRequirement)),
  stages: Schema.mutableKey(
    mutableArray(WorkflowStage).check(Schema.isMinLength(1)),
  ),
  execution: Schema.mutableKey(WorkflowExecutionInput),
  completion: Schema.mutableKey(WorkflowCompletionInput),
}));
const NormalizedWorkflowExecution = strict(Schema.Struct({
  checkpoints: Schema.mutableKey(mutableArray(WorkflowCheckpoint)),
}));
const NormalizedWorkflowCompletion = strict(Schema.Struct({
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

const WorktreeConfig = strict(Schema.Struct({
  enabled: Schema.mutableKey(Schema.optional(Schema.Boolean)),
  root: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
  branchPrefix: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
}));
const SandboxConfig = strict(Schema.Struct({
  fullAccess: Schema.mutableKey(Schema.optional(Schema.Boolean)),
}));
const ClaimWorktree = strict(Schema.Struct({
  path: Schema.mutableKey(Schema.NonEmptyString),
  branch: Schema.mutableKey(Schema.NonEmptyString),
  baseRef: Schema.mutableKey(Schema.NonEmptyString),
  baseSha: Schema.mutableKey(Schema.NonEmptyString),
}));
const LinearConfig = strict(Schema.Struct({
  enabled: Schema.mutableKey(Schema.Boolean),
  source: Schema.mutableKey(
    Schema.optional(
      Schema.String.check(Schema.isPattern(/^linear:\/\/[A-Za-z0-9._-]+$/u)),
    ),
  ),
  teamKey: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
}));
const AutoHuntConfig = strict(Schema.Struct({
  velenOrg: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
  dataSource: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
  worktrees: Schema.mutableKey(Schema.optional(WorktreeConfig)),
  sandbox: Schema.mutableKey(Schema.optional(SandboxConfig)),
  linear: Schema.mutableKey(Schema.optional(LinearConfig)),
  githubRepository: Schema.mutableKey(Schema.optional(Schema.NonEmptyString)),
  githubRepositoryId: Schema.mutableKey(
    Schema.optional(Schema.Int.check(Schema.isGreaterThan(0))),
  ),
  workflow: Schema.mutableKey(Schema.optional(WorkflowConfig)),
}));

const Uuid = Schema.String.check(Schema.isUUID());
const ManagedComputerDeviceId = Schema.String.check(
  Schema.isPattern(
    /^managed-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
  ),
);
const WorkerDeviceId = Schema.Union([Uuid, ManagedComputerDeviceId]);
const UrlString = Schema.String.check(
  Schema.makeFilter((value) => URL.canParse(value) || "Expected a valid URL"),
);
const PositiveWorkerConcurrency = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(16),
);
const LlmConfig = strict(Schema.Struct({
  provider: Schema.mutableKey(Schema.Literals(agentProviders)),
  model: Schema.mutableKey(
    Schema.optional(
      Schema.String.check(
        Schema.isLengthBetween(1, 128),
        Schema.isPattern(/^\S+$/u),
      ),
    ),
  ),
  effort: Schema.mutableKey(
    Schema.optional(Schema.String.check(Schema.isLengthBetween(1, 64))),
  ),
  approvalPolicy: Schema.mutableKey(
    Schema.Literals(["untrusted", "on-request", "never"]),
  ),
}));
const ExecutionWorkerConfig = strict(Schema.Struct({
  deviceId: Schema.mutableKey(WorkerDeviceId),
  workerId: Schema.mutableKey(Schema.NonEmptyString),
  organizationId: Schema.mutableKey(Uuid),
  token: Schema.mutableKey(
    Schema.optional(Schema.String.check(Schema.isStartsWith("briar_worker_"))),
  ),
  label: Schema.mutableKey(
    Schema.String.check(Schema.isLengthBetween(1, 100)),
  ),
  maxConcurrentSessions: Schema.mutableKey(PositiveWorkerConcurrency),
}));
const ActiveClaim = strict(Schema.Struct({
  runId: Schema.mutableKey(Uuid),
  sourceKey: Schema.mutableKey(Schema.NonEmptyString),
  token: Schema.mutableKey(
    Schema.optional(Schema.String.check(Schema.isStartsWith("briar_claim_"))),
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

export const ProjectConfig = strict(Schema.Struct({
  id: Schema.mutableKey(Uuid),
  repositoryPath: Schema.mutableKey(Schema.NonEmptyString),
  agentToken: Schema.mutableKey(
    Schema.optional(Schema.String.check(Schema.isStartsWith("briar_agent_"))),
  ),
  apiUrl: Schema.mutableKey(UrlString),
  repositoryRemote: Schema.mutableKey(Schema.optional(Schema.String)),
  llm: Schema.mutableKey(Schema.optional(LlmConfig)),
  autoHunt: Schema.mutableKey(Schema.optional(AutoHuntConfig)),
  executionWorker: Schema.mutableKey(Schema.optional(ExecutionWorkerConfig)),
  activeClaim: Schema.mutableKey(Schema.optional(ActiveClaim)),
}));
export type ProjectConfig = typeof ProjectConfig.Type;

const ManagedComputerConfig = strict(Schema.Struct({
  managedComputerId: Schema.mutableKey(Uuid),
  deviceId: Schema.mutableKey(ManagedComputerDeviceId),
  organizationId: Schema.mutableKey(Uuid),
  credentialFile: Schema.mutableKey(
    Schema.String.check(
      Schema.makeFilter((value) =>
        value.startsWith("/") ||
        "Managed computer credential path must be absolute"
      ),
    ),
  ),
}));
const AgentProviderSettings = strict(Schema.Struct({
  codex: Schema.mutableKey(Schema.Boolean),
  claude: Schema.mutableKey(Schema.Boolean),
  cursor: Schema.mutableKey(Schema.Boolean),
  grok: Schema.mutableKey(Schema.Boolean),
  agy: Schema.mutableKey(Schema.Boolean),
  opencode: Schema.mutableKey(Schema.Boolean),
  openrouter: Schema.mutableKey(Schema.Boolean),
  vertex: Schema.mutableKey(Schema.Boolean),
  pi: Schema.mutableKey(Schema.Boolean),
}));

/**
 * Vertex AI is addressed by project and region. The secret is the machine's
 * Google Application Default Credentials, so nothing here is a credential and
 * both fields are safe to keep in the plain config.
 */
const VertexAiCredential = strict(Schema.Struct({
  projectId: Schema.mutableKey(
    Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/u)),
  ),
  location: Schema.mutableKey(
    Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,40}$/u)),
  ),
}));
const AppSettings = strict(Schema.Struct({
  preventSleepWhileRunning: Schema.mutableKey(Schema.Boolean),
  browserAutomationProvider: Schema.mutableKey(
    Schema.Literals(["ego-browser", "agent-browser", "aside"]),
  ),
}));

const projectHasExecutionCredential = (
  project: ProjectConfig,
  managedComputer: typeof ManagedComputerConfig.Type | undefined,
) => {
  if (project.agentToken || project.executionWorker?.token) return true;
  return Boolean(
    managedComputer && project.executionWorker &&
      project.executionWorker.deviceId === managedComputer.deviceId &&
      project.executionWorker.organizationId === managedComputer.organizationId,
  );
};

export const Config = strict(Schema.Struct({
  apiUrl: Schema.mutableKey(UrlString),
  userToken: Schema.mutableKey(Schema.optional(Schema.String)),
  agentProviders: Schema.mutableKey(AgentProviderSettings),
  /**
   * Providers this machine added on top of the built-in set.
   *
   * Optional here because a config written before the list existed has none,
   * and because in-memory configs are built without it. Every consumer reads
   * it through `addedAgentProviders`, which applies the backfill rule, so the
   * absent case is answered in exactly one place.
   */
  addedProviders: Schema.mutableKey(
    Schema.optional(mutableArray(Schema.Literals(agentProviders))),
  ),
  openrouterApiKey: Schema.mutableKey(
    Schema.optional(Schema.Trim.check(Schema.isLengthBetween(10, 500))),
  ),
  vertexAi: Schema.mutableKey(Schema.optional(VertexAiCredential)),
  appSettings: Schema.mutableKey(AppSettings),
  workerDeviceIdentity: Schema.mutableKey(
    Schema.optional(
      Schema.String.check(
        Schema.isPattern(/^briar_device_[0-9a-f]{64}$/u),
      ),
    ),
  ),
  managedComputer: Schema.mutableKey(Schema.optional(ManagedComputerConfig)),
  projects: Schema.mutableKey(mutableArray(ProjectConfig)),
})).check(
  Schema.makeFilter((config) =>
    config.projects.every((project) =>
      projectHasExecutionCredential(project, config.managedComputer)
    ) ||
    "Every project must have an agent token or an execution worker credential"
  ),
);
export type Config = typeof Config.Type;

const decodeDomainConfig = Schema.decodeUnknownSync(Config, { errors: "all" });

/**
 * Whether this config already holds the credential an upstream provider needs.
 * Only the backfill asks, and it asks so a machine that was already talking to
 * an upstream keeps it after the built-in/added split.
 */
const hasSavedUpstreamCredential = (
  config: Pick<Config, "openrouterApiKey" | "vertexAi">,
  provider: AgentProvider,
) => {
  const upstream = openCodeUpstreamOf(provider);
  if (!upstream) return false;
  switch (upstream.credential.type) {
    case "apiKey":
      return (config[upstream.credential.configField] ?? "").trim().length > 0;
    case "googleAdc":
      return config[upstream.credential.configField] !== undefined;
  }
};

/**
 * Providers this machine has added. A config written before the list existed
 * reports every non-built-in provider it was already enabled for or holds a
 * credential for, so existing installations see no change; the value is
 * persisted the next time the config is written.
 */
export const addedAgentProviders = (config: Config): AgentProvider[] =>
  config.addedProviders === undefined
    ? backfilledAddedProviders(
      config.agentProviders,
      (provider) => hasSavedUpstreamCredential(config, provider),
    )
    : normalizeAddedProviders(config.addedProviders);

/**
 * The enabled record the CLI and the Worker decide provider availability from.
 * A provider this machine has not added reads as disabled, so it is reported
 * and skipped exactly like one whose switch is off.
 */
export const enabledAgentProviders = (
  config: Config,
): Record<AgentProvider, boolean> =>
  effectiveEnabledProviders(config.agentProviders, addedAgentProviders(config));

const browserAutomationProviderFromProto = (
  value: LocalBrowserAutomationProvider | undefined,
): Config["appSettings"]["browserAutomationProvider"] => {
  switch (value) {
    case LocalBrowserAutomationProvider.EGO_BROWSER:
      return "ego-browser";
    case LocalBrowserAutomationProvider.AGENT_BROWSER:
      return "agent-browser";
    case LocalBrowserAutomationProvider.ASIDE:
      return "aside";
    case LocalBrowserAutomationProvider.UNSPECIFIED:
    case undefined:
      throw new Error("config.appSettings.browserAutomationProvider is missing");
    default:
      throw new Error(`Unknown browser automation provider: ${value}`);
  }
};
const browserAutomationProviderToProto = (
  value: Config["appSettings"]["browserAutomationProvider"],
) => {
  switch (value) {
    case "ego-browser":
      return LocalBrowserAutomationProvider.EGO_BROWSER;
    case "agent-browser":
      return LocalBrowserAutomationProvider.AGENT_BROWSER;
    case "aside":
      return LocalBrowserAutomationProvider.ASIDE;
  }
};
const approvalPolicyFromProto = (
  value: LocalApprovalPolicy | undefined,
): NonNullable<ProjectConfig["llm"]>["approvalPolicy"] => {
  switch (value) {
    case LocalApprovalPolicy.UNTRUSTED:
      return "untrusted";
    case LocalApprovalPolicy.ON_REQUEST:
      return "on-request";
    case LocalApprovalPolicy.NEVER:
      return "never";
    case LocalApprovalPolicy.UNSPECIFIED:
    case undefined:
      throw new Error("config.projects.llm.approvalPolicy is missing");
    default:
      throw new Error(`Unknown approval policy: ${value}`);
  }
};
const approvalPolicyToProto = (
  value: NonNullable<ProjectConfig["llm"]>["approvalPolicy"],
) => {
  switch (value) {
    case "untrusted":
      return LocalApprovalPolicy.UNTRUSTED;
    case "on-request":
      return LocalApprovalPolicy.ON_REQUEST;
    case "never":
      return LocalApprovalPolicy.NEVER;
  }
};
const terminalStatusFromProto = (
  value: LocalClaimTerminalStatus | undefined,
): NonNullable<ProjectConfig["activeClaim"]>["terminalStatus"] => {
  switch (value) {
    case LocalClaimTerminalStatus.COMPLETED:
      return "completed";
    case LocalClaimTerminalStatus.CANCELLED:
      return "cancelled";
    case LocalClaimTerminalStatus.BLOCKED:
      return "blocked";
    case LocalClaimTerminalStatus.FAILED:
      return "failed";
    case undefined:
      return undefined;
    case LocalClaimTerminalStatus.UNSPECIFIED:
      throw new Error("config.projects.activeClaim.terminalStatus is unspecified");
    default:
      throw new Error(`Unknown claim terminal status: ${value}`);
  }
};
const terminalStatusToProto = (
  value: NonNullable<ProjectConfig["activeClaim"]>["terminalStatus"],
) => {
  switch (value) {
    case "completed":
      return LocalClaimTerminalStatus.COMPLETED;
    case "cancelled":
      return LocalClaimTerminalStatus.CANCELLED;
    case "blocked":
      return LocalClaimTerminalStatus.BLOCKED;
    case "failed":
      return LocalClaimTerminalStatus.FAILED;
    case undefined:
      return undefined;
  }
};
const timestampFromProto = (value: Timestamp | undefined, field: string) =>
  timestampDate(requiredMessage(value, field)).toISOString();
const timestampToProto = (value: string) => timestampFromDate(new Date(value));

const llmFromProto = (value: LocalProjectLlmConfig) => ({
  provider: agentProviderFromProto(
    requiredMessage(value.provider, "config.projects.llm.provider"),
  ),
  model: value.model,
  effort: value.effort,
  approvalPolicy: approvalPolicyFromProto(value.approvalPolicy),
});
const autoHuntFromProto = (value: LocalAutoHuntConfig) => ({
  velenOrg: value.velenOrg,
  dataSource: value.dataSource,
  worktrees: value.worktrees === undefined
    ? undefined
    : {
      enabled: value.worktrees.enabled,
      root: value.worktrees.root,
      branchPrefix: value.worktrees.branchPrefix,
    },
  sandbox: value.sandbox === undefined
    ? undefined
    : { fullAccess: value.sandbox.fullAccess },
  linear: value.linear === undefined
    ? undefined
    : {
      enabled: value.linear.enabled,
      source: value.linear.source,
      teamKey: value.linear.teamKey,
    },
  githubRepository: value.githubRepository,
  githubRepositoryId: value.githubRepositoryId === undefined
    ? undefined
    : safeNumber(
      value.githubRepositoryId,
      "config.projects.autoHunt.githubRepositoryId",
    ),
  workflow: value.workflow === undefined
    ? undefined
    : workflowFromProto(value.workflow),
});
const activeClaimFromProto = (value: LocalActiveClaimConfig) => ({
  runId: value.runId,
  sourceKey: value.sourceKey,
  token: value.token,
  leaseExpiresAt: timestampFromProto(
    value.leaseExpiresAt,
    "config.projects.activeClaim.leaseExpiresAt",
  ),
  worktree: value.worktree === undefined
    ? undefined
    : {
      path: value.worktree.path,
      branch: value.worktree.branch,
      baseRef: value.worktree.baseRef,
      baseSha: value.worktree.baseSha,
    },
  finished: value.finished,
  terminalStatus: terminalStatusFromProto(value.terminalStatus),
  finishedAt: value.finishedAt === undefined
    ? undefined
    : timestampFromProto(
      value.finishedAt,
      "config.projects.activeClaim.finishedAt",
    ),
});
const projectFromProto = (value: LocalProjectConfig) => ({
  id: value.id,
  repositoryPath: value.repositoryPath,
  agentToken: value.agentToken,
  apiUrl: value.apiUrl,
  repositoryRemote: value.repositoryRemote,
  llm: value.llm === undefined ? undefined : llmFromProto(value.llm),
  autoHunt: value.autoHunt === undefined
    ? undefined
    : autoHuntFromProto(value.autoHunt),
  executionWorker: value.executionWorker === undefined
    ? undefined
    : {
      deviceId: value.executionWorker.deviceId,
      workerId: value.executionWorker.workerId,
      organizationId: value.executionWorker.organizationId,
      token: value.executionWorker.token,
      label: value.executionWorker.label,
      maxConcurrentSessions: value.executionWorker.maxConcurrentSessions,
    },
  activeClaim: value.activeClaim === undefined
    ? undefined
    : activeClaimFromProto(value.activeClaim),
});
/** Known providers of a stored added list, ignoring values this build cannot name. */
const knownProtoAgentProviders = new Set(
  agentProviders.map((provider) => agentProviderToProto(provider)),
);

const configFromProto = (value: LocalConfig): Config => {
  const agentProviderSettings = requiredMessage(
    value.agentProviders,
    "config.agentProviders",
  );
  const appSettings = requiredMessage(value.appSettings, "config.appSettings");
  const settings = {
    codex: agentProviderSettings.codex,
    claude: agentProviderSettings.claude,
    cursor: agentProviderSettings.cursor,
    grok: agentProviderSettings.grok,
    agy: agentProviderSettings.agy,
    opencode: agentProviderSettings.opencode,
    openrouter: agentProviderSettings.openrouter,
    vertex: agentProviderSettings.vertex,
    pi: agentProviderSettings.pi,
  };
  const openrouterApiKey = value.openrouterApiKey;
  const vertexAi = value.vertexAi === undefined ? undefined : {
    projectId: value.vertexAi.projectId,
    location: value.vertexAi.location,
  };
  return decodeDomainConfig({
    apiUrl: value.apiUrl,
    userToken: value.userToken,
    agentProviders: settings,
    // Message presence is the "never initialised" marker: absent means this
    // config predates the built-in/added split and is backfilled from what the
    // machine was already using.
    addedProviders: value.addedProviders === undefined
      ? backfilledAddedProviders(
        settings,
        (provider) =>
          hasSavedUpstreamCredential({ openrouterApiKey, vertexAi }, provider),
      )
      : normalizeAddedProviders(
        value.addedProviders.providers
          .filter((provider) => knownProtoAgentProviders.has(provider))
          .map(agentProviderFromProto),
      ),
    openrouterApiKey,
    vertexAi,
    appSettings: {
      preventSleepWhileRunning: appSettings.preventSleepWhileRunning,
      browserAutomationProvider: browserAutomationProviderFromProto(
        appSettings.browserAutomationProvider,
      ),
    },
    workerDeviceIdentity: value.workerDeviceIdentity,
    managedComputer: value.managedComputer === undefined
      ? undefined
      : {
        managedComputerId: value.managedComputer.managedComputerId,
        deviceId: value.managedComputer.deviceId,
        organizationId: value.managedComputer.organizationId,
        credentialFile: value.managedComputer.credentialFile,
      },
    projects: value.projects.map(projectFromProto),
  });
};

const llmToProto = (value: NonNullable<ProjectConfig["llm"]>) => ({
  provider: agentProviderToProto(value.provider),
  model: value.model,
  effort: value.effort,
  approvalPolicy: approvalPolicyToProto(value.approvalPolicy),
});
const autoHuntToProto = (value: NonNullable<ProjectConfig["autoHunt"]>) => ({
  velenOrg: value.velenOrg,
  dataSource: value.dataSource,
  worktrees: value.worktrees === undefined
    ? undefined
    : {
      enabled: value.worktrees.enabled,
      root: value.worktrees.root,
      branchPrefix: value.worktrees.branchPrefix,
    },
  sandbox: value.sandbox === undefined
    ? undefined
    : { fullAccess: value.sandbox.fullAccess },
  linear: value.linear === undefined
    ? undefined
    : {
      enabled: value.linear.enabled,
      source: value.linear.source,
      teamKey: value.linear.teamKey,
    },
  githubRepository: value.githubRepository,
  githubRepositoryId: value.githubRepositoryId === undefined
    ? undefined
    : BigInt(value.githubRepositoryId),
  workflow: value.workflow === undefined
    ? undefined
    : workflowToProto(value.workflow),
});
const activeClaimToProto = (
  value: NonNullable<ProjectConfig["activeClaim"]>,
) => ({
  runId: value.runId,
  sourceKey: value.sourceKey,
  token: value.token,
  leaseExpiresAt: timestampToProto(value.leaseExpiresAt),
  worktree: value.worktree === undefined
    ? undefined
    : {
      path: value.worktree.path,
      branch: value.worktree.branch,
      baseRef: value.worktree.baseRef,
      baseSha: value.worktree.baseSha,
    },
  finished: value.finished,
  terminalStatus: terminalStatusToProto(value.terminalStatus),
  finishedAt: value.finishedAt === undefined
    ? undefined
    : timestampToProto(value.finishedAt),
});
const projectToProto = (value: ProjectConfig) => ({
  id: value.id,
  repositoryPath: value.repositoryPath,
  agentToken: value.agentToken,
  apiUrl: value.apiUrl,
  repositoryRemote: value.repositoryRemote,
  llm: value.llm === undefined ? undefined : llmToProto(value.llm),
  autoHunt: value.autoHunt === undefined
    ? undefined
    : autoHuntToProto(value.autoHunt),
  executionWorker: value.executionWorker === undefined
    ? undefined
    : {
      deviceId: value.executionWorker.deviceId,
      workerId: value.executionWorker.workerId,
      organizationId: value.executionWorker.organizationId,
      token: value.executionWorker.token,
      label: value.executionWorker.label,
      maxConcurrentSessions: value.executionWorker.maxConcurrentSessions,
    },
  activeClaim: value.activeClaim === undefined
    ? undefined
    : activeClaimToProto(value.activeClaim),
});
const configToProto = (input: Config): LocalConfig => {
  const value = decodeDomainConfig(input);
  return create(LocalConfigSchema, {
    apiUrl: value.apiUrl,
    userToken: value.userToken,
    agentProviders: { ...value.agentProviders },
    // Always written, so a backfilled list stops being a backfill.
    addedProviders: {
      providers: addedAgentProviders(value).map(agentProviderToProto),
    },
    openrouterApiKey: value.openrouterApiKey,
    vertexAi: value.vertexAi === undefined
      ? undefined
      : { ...value.vertexAi },
    appSettings: {
      preventSleepWhileRunning: value.appSettings.preventSleepWhileRunning,
      browserAutomationProvider: browserAutomationProviderToProto(
        value.appSettings.browserAutomationProvider,
      ),
    },
    workerDeviceIdentity: value.workerDeviceIdentity,
    managedComputer: value.managedComputer === undefined
      ? undefined
      : { ...value.managedComputer },
    projects: value.projects.map(projectToProto),
  });
};

export const decodeConfig = (input: unknown): Config =>
  configFromProto(fromJson(LocalConfigSchema, input as JsonValue));
export const decodeConfigJson = (input: string): Config =>
  configFromProto(fromJsonString(LocalConfigSchema, input));
export const decodePreProtoConfigJson = (input: string): Config =>
  decodeDomainConfig(JSON.parse(input));
export const encodeConfigJson = (config: Config): string =>
  `${
    toJsonString(LocalConfigSchema, configToProto(config), { prettySpaces: 2 })
  }\n`;

const formatConfigIssue = SchemaIssue.makeFormatterStandardSchemaV1();
export function configErrorLocations(error: unknown): string[] {
  if (!Schema.isSchemaError(error)) {
    const message = error instanceof Error ? error.message : String(error);
    const unknownKey = /key "([^"]+)"/u.exec(message)?.[1];
    const invalidField = /cannot decode field [\w.]+\.([\w]+) from JSON/u
      .exec(message)?.[1];
    return [unknownKey ?? invalidField ?? "config"];
  }
  return [
    ...new Set(
      formatConfigIssue(error.issue).issues.map((issue) =>
        issue.path && issue.path.length > 0 ? issue.path.join(".") : "config"
      ),
    ),
  ].slice(0, 3);
}
