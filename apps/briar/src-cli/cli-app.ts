import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import {
  Argument,
  CliError,
  Command,
  Flag,
  Param,
} from "effect/unstable/cli";
import packageJson from "../../../package.json";
import { login } from "./command-support";
import {
  configureProject,
  connectProject,
  createProject,
  projectDoctor,
  showWorkflow,
} from "./project-commands";
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

const switches = (...names: ReadonlyArray<string>) =>
  Object.fromEntries(names.map((name) => [name, Flag.boolean(name)]));

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
  Command.withDescription("Create and configure Briar projects"),
  Command.withSubcommands([
    leaf(
      "create",
      optionalStrings("name"),
      createProject,
      "Create and connect a project",
    ),
    leaf("doctor", {}, projectDoctor, "Inspect project readiness"),
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
      configureProject,
      "Configure project integrations and execution policy",
    ),
  ]),
);

const connectCommand = leaf(
  "connect",
  requiredStrings("project-id", "agent-token"),
  connectProject,
  "Connect the current repository to an existing project",
);

const issueCommand = Command.make("issue").pipe(
  Command.withDescription("Create issues and manage dependencies"),
  Command.withSubcommands([
    leaf(
      "create",
      {
        ...requiredStrings("title"),
        ...optionalStrings("description", "description-file", "status"),
        ...optionalIntegers("priority"),
      },
      createIssueCommand,
      "Create an issue",
    ),
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
    "structured-result-file",
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
        ...optionalStrings("run", "checkpoint", "request-id"),
        ...optionalIntegers("attempt", "revision"),
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

const mergeQueueCommand = Command.make("merge-queue").pipe(
  Command.withDescription("Configure and inspect the merge queue"),
  Command.withSubcommands([
    leaf(
      "configure",
      {
        ...optionalStrings("project"),
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

export const briarCommand = Command.make("briar").pipe(
  Command.withDescription("Briar project and worker command-line interface"),
  Command.withSubcommands([
    loginCommand,
    versionCommand,
    skillsCommand,
    projectCommand,
    connectCommand,
    issueCommand,
    channelCommand,
    workflowCommand,
    queueCommand,
    worktreeCommand,
    runCommand,
    workerCommandTree,
    mergeQueueCommand,
  ]),
);
