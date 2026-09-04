import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import {
  Argument,
  CliError,
  Command,
  Flag,
  Param,
} from "effect/unstable/cli";
import packageJson from "../../../package.json";
import { whoami } from "./auth-commands";
import { login } from "./command-support";
import {
  configureTeam,
  connectTeam,
  createTeam,
  listTeamsCommand,
  teamDoctor,
  showWorkflow,
} from "./team-commands";
import {
  claimWork,
  worktreeList,
  worktreeMaintain,
  worktreeRemove,
  worktreeShow,
} from "./worktree-commands";
import {
  addRunEvent,
  addRunEvidence,
  changeIssueDependencyCommand,
  createIssueCommand,
  updateIssueCommand,
  listChannelMessagesCommand,
  listCurrentRunEvidence,
  recoverRun,
  resumeRun,
  reworkRun,
  transitionWorkflowStage,
} from "./run-commands";
import {
  workerCommand,
  workerRegisterCommand,
  workerSyncLabelCommand,
  workerUnregisterCommand,
} from "./worker-commands";
import {
  workerRestartServices,
  workerService,
  workerStatus,
} from "./worker-service-commands";
import {
  configureMergeQueueCommand,
  listSkillGuides,
  mergeQueueDoctorCommand,
  showSkillGuide,
} from "./utility-commands";
import {
  managedComputerSetupCommand,
  managedComputerStatusCommand,
  managedComputerSyncCommand,
  managedComputerWorkerUpdateFailCommand,
  managedComputerWorkerUpdateStatusCommand,
  managedComputerWorkerSupervisor,
} from "./managed-computer-commands";
import { managedComputerEnrollCommand } from "./managed-computer-enrollment";
import {
  providerAuthCommand,
  providerModelsCommand,
  providerUsageCommand,
} from "./provider-commands";
import {
  githubCommitStatusCommand,
  githubCredentialCommand,
  githubPullRequestCreateCommand,
  githubPullRequestEditCommand,
  githubPullRequestMergeCommand,
  githubPullRequestViewCommand,
  githubRepositoryCommand,
} from "./github-commands";

type CommandHandler = () => void | Promise<void>;

const runHandler = (handler: CommandHandler) =>
  Effect.tryPromise({
    try: async () => handler(),
    catch: (cause) => new CliError.UserError({ cause }),
  });

const optionalStrings = (...names: ReadonlyArray<string>) =>
  Object.fromEntries(
    names.map((name) => [name, Flag.string(name).pipe(Flag.optional)]),
  );

const requiredStrings = (...names: ReadonlyArray<string>) =>
  Object.fromEntries(names.map((name) => [name, Flag.string(name)]));

const optionalIntegers = (...names: ReadonlyArray<string>) =>
  Object.fromEntries(
    names.map((name) => [name, Flag.integer(name).pipe(Flag.optional)]),
  );

const requiredIntegers = (...names: ReadonlyArray<string>) =>
  Object.fromEntries(names.map((name) => [name, Flag.integer(name)]));

const switches = (...names: ReadonlyArray<string>) =>
  Object.fromEntries(
    names.map((name) => [
      name,
      Flag.boolean(name).pipe(Flag.withDefault(false)),
    ]),
  );

const repeatedStrings = (...names: ReadonlyArray<string>) =>
  Object.fromEntries(
    names.map((name) => [name, Flag.string(name).pipe(Param.variadic)]),
  );

const leaf = <const Name extends string, const Config extends Command.Command.Config>(
  name: Name,
  config: Config,
  handler: CommandHandler,
  description: string,
) =>
  Command.make(name, config, () => runHandler(handler)).pipe(
    Command.withDescription(description),
  );

const loginCommand = leaf(
  "login",
  {},
  login,
  "Authenticate this machine with Briar",
);

const whoamiCommand = leaf(
  "whoami",
  {},
  whoami,
  "Show the currently authenticated Briar user",
);

const versionCommand = Command.make("version", {}, () =>
  Console.log(`briar ${packageJson.version}`)).pipe(
    Command.withDescription("Show version information"),
  );

const skillsCommand = Command.make("skills").pipe(
  Command.withDescription("Inspect bundled agent skill guides"),
  Command.withSubcommands([
    leaf(
      "list",
      switches("json"),
      listSkillGuides,
      "List bundled skill guides",
    ),
    Command.make(
      "get",
      {
        topic: Argument.string("topic"),
        ...switches("json"),
      },
      () => runHandler(showSkillGuide),
    ).pipe(Command.withDescription("Print a bundled skill guide")),
  ]),
);

const projectCommand = Command.make("project").pipe(
  Command.withDescription("Compatibility alias for repository-backed Teams"),
  Command.withSubcommands([
    leaf(
      "list",
      switches("json"),
      listTeamsCommand,
      "List projects available to the signed-in user",
    ),
    leaf(
      "create",
      optionalStrings("name"),
      createTeam,
      "Create and connect a project",
    ),
    leaf("doctor", {}, teamDoctor, "Inspect project readiness"),
    leaf(
      "configure",
      {
        ...optionalStrings(
          "velen-org",
          "data-source",
          "linear-source",
          "linear-team",
          "worktree-root",
          "branch-prefix",
          "github-repository",
        ),
        ...switches(
          "disable-velen",
          "enable-linear",
          "disable-linear",
          "enable-worktrees",
          "disable-worktrees",
          "enable-full-access",
          "disable-full-access",
          "i-understand-the-risk",
        ),
      },
      configureTeam,
      "Configure project integrations and execution policy",
    ),
  ]),
);

const teamCommand = Command.make("team").pipe(
  Command.withDescription("Create and configure repository-backed Briar Teams"),
  Command.withSubcommands([
    leaf(
      "list",
      switches("json"),
      listTeamsCommand,
      "List Teams available to the signed-in user",
    ),
    leaf(
      "create",
      optionalStrings("name"),
      createTeam,
      "Create and connect a Team",
    ),
    leaf("doctor", {}, teamDoctor, "Inspect Team readiness"),
    leaf(
      "configure",
      {
        ...optionalStrings(
          "velen-org",
          "data-source",
          "linear-source",
          "linear-team",
          "worktree-root",
          "branch-prefix",
          "github-repository",
        ),
        ...switches(
          "disable-velen",
          "enable-linear",
          "disable-linear",
          "enable-worktrees",
          "disable-worktrees",
          "enable-full-access",
          "disable-full-access",
          "i-understand-the-risk",
        ),
      },
      configureTeam,
      "Configure Team integrations and execution policy",
    ),
  ]),
);

const connectCommand = leaf(
  "connect",
  requiredStrings("project-id", "agent-token"),
  connectTeam,
  "Connect the current repository to an existing project",
);

const issueUpdateCommand = Command.make(
  "update",
  {
    run: Flag.string("run").pipe(
      Flag.withMetavar("uuid"),
      Flag.withDescription("Issue run ID"),
    ),
    title: Flag.string("title").pipe(
      Flag.withDescription("New issue title"),
      Flag.optional,
    ),
    description: Flag.string("description").pipe(
      Flag.withDescription("New issue description"),
      Flag.optional,
    ),
    descriptionFile: Flag.string("description-file").pipe(
      Flag.withDescription("Read the new description from a file"),
      Flag.optional,
    ),
    clearDescription: Flag.boolean("clear-description").pipe(
      Flag.withDescription("Clear the issue description"),
      Flag.withDefault(false),
    ),
    priority: Flag.integer("priority").pipe(
      Flag.withDescription("New priority from 1 to 4"),
      Flag.optional,
    ),
    clearPriority: Flag.boolean("clear-priority").pipe(
      Flag.withDescription("Clear the issue priority"),
      Flag.withDefault(false),
    ),
    difficulty: Flag.choice("difficulty", ["easy", "normal", "hard"]).pipe(
      Flag.withDescription("New issue difficulty"),
      Flag.optional,
    ),
    clearDifficulty: Flag.boolean("clear-difficulty").pipe(
      Flag.withDescription("Clear the issue difficulty"),
      Flag.withDefault(false),
    ),
    assigneeUserId: Flag.string("assignee-user-id").pipe(
      Flag.withDescription("Assign the issue to a project member"),
      Flag.optional,
    ),
    clearAssignee: Flag.boolean("clear-assignee").pipe(
      Flag.withDescription("Unassign the issue"),
      Flag.withDefault(false),
    ),
  },
  Effect.fn("issueUpdateCommand")(function* (input) {
    yield* runHandler(() =>
      updateIssueCommand({
        runId: input.run,
        title: Option.getOrUndefined(input.title),
        description: Option.getOrUndefined(input.description),
        descriptionFile: Option.getOrUndefined(input.descriptionFile),
        clearDescription: input.clearDescription,
        priority: Option.getOrUndefined(input.priority),
        clearPriority: input.clearPriority,
        difficulty: Option.getOrUndefined(input.difficulty),
        clearDifficulty: input.clearDifficulty,
        assigneeUserId: Option.getOrUndefined(input.assigneeUserId),
        clearAssignee: input.clearAssignee,
      })
    );
  }),
).pipe(
  Command.withDescription("Update an issue"),
  Command.withExamples([
    {
      command: "briar issue update --run <uuid> --title 'New title'",
      description: "Change an issue title",
    },
    {
      command:
        "briar issue update --run <uuid> --description-file issue.md --priority 2",
      description: "Replace an issue description and priority",
    },
  ]),
);

const issueCommand = Command.make("issue").pipe(
  Command.withDescription("Create and update issues and manage dependencies"),
  Command.withSubcommands([
    leaf(
      "create",
      {
        ...requiredStrings("title"),
        ...optionalStrings("description", "description-file", "status", "project"),
        ...optionalIntegers("priority"),
      },
      createIssueCommand,
      "Create an issue",
    ),
    issueUpdateCommand,
    Command.make("dependency").pipe(
      Command.withSubcommands([
        leaf(
          "add",
          requiredStrings("dependent-run", "prerequisite-run"),
          () => changeIssueDependencyCommand("add"),
          "Add a run dependency",
        ),
        leaf(
          "remove",
          requiredStrings("dependent-run", "prerequisite-run"),
          () => changeIssueDependencyCommand("remove"),
          "Remove a run dependency",
        ),
      ]),
    ),
  ]),
);

const channelCommand = Command.make("channel").pipe(
  Command.withDescription("Inspect project channel activity"),
  Command.withSubcommands([
    leaf(
      "messages",
      {
        channelId: Flag.string("channel-id").pipe(
          Flag.withMetavar("uuid"),
        ),
        cursor: Flag.string("cursor").pipe(
          Flag.withMetavar("message-uuid"),
          Flag.optional,
        ),
        parentMessageId: Flag.string("parent-message-id").pipe(
          Flag.withMetavar("root-message-uuid"),
          Flag.optional,
        ),
        ...optionalIntegers("limit"),
      },
      listChannelMessagesCommand,
      "List channel messages",
    ),
  ]),
);

const workflowCommand = Command.make("workflow").pipe(
  Command.withDescription("Inspect the configured workflow"),
  Command.withSubcommands([
    leaf("show", {}, showWorkflow, "Show the configured workflow"),
  ]),
);

const queueCommand = Command.make("queue").pipe(
  Command.withDescription("Claim queued Briar work"),
  Command.withSubcommands([
    leaf(
      "claim",
      {
        ...optionalStrings("run", "workspace", "base-branch"),
        ...switches("runtime-dispatch"),
      },
      claimWork,
      "Claim the next available issue",
    ),
  ]),
);

const worktreeCommand = Command.make("worktree").pipe(
  Command.withDescription("Inspect and maintain issue worktrees"),
  Command.withSubcommands([
    leaf("show", {}, worktreeShow, "Show the active claim worktree"),
    leaf("list", {}, worktreeList, "List issue worktrees"),
    leaf(
      "maintain",
      {
        ...optionalStrings("path", "run", "completed-at"),
        ...switches("all"),
      },
      worktreeMaintain,
      "Maintain completed worktrees",
    ),
    leaf(
      "remove",
      {
        ...optionalStrings("path"),
        ...switches("force"),
      },
      worktreeRemove,
      "Remove an issue worktree",
    ),
  ]),
);

const eventFlags = {
  ...requiredStrings("event-key"),
  ...optionalStrings(
    "run",
    "source",
    "source-key",
    "title",
    "status",
    "workflow-stage",
    "detail",
    "actor",
    "branch",
    "commit-sha",
    "tracker-provider",
    "issue-id",
    "issue-identifier",
    "issue-url",
    "issue-state",
    "repository",
    "target-sha",
    "occurred-at",
    "source-created-at",
    "context-json",
    "status-detail",
    "structured-result",
    "structured-result-file",
    "structured-result-proto-json",
  ),
  ...optionalIntegers("priority"),
  ...repeatedStrings("pull-request-url"),
};

const evidenceCommand = Command.make("evidence").pipe(
  Command.withSubcommands([
    leaf(
      "add",
      {
        ...requiredStrings("key", "stage", "type", "status"),
        ...optionalStrings(
          "run",
          "detail",
          "detail-file",
          "command",
          "url",
          "metadata-json",
          "observed-at",
        ),
        ...repeatedStrings("image"),
      },
      addRunEvidence,
      "Add run evidence",
    ),
    leaf(
      "list",
      optionalStrings("run"),
      listCurrentRunEvidence,
      "List run evidence",
    ),
  ]),
);

const runCommand = Command.make("run").pipe(
  Command.withDescription("Record and control run execution"),
  Command.withSubcommands([
    Command.make("event").pipe(
      Command.withSubcommands([
        leaf("add", eventFlags, addRunEvent, "Add an idempotent run event"),
      ]),
    ),
    leaf(
      "complete",
      eventFlags,
      () => addRunEvent("completed"),
      "Complete a run with a structured result",
    ),
    Command.make("stage").pipe(
      Command.withSubcommands([
        leaf(
          "start",
          {
            ...requiredStrings("stage"),
            ...optionalStrings("run", "request-id"),
            ...optionalIntegers("attempt", "revision"),
          },
          () => transitionWorkflowStage("start"),
          "Start a workflow stage",
        ),
        leaf(
          "complete",
          {
            ...requiredStrings("stage"),
            ...optionalStrings("run", "request-id"),
            ...optionalIntegers("attempt", "revision"),
          },
          () => transitionWorkflowStage("complete"),
          "Complete a workflow stage",
        ),
      ]),
    ),
    evidenceCommand,
    leaf(
      "rework",
      {
        ...requiredStrings("to", "reason"),
        ...optionalStrings("run", "request-id"),
      },
      reworkRun,
      "Return a run to an earlier stage",
    ),
    leaf(
      "resume",
      {
        ...requiredStrings("checkpoint"),
        ...requiredIntegers("attempt", "revision"),
        ...optionalStrings("run", "request-id"),
      },
      resumeRun,
      "Resume a paused run",
    ),
    leaf(
      "retry",
      optionalStrings("run", "request-id", "reason"),
      () => recoverRun("retry"),
      "Retry a failed or blocked run",
    ),
    leaf(
      "cancel",
      optionalStrings("run", "request-id", "reason"),
      () => recoverRun("cancel"),
      "Cancel a run",
    ),
  ]),
);

const workerSharedFlags = {
  ...optionalStrings("project"),
  ...optionalIntegers("max-issues"),
  ...switches("once"),
};

const workerCommandTree = Command.make(
  "worker",
  workerSharedFlags,
  () => runHandler(workerCommand),
).pipe(
  Command.withDescription("Register and run an execution worker"),
  Command.withSubcommands([
    leaf(
      "register",
      {
        ...optionalStrings("project", "label"),
        ...optionalIntegers("max-sessions"),
      },
      workerRegisterCommand,
      "Register this machine as a worker",
    ),
    leaf(
      "unregister",
      optionalStrings("project"),
      workerUnregisterCommand,
      "Unregister this machine's worker",
    ),
    leaf(
      "sync-label",
      optionalStrings("project", "label"),
      workerSyncLabelCommand,
      "Synchronize the worker label",
    ).pipe(Command.unlisted),
    leaf(
      "status",
      optionalStrings("project"),
      workerStatus,
      "Show worker status",
    ),
    leaf(
      "restart-services",
      {},
      workerRestartServices,
      "Restart installed worker services",
    ),
    leaf(
      "install-service",
      optionalStrings(
        "project",
        "briar-binary",
        "runtime-binary",
        "cli-script",
      ),
      () => workerService("install"),
      "Install the worker system service",
    ),
    leaf(
      "uninstall-service",
      optionalStrings("project"),
      () => workerService("uninstall"),
      "Uninstall the worker system service",
    ),
  ]),
);

const managedComputerCommand = Command.make("managed-computer").pipe(
  Command.withDescription("Set up and inspect this Briar managed computer"),
  Command.withSubcommands([
    leaf(
      "enroll",
      {},
      managedComputerEnrollCommand,
      "Enroll this managed computer from its instance identity proof",
    ).pipe(Command.unlisted),
    leaf(
      "setup",
      {
        ...requiredStrings("project", "repository"),
        ...optionalStrings(
          "provider",
          "computer",
          "request-id",
          "credential-file",
        ),
      },
      managedComputerSetupCommand,
      "Bind this enrolled computer to a Briar project",
    ),
    leaf(
      "sync",
      optionalStrings("project", "credential-file"),
      managedComputerSyncCommand,
      "Synchronize repository workflow settings from Briar",
    ),
    leaf(
      "status",
      optionalStrings("credential-file"),
      managedComputerStatusCommand,
      "Show managed computer setup and worker readiness",
    ),
    leaf(
      "worker-supervisor",
      {},
      managedComputerWorkerSupervisor,
      "Run managed project workers",
    ).pipe(Command.unlisted),
    leaf(
      "worker-update-status",
      {
        ...requiredStrings("worker", "request-id", "target-version"),
        ...optionalStrings("credential-file"),
      },
      managedComputerWorkerUpdateStatusCommand,
      "Read a managed Worker update handoff",
    ).pipe(Command.unlisted),
    leaf(
      "worker-update-fail",
      {
        ...requiredStrings("worker", "request-id", "error"),
        ...optionalStrings("credential-file"),
      },
      managedComputerWorkerUpdateFailCommand,
      "Report a managed Worker update failure",
    ).pipe(Command.unlisted),
  ]),
);

const mergeQueueCommand = Command.make("merge-queue").pipe(
  Command.withDescription("Configure and inspect the merge queue"),
  Command.withSubcommands([
    leaf(
      "configure",
      {
        ...optionalStrings("project", "readiness-stage"),
        ...optionalIntegers("quiet-window-ms", "max-batch-size"),
        ...switches("enable", "disable"),
      },
      configureMergeQueueCommand,
      "Configure merge queue batching",
    ),
    leaf(
      "doctor",
      {
        ...optionalStrings("project"),
        ...switches("json"),
      },
      mergeQueueDoctorCommand,
      "Inspect merge queue readiness",
    ),
  ]),
);

const githubCommand = Command.make("github").pipe(
  Command.withDescription("Use the project's GitHub App connection"),
  Command.withSubcommands([
    Command.make("pr").pipe(
      Command.withSubcommands([
        leaf(
          "create",
          {
            ...requiredStrings("title", "head"),
            ...optionalStrings("base", "body", "body-file"),
            ...switches("draft"),
          },
          githubPullRequestCreateCommand,
          "Create a pull request with the GitHub App",
        ),
        leaf(
          "view",
          requiredStrings("number"),
          githubPullRequestViewCommand,
          "Read a pull request with the GitHub App",
        ),
        leaf(
          "edit",
          {
            ...requiredStrings("number"),
            ...optionalStrings("title", "body", "body-file", "base", "state"),
          },
          githubPullRequestEditCommand,
          "Update a pull request with the GitHub App",
        ),
        leaf(
          "merge",
          {
            ...requiredStrings("number"),
            ...optionalStrings("method", "head-sha"),
          },
          githubPullRequestMergeCommand,
          "Merge a pull request without bypassing repository rules",
        ),
      ]),
    ),
    leaf(
      "status",
      {
        ...requiredStrings("sha", "state", "context"),
        ...optionalStrings("description", "target-url"),
      },
      githubCommitStatusCommand,
      "Publish a commit status with the GitHub App",
    ),
    leaf(
      "repository",
      {},
      githubRepositoryCommand,
      "Inspect the project's authoritative GitHub repository",
    ),
    Command.make(
      "credential",
      { operation: Argument.string("operation") },
      () => runHandler(githubCredentialCommand),
    ).pipe(
      Command.withDescription("Provide a scoped token to Git credential"),
      Command.unlisted,
    ),
  ]),
);

const providerFlags = {
  ...optionalStrings("home", "execution-path"),
  ...optionalIntegers("timeout-ms"),
  ...repeatedStrings("provider"),
  ...switches("json"),
};

const providerCommand = Command.make("provider").pipe(
  Command.withDescription(
    "Inspect locally installed coding agent providers",
  ),
  Command.withSubcommands([
    leaf(
      "usage",
      { ...providerFlags, ...switches("openrouter-configured") },
      providerUsageCommand,
      "Report provider quota usage as briar.local.v1 ProtoJSON",
    ),
    leaf(
      "models",
      providerFlags,
      providerModelsCommand,
      "Report the provider model and effort catalog as briar.local.v1 ProtoJSON",
    ),
    leaf(
      "auth",
      { ...providerFlags, ...switches("openrouter-configured") },
      providerAuthCommand,
      "Report which providers are signed in on this machine",
    ),
  ]),
);

export const briarCommand = Command.make("briar").pipe(
  Command.withDescription("Briar project and worker command-line interface"),
  Command.withSubcommands([
    loginCommand,
    whoamiCommand,
    versionCommand,
    skillsCommand,
    projectCommand,
    teamCommand,
    connectCommand,
    issueCommand,
    channelCommand,
    workflowCommand,
    queueCommand,
    providerCommand,
    worktreeCommand,
    runCommand,
    workerCommandTree,
    managedComputerCommand,
    mergeQueueCommand,
    githubCommand,
  ]),
);
