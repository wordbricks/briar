import { DmExecutionContext } from "./dm-execution-context";
import { classifyDmReply } from "./dm-reply-routing";

import { dmAcknowledgementOwed, startDmAcknowledgement } from "./dm-acknowledgement";
import {
  ChannelReplyTimeline,
  channelReplyTriggerCreatedAt,
  settleChannelReplyTimelineOutcome,
  type ChannelReplySetupAccount,
  type ChannelReplyTimelineOutcome,
} from "./channel-reply-timeline";
import { normalizeChannelAcknowledgementReaction } from "../src/lib/channel-acknowledgement-reaction";
import {
  chmod,
  mkdtemp,
  mkdir,
  lstat,
  writeFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replyErrorDiagnostic } from "./reply-error-diagnostic";
import { dmReplyRedacted, dmReplyRedactedError, dmSafeProviderBlock } from "./dm-reply-redaction";
import {
  DmMessageInvocation,
  supportsDmMessagePublicationProvider,
} from "./dm-message-invocation";
import { findAgentBundle } from "./agent-bundle-path";
import {
  closeMemoryVault,
  openMemoryVaultInvocation,
  runWithMemoryVault,
  type MemoryVaultInvocation,
} from "./memory-vault-invocation";
import {
  ChannelAgentReplyProviderOutputSchema,
  type ChannelAgentReplyTurn,
  type ParsedChannelReplyAgentResult,
} from "../src/lib/channel-agent-reply-contract";
import {
  IssueAgentReplyProviderOutputSchema,
  type ParsedIssueAgentReply,
} from "../src/lib/agent-reply-contract";
import {
  createDetachedTranscriptSequencer,
  detachedChannelReplyPrompt,
  detachedIssueReplyPrompt,
  detachedPlannedUpdateContinuationPrompt,
  detachedProjectAgentPrompt,
  shouldPersistDetachedTranscriptPayload,
  type DetachedAgent,
} from "./agent-runner";
import { agentImageAttachments } from "../src-agent/runner-attachments";
import {
  DetachedProviderBlockedError,
  DetachedProviderStopUnconfirmedError,
  assertDetachedProviderTurnSucceeded,
  detachedProviderBlockOf,
  logDetachedProviderTurnDiagnostic,
  prepareDetachedProviderTurn,
  runDetachedProviderTurn,
  type DetachedProviderTurnDiagnostic,
  type PreparedDetachedProviderTurn,
} from "./detached-provider-turn";
import { materializeDetachedAgentSkillCatalog } from "./agent-skill-discovery";
import { ChannelActivityPublisher } from "./channel-activity-publisher";
import { createReplyActivityClient } from "./reply-activity-client";
import { createReplyCompletionClient } from "./reply-completion-client";
import {
  createWorkerQueueClient,
  createWorkerQueueOperations,
} from "./worker-queue-client";
import {
  createWorkerTranscriptBatcher,
  transcriptEventFromSidecar,
} from "./worker-transcript-client";
import {
  workerCliPath,
  interruptibleSleep,
  workerExecutionPath,
  WorkerUpdateDrainError,
  type WorkerExecutionCheckpoint,
} from "./worker";
import {
  allocateAnalysisWorktree,
  allocateCachedAnalysisWorktree,
  analysisWorktreePath,
  extendCachedAnalysisWorktreeRetention,
  findExistingIssueWorktree,
  issueReplyWorkspaceMode,
  listCachedAnalysisWorktrees,
  markCachedAnalysisWorktreeIdle,
  projectWorktreeRoot,
  removeAnalysisWorktree,
} from "./worktree";
import {
  collectChannelReplyAttachments,
} from "./channel-reply-attachments";
import {
  channelReplySnapshotChannelKind,
  channelReplyStartsWithoutWorktree,
  type ChannelReplyWorkspaceKind,
} from "./channel-reply-workspace";
import {
  collectIssueReplyAttachments,
  parseIssueReplyAgentResult,
} from "./issue-reply-attachments";
import { ReplyGeneratedImageCollector } from "./reply-generated-images";
import { validateReplyAttachments } from "./reply-attachments";
import { providerStructuredOutputContract } from "./structured-output-contract";
import {
  nextStructuredOutputRepairPrompt,
  repairableDecoder,
} from "./structured-output-repair";
import {
  channelReplyAttachmentDirectory,
  cleanupChannelReplyAttachments,
  downloadChannelReplyAttachments,
} from "./channel-reply-images";
import { cleanupChannelReplyResources } from "./channel-reply-cleanup";
import { channelReplyIssueAttachmentDefaults } from "./channel-reply-issue-attachments";
import { assertChannelReplyWorkspaceScope } from "./channel-reply-scope";
import {
  cleanupWorkspaceAgentContext,
  downloadWorkspaceAgentContextManifest,
  hydrateWorkspaceAgentContext,
  prepareWorkspaceAgentWorkspace,
} from "./workspace-agent-context";
import {
  type Config,
  type TeamConfig,
} from "./config-contract";
import {
  type ClaimedChannelReply,
  type ClaimedIssueReply,
  type ClaimedProjectAgentTask,
} from "./worker-queue-contract";
import {
  providerExecutionEnvironment,
  configDirectory,
  value,
  has,
  required,
  runGit,
  worktreeSettings,
  worktreesEnabled,
} from "./command-support";
import { Code, ConnectError } from "@connectrpc/connect";
import { downloadClaimAttachment } from "./worktree-commands";
import {
  activeReplyActivityPublishers,
  retainCachedAnalysisWorktree,
  releaseCachedAnalysisWorktree,
  detachedAgentWithActiveSkill,
  detachedReplyAgent,
} from "./issue-execution";

/**
 * The claim carries the hop as an unbounded proto integer. The server caps it
 * at 2; anything else is treated as the human-started hop so an unknown value
 * can never unlock the send or relay wording.
 */
const agentMessageHop = (hop: number): 0 | 1 | 2 =>
  hop === 1 || hop === 2 ? hop : 0;

/** Protocol 1 can pre-publish only a plain text final message. */
export const canPublishPlainDmFinal = (
  result: ParsedChannelReplyAgentResult["result"],
  attachments: readonly File[],
) => attachments.length === 0 &&
  result.body.trim().length > 0 &&
  (result.memoryCitations?.length ?? 0) === 0 &&
  result.document === null &&
  result.issueProposal === null &&
  result.issueBatchProposal === null &&
  result.executionProposal === null &&
  result.skillExecutionProposal === null &&
  result.delegation === null &&
  result.agentMessage === null;

export const publishPlainDmFinal = (
  invocation: Pick<DmMessageInvocation, "publishFinal"> | null,
  result: ParsedChannelReplyAgentResult["result"],
  attachments: readonly File[],
  signal: AbortSignal,
) => invocation && canPublishPlainDmFinal(result, attachments)
  ? invocation.publishFinal(result.body, signal)
  : Promise.resolve(null);

async function runClaimedProjectAgentTask(
  config: Config,
  project: TeamConfig,
  task: ClaimedProjectAgentTask,
  workerToken: string,
  workerId: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
  runtime: {
    allocateWorktree: typeof allocateAnalysisWorktree;
    removeWorktree: typeof removeAnalysisWorktree;
    runProviderTurn: typeof runDetachedProviderTurn;
    git: typeof runGit;
    // Tests observe the resume-scoped transcript range through this factory.
    createTranscriptSequencer?: typeof createDetachedTranscriptSequencer;
    /** See `ChannelReplyRuntime.memoryToolsPath`. */
    memoryToolsPath?: string | null;
  } = {
    allocateWorktree: allocateAnalysisWorktree,
    removeWorktree: removeAnalysisWorktree,
    runProviderTurn: runDetachedProviderTurn,
    git: runGit,
    memoryToolsPath: undefined,
  },
) {
  const workspaceId = project.executionWorker?.workspaceId;
  if (!workspaceId) throw new Error("Worker registration is missing");
  const worktree = await runtime.allocateWorktree({
    repositoryPath: project.repositoryPath,
    projectId: project.id,
    workId: task.workId,
    settings: worktreeSettings(project),
    git: runtime.git,
  });
  let taskError: unknown;
  let memoryVault: MemoryVaultInvocation | null = null;
  try {
    const workspacePath = worktree.path;
    reportCheckpoint?.({ workspacePath });
    memoryVault = await openMemoryVaultInvocation({
      queue: createWorkerQueueClient(config.apiUrl, workerToken),
      projectId: project.id,
      workerId,
      work: task,
      personFacing: false,
      workspaceTools: true,
      signal,
      scriptPath: memoryToolsScriptPath(runtime),
    });
    const agent: DetachedAgent = {
      ...detachedAgentWithActiveSkill(task.agent, task.activeSkill),
      scope: { kind: "project", workspaceId, projectId: project.id },
    };
    const taskPrompt = detachedProjectAgentPrompt({
      agent,
      request: task.request,
      workspacePath,
    });
    // A handed-off claim resumes the provider conversation that a planned
    // Worker update interrupted. Replaying the original prompt verbatim makes
    // the Agent redo finished work, so the resumed turn asks it to continue.
    const resumedConversationId = task.handoffContext?.conversationId ?? null;
    const prompt = resumedConversationId
      ? detachedPlannedUpdateContinuationPrompt(taskPrompt)
      : taskPrompt;
    // Attempt and resume both scope the sequence range: a planned update hands
    // the same attempt back, so only the resume count keeps the resumed
    // transcript from reusing sequences the server already stored.
    const transcriptSequencer =
      (runtime.createTranscriptSequencer ?? createDetachedTranscriptSequencer)(
        task.claimAttempts,
        task.resumeCount,
      );
    // Direct Agent tasks are not Hunt runs. Their task/session UUID is the
    // durable transcript key, while attempt- and resume-scoped sequence ranges
    // make Worker retries append safely without requiring a Hunt-run binding.
    const transcriptBatcher = createWorkerTranscriptBatcher({
      apiUrl: config.apiUrl,
      token: workerToken,
      projectId: project.id,
      work: task,
      sessionId: task.workId,
      agentProvider: agent.provider,
      onError: (error) => {
        console.error(
          `transcript upload failed for ${task.sourceKey}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    });
    let conversationId: string | null = resumedConversationId;
    if (conversationId) reportCheckpoint?.({ conversationId });
    const turn = await (async () => {
      try {
        return await runWithMemoryVault(memoryVault, {
          agent,
          prompt,
          workspacePath,
          fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
          conversationId,
          environment: providerExecutionEnvironment(config, agent.provider, {
            ...process.env,
            PATH: workerExecutionPath(),
            BRIAR_CLI: workerCliPath(),
            BRIAR_WORKER_TOKEN: workerToken,
            BRIAR_TEAM_ID: project.id,
          }),
          signal,
          onConversationId: (nextConversationId) => {
            conversationId = nextConversationId;
            reportCheckpoint?.({ conversationId: nextConversationId });
          },
          onPayload: async (payload) => {
            const sequence = transcriptSequencer.nextForPayload(payload);
            if (sequence === null) return;
            await transcriptBatcher.enqueue(
              transcriptEventFromSidecar(payload, sequence),
            );
          },
        }, (turnInput) => runtime.runProviderTurn(turnInput));
      } finally {
        // Transcript telemetry remains optional, but buffered progress deserves
        // one final upload attempt before the durable task result is settled.
        await transcriptBatcher.flush();
      }
    })();
    assertDetachedProviderTurnSucceeded(turn);
    if (!turn.resultText) throw new Error("Agent returned an empty direct-run summary");
    return {
      projectId: project.id,
      workerId,
      claimToken: task.claimToken,
      summary: turn.resultText.slice(0, 50_000),
      conversationId: turn.conversationId ?? conversationId,
    };
  } catch (error) {
    taskError = error;
    throw error;
  } finally {
    await closeMemoryVault(memoryVault);
    try {
      await runtime.removeWorktree({
        repositoryPath: project.repositoryPath,
        path: worktree.path,
        git: runtime.git,
      });
    } catch (cleanupError) {
      if (taskError !== undefined) {
        throw new AggregateError(
          [taskError, cleanupError],
          "Project Agent task and worktree cleanup both failed",
        );
      }
      throw cleanupError;
    }
  }
}

async function runClaimedIssueReply(
  config: Config,
  project: TeamConfig,
  issue: ClaimedIssueReply,
  workerToken: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const registered = project.executionWorker;
  if (!registered) throw new Error("Worker registration is missing");
  const provider = issue.provider;
  const trigger = issue.snapshot.messages.find(
    (message) => message.id === issue.triggerMessageId,
  );
  if (!trigger) throw new Error("Mention message is missing from the reply snapshot");
  const projectUsesWorktrees = worktreesEnabled(project);
  const settings = worktreeSettings(project);
  const worktreeRoot = projectWorktreeRoot(settings.root, project.id);
  // A running issue must see the processing Worker's uncommitted files. An
  // unassigned issue has no execution worktree yet, so its read-only replies
  // share a short-lived analysis checkout instead.
  const configuredWorktree = projectUsesWorktrees
    ? findExistingIssueWorktree(
        runGit,
        project.repositoryPath,
        worktreeRoot,
        {
          runId: issue.runId,
          sourceKey: issue.sourceKey,
          title: issue.title,
        },
        issue.branch,
      )
    : null;
  const workspaceMode = issueReplyWorkspaceMode({
    worktreesEnabled: projectUsesWorktrees,
    hasConfiguredWorktree: configuredWorktree !== null,
    requiresPreferredWorker: issue.requiresPreferredWorker,
  });
  if (workspaceMode === "missing-required") {
    throw new Error(
      "The issue processing worktree is not available on this Worker",
    );
  }
  const cachedAnalysisPath =
    workspaceMode === "cached-analysis"
      ? analysisWorktreePath(settings.root, project.id, issue.runId)
      : null;
  let cachedAnalysisWorktree:
    | Awaited<ReturnType<typeof allocateCachedAnalysisWorktree>>
    | null = null;
  if (cachedAnalysisPath) {
    retainCachedAnalysisWorktree(cachedAnalysisPath);
    try {
      cachedAnalysisWorktree = await allocateCachedAnalysisWorktree({
        repositoryPath: project.repositoryPath,
        projectId: project.id,
        runId: issue.runId,
        settings,
        git: runGit,
      });
    } catch (error) {
      releaseCachedAnalysisWorktree(cachedAnalysisPath);
      throw error;
    }
  }
  const workspacePath =
    configuredWorktree?.path ??
    cachedAnalysisWorktree?.path ??
    project.repositoryPath;
  reportCheckpoint?.({ workspacePath });
  const imageDirectory = await mkdtemp(join(tmpdir(), "briar-issue-reply-images-"));
  let imagesCleaned = false;
  let lastActivityErrorAt = Number.NEGATIVE_INFINITY;
  const replyActivity = createReplyActivityClient(config.apiUrl);
  const replyCompletion = createReplyCompletionClient(
    config.apiUrl,
    workerToken,
  );
  const activityPublisher = new ChannelActivityPublisher({
    credential: issue.activity,
    send: (credential, activity) =>
      replyActivity.publishReplyActivity({
        replyJobId: issue.workId,
        capability: credential.token,
        activity,
      }).then(() => undefined),
    onError: (error) => {
      const now = Date.now();
      if (now - lastActivityErrorAt < 60_000) return;
      lastActivityErrorAt = now;
      console.error(
        `issue activity publish failed for ${issue.workId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  activeReplyActivityPublishers.set(issue.workId, activityPublisher);
  let memoryVault: MemoryVaultInvocation | null = null;
  const cleanupContext = () =>
    cleanupChannelReplyResources([
      {
        label: "issue reply memory vault",
        run: async () => {
          const vault = memoryVault;
          memoryVault = null;
          await closeMemoryVault(vault);
        },
      },
      {
        label: "issue reply attachments",
        run: async () => {
          if (imagesCleaned) return;
          await rm(imageDirectory, { recursive: true, force: true });
          imagesCleaned = true;
        },
      },
    ]);
  try {
    await mkdir(imageDirectory, { recursive: true, mode: 0o700 });
    const downloadedImages = await Promise.all(
      trigger.attachments
        .filter((attachment) => attachment.contentType.startsWith("image/"))
        .map(async (attachment) => ({
          ...attachment,
          localPath: await downloadClaimAttachment(
            config.apiUrl,
            workerToken,
            project.id,
            issue.runId,
            attachment,
            imageDirectory,
          ),
        })),
    );
    const attachments = agentImageAttachments(downloadedImages);
    memoryVault = await openMemoryVaultInvocation({
      queue: createWorkerQueueClient(config.apiUrl, workerToken),
      projectId: project.id,
      workerId: registered.workerId,
      work: issue,
      personFacing: true,
      workspaceTools: true,
      signal,
    });
    const agent = detachedReplyAgent({
      workId: issue.workId,
      provider,
      model: issue.model,
      effort: issue.effort,
      agent: issue.agent,
      activeSkill: issue.activeSkill,
      fallbackName: "Project Agent",
      scope: {
        kind: "project",
        workspaceId: registered.workspaceId,
        projectId: project.id,
      },
    });
    if (
      issue.skillExecutionTarget &&
      (issue.skillExecutionTarget.projectId !== project.id ||
        issue.skillExecutionTarget.agentId !== agent.id ||
        issue.skillExecutionTarget.skillId !== agent.activeSkill?.id ||
        issue.skillExecutionTarget.skillName !== agent.activeSkill?.name ||
        issue.skillExecutionTarget.executionMode !==
          agent.activeSkill?.executionMode ||
        issue.skillExecutionTarget.approvalPolicy !==
          agent.activeSkill?.approvalPolicy ||
        issue.skillExecutionTarget.request !== trigger.body)
    ) {
      throw new Error(
        "Issue reply Skill execution target does not match its claimed context",
      );
    }
    const prompt = detachedIssueReplyPrompt({
      agent,
      snapshot: {
        ...issue.snapshot,
        downloadedImagePaths: attachments.map((attachment) => attachment.path),
      },
      userMessage: trigger.body,
      workspaceAvailable: true,
      workspaceShared: workspaceMode !== "cached-analysis",
      skillExecutionTarget: issue.skillExecutionTarget,
    });
    const outputContract = providerStructuredOutputContract(
      agent.provider,
      IssueAgentReplyProviderOutputSchema,
    );
    let sequence = 0;
    const transcriptBatcher = createWorkerTranscriptBatcher({
      apiUrl: config.apiUrl,
      token: workerToken,
      projectId: project.id,
      work: issue,
      sessionId: `reply-${issue.workId}`,
      agentProvider: provider,
      onError: (error) => {
        console.error(
          `transcript upload failed for reply ${issue.workId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      },
    });
    let conversationId: string | null = issue.handoffContext?.conversationId ?? null;
    if (conversationId) reportCheckpoint?.({ conversationId });
    const generatedImages = new ReplyGeneratedImageCollector();
    const runReplyTurn = async (
      turnPrompt: string,
      turnAttachments: typeof attachments | undefined,
    ) => {
      try {
        return await runWithMemoryVault(memoryVault, {
          agent,
          prompt: turnPrompt,
          workspacePath,
          fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
          attachments: turnAttachments,
          conversationId,
          outputSchema: outputContract.jsonSchema,
          environment: providerExecutionEnvironment(config, agent.provider, {
            ...process.env,
            PATH: workerExecutionPath(),
            BRIAR_CLI: workerCliPath(),
            BRIAR_WORKER_TOKEN: workerToken,
            BRIAR_TEAM_ID: project.id,
          }),
          signal,
          diagnosticContext: {
            runId: issue.runId,
            workId: issue.workId,
            workType: "issueReply",
          },
          onDiagnostic: logDetachedProviderTurnDiagnostic,
          onConversationId: (nextConversationId) => {
            conversationId = nextConversationId;
            reportCheckpoint?.({ conversationId: nextConversationId });
          },
          onPayload: async (payload) => {
            activityPublisher.observePayload(payload);
            generatedImages.observePayload(payload);
            sequence += 1;
            if (shouldPersistDetachedTranscriptPayload(payload)) {
              await transcriptBatcher.enqueue(
                transcriptEventFromSidecar(payload, sequence),
              );
            }
          },
        }, (turnInput) => runDetachedProviderTurn(turnInput));
      } finally {
        // The durable reply result remains more important than optional
        // transcript data, but buffered events must get one final send chance.
        await transcriptBatcher.flush();
      }
    };
    const decodeReplyJson = repairableDecoder(outputContract.decodeJson);
    let repairRounds = 0;
    let turnPrompt = prompt;
    let parsedResult: ParsedIssueAgentReply | null = null;
    while (!parsedResult) {
      // A repair continues the same provider conversation, which already holds
      // the delivered images.
      const turn = await runReplyTurn(
        turnPrompt,
        repairRounds === 0 ? attachments : undefined,
      );
      assertDetachedProviderTurnSucceeded(turn);
      if (!turn.resultText) {
        throw new Error("Agent returned an empty issue reply");
      }
      try {
        parsedResult = parseIssueReplyAgentResult(
          turn.resultText,
          decodeReplyJson,
          {
            allowSkillExecutionProposal:
              issue.skillExecutionTarget?.executionMode === "task",
          },
        );
      } catch (error) {
        turnPrompt = nextStructuredOutputRepairPrompt({
          error,
          rounds: repairRounds,
          basePrompt: prompt,
          conversationId,
        });
        repairRounds += 1;
      }
    }
    const result = parsedResult.result;
    const replyAttachments = validateReplyAttachments([
      ...await collectIssueReplyAttachments({
        workspacePath,
        paths: parsedResult.attachmentPaths,
      }),
      ...generatedImages.files(),
    ], "Issue reply");
    // Private downloaded images must be removed before the durable reply
    // succeeds. Worktree cache bookkeeping is best-effort in the outer cleanup.
    await cleanupContext();
    await replyCompletion.completeIssueReply({
      projectId: project.id,
      workerId: registered.workerId,
      work: issue,
      outcome: { case: "success", result, attachments: replyAttachments },
      signal,
    });
  } finally {
    activityPublisher.stop();
    if (activeReplyActivityPublishers.get(issue.workId) === activityPublisher) {
      activeReplyActivityPublishers.delete(issue.workId);
    }
    try {
      await cleanupContext();
    } finally {
      if (cachedAnalysisWorktree && cachedAnalysisPath) {
        try {
          await markCachedAnalysisWorktreeIdle({
            root: worktreeRoot,
            runId: issue.runId,
            worktree: cachedAnalysisWorktree,
          });
        } catch (error) {
          console.error(
            `analysis worktree cache update failed for ${issue.runId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          releaseCachedAnalysisWorktree(cachedAnalysisPath);
        }
      }
    }
  }
}

async function failClaimedIssueReply(
  config: Config,
  project: TeamConfig,
  issue: ClaimedIssueReply,
  workerToken: string,
  error: unknown,
) {
  const workerId = project.executionWorker?.workerId;
  if (!workerId) throw error;
  const block = detachedProviderBlockOf(error);
  await createReplyCompletionClient(config.apiUrl, workerToken)
    .completeIssueReply({
      projectId: project.id,
      workerId,
      work: issue,
      outcome: {
        case: "failure",
        error: error instanceof Error ? error.message : String(error),
        ...(block ? { block } : {}),
      },
    });
}

type ChannelReplyRuntime = {
  runProviderTurn: typeof runDetachedProviderTurn;
  /** Start the provider process before the prompt exists; null when it cannot. */
  prepareProviderTurn: typeof prepareDetachedProviderTurn;
  workspaceRoot: string;
  dmMessageMcpServerPath?: string;
  /**
   * The `tools memory` bundle. Present and undefined (the production default)
   * finds the one this Worker shipped; null, or a runtime without the key,
   * runs without a memory vault, so a hand-built test runtime never reaches
   * a real server for vault context.
   */
  memoryToolsPath?: string | null;
  /** Tests observe worktree allocation through this runner. */
  git?: typeof runGit;
};

type ChannelReplyAcknowledgement = {
  /** "none" when this reply owes no reaction at all: not a DM, or not a person's message. */
  mode: "placeholder" | "existing" | "none";
};

type ChannelReplyAcknowledgementTask = {
  acknowledgement: ChannelReplyAcknowledgement;
  stop: () => void;
};

const defaultChannelReplyRuntime = (): ChannelReplyRuntime => ({
  runProviderTurn: runDetachedProviderTurn,
  prepareProviderTurn: prepareDetachedProviderTurn,
  workspaceRoot: configDirectory,
  memoryToolsPath: undefined,
});

/** `undefined` asks `openMemoryVaultInvocation` to find the shipped bundle. */
const memoryToolsScriptPath = (runtime: { memoryToolsPath?: string | null }) =>
  Object.hasOwn(runtime, "memoryToolsPath") ? runtime.memoryToolsPath : null;

/*
  The server chooses this Agent's emoji from the message itself the moment it
  arrives, so by the time a reply is claimed the reaction is usually already
  there and this publishes nothing. What is left here is the fallback for a
  server selection that failed: the placeholder, published from the claim
  itself rather than from anywhere downstream of routing, the worktree or the
  rest of the setup.
*/
function startChannelReplyAcknowledgement(
  config: Config,
  reply: ClaimedChannelReply,
  signal: AbortSignal,
  timeline: ChannelReplyTimeline,
): ChannelReplyAcknowledgementTask {
  const capability = reply.activity?.token;
  if (!capability || !dmAcknowledgementOwed(reply.snapshot, reply.triggerMessageId)) {
    return { acknowledgement: { mode: "none" }, stop: () => {} };
  }
  // The server's own emoji, a steer restart or a lease-expiry retry all reach
  // this claim with a reaction already on the trigger; the placeholder would
  // say nothing the message does not already show.
  if (reply.acknowledgementReaction !== null) {
    return { acknowledgement: { mode: "existing" }, stop: () => {} };
  }
  const replyActivity = createReplyActivityClient(config.apiUrl);
  const stop = startDmAcknowledgement({
    signal,
    publish: (emoji, publishSignal) =>
      replyActivity.publishAcknowledgementReaction({
        replyJobId: reply.workId, capability, emoji, signal: publishSignal,
      }),
    onPlaceholderPublished: () => timeline.recordAcknowledgementPublished(),
    onError: (error) => console.error(
      `channel reply acknowledgement publish failed for ${reply.workId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ),
  });
  return { acknowledgement: { mode: "placeholder" }, stop };
}

async function runClaimedChannelReply(
  config: Config,
  project: TeamConfig,
  reply: ClaimedChannelReply,
  workerToken: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
  runtime: ChannelReplyRuntime = defaultChannelReplyRuntime(),
) {
  /*
    Created before anything else this claim does, so every stretch below is
    measured from the same origin as `channel reply setup:` — and so the line
    is owed even by a reply that fails before its first provider turn.
  */
  const timeline = new ChannelReplyTimeline({
    workId: reply.workId,
    triggerCreatedAt: channelReplyTriggerCreatedAt(
      reply.snapshot,
      reply.triggerMessageId,
    ),
  });
  const { acknowledgement, stop } = startChannelReplyAcknowledgement(
    config, reply, signal, timeline,
  );
  timeline.recordAcknowledgementMode(acknowledgement.mode);
  /*
    A planned Worker update aborts the execution with its own reason and the
    loop hands the claim to the next Worker. The steer verdict is the Worker
    command's to make — it asks the server only once this cleanup has finished
    — so an ordinary failure is what this reply knows about itself.
  */
  let outcome: ChannelReplyTimelineOutcome = "failed";
  try {
    const result = await runClaimedChannelReplyTurn(
      config, project, reply, workerToken, signal, acknowledgement,
      timeline, reportCheckpoint, runtime,
    );
    outcome = timeline.outcomeWhenCompleted();
    return result;
  } catch (error) {
    if (signal.aborted && signal.reason instanceof WorkerUpdateDrainError) {
      outcome = "handed_off";
    }
    throw error;
  } finally {
    // Cancels a placeholder publication still in flight once the reply is over.
    stop();
    timeline.finish(outcome);
  }
}

/*
  Work ids whose first provider turn has begun. Until it has, a lease conflict
  is almost always the steer the setup is about to fold into this same claim,
  so the Worker loop defers to the fold instead of throwing the claim away.
*/
const startedChannelReplyTurns = new Set<string>();

export const channelReplyTurnStarted = (workId: string) =>
  startedChannelReplyTurns.has(workId);

/** The unavailable RPC is worth saying once per Worker, not once per reply. */
let reportedMissingSteerFold = false;

/**
 * Asks the server to fold a steer that landed after the claim into this same
 * claim, and answers with the claim payload rebuilt against the folded input.
 *
 * Null means nothing was pending. It also means a server that does not know
 * this RPC yet: the steer is then noticed by the lease renewal exactly as it
 * was before, so an older server keeps its old behaviour instead of failing
 * the reply.
 */
async function foldChannelReplySteer(input: {
  queue: ReturnType<typeof createWorkerQueueOperations>;
  projectId: string;
  workerId: string;
  reply: ClaimedChannelReply;
  signal: AbortSignal;
}) {
  // Only a direct message is ever steered, so nothing else pays the round trip.
  if (channelReplySnapshotChannelKind(input.reply.snapshot) !== "dm") return null;
  try {
    return await input.queue.refreshChannelReplyClaim({
      projectId: input.projectId,
      workerId: input.workerId,
      work: input.reply,
      signal: input.signal,
    });
  } catch (error) {
    if (!(error instanceof ConnectError) || error.code !== Code.Unimplemented) {
      throw error;
    }
    if (!reportedMissingSteerFold) {
      reportedMissingSteerFold = true;
      console.log(
        "channel reply steer fold is unavailable on this server; steering falls back to the lease renewal",
      );
    }
    return null;
  }
}

/**
 * The setup a claimed channel reply owes before its first provider turn, in
 * the order the sequential version ran them: it is also the order a failure is
 * reported in, so a parallel setup blames the same step the old one did.
 */
const channelReplySetupSteps = [
  "workspace",
  "memoryVault",
  "message",
  "organizationContext",
  "attachments",
  "skills",
  "prewarm",
] as const;
type ChannelReplySetupStep = (typeof channelReplySetupSteps)[number];

/**
 * The value of a step the caller has already proven did not reject. The throw
 * is unreachable and only keeps the reason from being swallowed if it ever is.
 */
function settledSetupValue<T>(result: PromiseSettledResult<T>): T {
  if (result.status === "rejected") throw result.reason;
  return result.value;
}

/*
  One line per reply, printed as soon as the first provider turn is accepted,
  because the gap this measures is invisible from either end: the claim log and
  `turn.started` were 15–30 seconds apart with nothing between them. A step this
  claim never needed is absent rather than zero. `boot` is what remained after
  the setup: `turn.started` to the provider accepting the turn's thread. The
  reply prints the line even if the turn never gets that far, so a hung or
  failed provider still leaves the setup account behind.
*/
function logChannelReplySetup(
  workId: string,
  durations: ReadonlyMap<ChannelReplySetupStep, number>,
  account: ChannelReplySetupAccount,
) {
  console.log(`channel reply setup: ${JSON.stringify({
    workId,
    ...Object.fromEntries(channelReplySetupSteps.flatMap((step) => {
      const elapsed = durations.get(step);
      return elapsed === undefined ? [] : [[step, elapsed] as const];
    })),
    total: Math.round(account.totalMs),
    parallel: true,
    steerFolded: account.steerFolded,
    prewarm: account.prewarm,
    ...(account.bootMs === null ? {} : { boot: Math.round(account.bootMs) }),
  })}`);
}

async function runClaimedChannelReplyTurn(
  config: Config,
  project: TeamConfig,
  reply: ClaimedChannelReply,
  workerToken: string,
  signal: AbortSignal,
  acknowledgement: ChannelReplyAcknowledgement,
  timeline: ChannelReplyTimeline,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
  runtime: ChannelReplyRuntime = defaultChannelReplyRuntime(),
) {
  const claimedAt = timeline.claimedAt;
  const registered = project.executionWorker;
  if (!registered) throw new Error("Worker registration is missing");
  // Absent means the real one: both sides are the same git runner.
  const git = runtime.git ?? runGit;
  assertChannelReplyWorkspaceScope(reply, project.id);
  let routing = reply.routing;
  if (routing?.action === "pending") {
    const decision = routing.proposedAction
      ? { action: routing.proposedAction, targetJobId: routing.targetJobId, response: routing.response }
      : await classifyDmReply({
      reply,
      agent: detachedReplyAgent({ workId: reply.workId, provider: reply.provider,
        model: reply.model, effort: reply.effort, agent: reply.agent,
        activeSkill: null, fallbackName: "Briar DM", scope: reply.scope }),
      signal, runProviderTurn: runtime.runProviderTurn,
      environment: providerExecutionEnvironment(config, reply.provider, process.env),
    });
    const queue = createWorkerQueueOperations(createWorkerQueueClient(config.apiUrl, workerToken));
    // An earlier classifier can finish later. Retain this decision while the
    // server waits for input order rather than asking the model to retarget it.
    let routingWaitMs = 1000;
    while (true) {
      signal.throwIfAborted();
      const saved = await queue.resolveDmReplyRouting({
          projectId: project.id, workerId: registered.workerId, work: reply, decision,
        });
      if (saved.action !== "pending") {
        routing = { action: saved.action, proposedAction: saved.proposedAction ?? null, targetJobId: saved.targetJobId ?? null, response: saved.response ?? null };
        break;
      }
      await interruptibleSleep(routingWaitMs, signal);
      routingWaitMs = Math.min(routingWaitMs * 2, 5000);
    }
  }
  if (routing?.action === "steer" || routing?.action === "cancel") return;
  if (routing?.action === "answer" || routing?.action === "clarify") {
    const queue = createWorkerQueueClient(config.apiUrl, workerToken);
    const completion = createReplyCompletionClient(config.apiUrl, workerToken, { queue });
    const publication = reply.dmPublicMessageProtocol === 1
      ? await DmMessageInvocation.create({ queue, projectId: project.id,
          workerId: registered.workerId, work: reply, signal })
      : null;
    let terminal = false;
    try {
      const result = { body: routing.response ?? "", document: null, issueProposal: null,
        issueBatchProposal: null, executionProposal: null, skillExecutionProposal: null,
        delegation: null, agentMessage: null };
      const receipt = await publication?.publishFinal(result.body, signal);
      const completed = await completion.completeChannelReply({ projectId: project.id,
        workerId: registered.workerId, work: reply,
        outcome: { case: "success", conversationId: null, result, attachments: [],
          publishedFinalBatchId: receipt?.batchId }, signal });
      timeline.recordCompletion(completed.disposition);
      terminal = completed.disposition === "completed";
    } finally { await publication?.cleanup({ terminal }); }
    return;
  }

  const settings = worktreeSettings(project);
  const worktreeRoot = projectWorktreeRoot(settings.root, project.id);
  const sessionWorktreePath = reply.projectId && reply.session
    ? analysisWorktreePath(settings.root, project.id, reply.session.id)
    : null;
  if (reply.routing && reply.session) {
    const retainedPath = sessionWorktreePath ?? join(runtime.workspaceRoot,
      "worker-sessions", `channel-${reply.session.id}`);
    if (await lstat(join(retainedPath, ".briar-stop-unconfirmed")).catch(() => null)) {
      throw new DetachedProviderStopUnconfirmedError();
    }
    const retained = await lstat(retainedPath).catch(() => null);
    if ((reply.inputRevision > 0 || reply.session.conversationId) && (!retained?.isDirectory() || retained.isSymbolicLink())) {
      throw new Error("DM 작업 디렉터리를 복구할 수 없어 이전 작업을 다시 시작하지 않았습니다.");
    }
  }
  // A plain DM conversation turn is never where code changes, so it starts
  // with no checkout: the fetch and `git worktree add` used to sit on the
  // critical path of every "hi".
  const startsWithoutWorktree = channelReplyStartsWithoutWorktree(reply);
  let messageInvocation: DmMessageInvocation | null = null;
  let executionContext: DmExecutionContext | null = null;
  let publicationTerminal = false;
  let organizationContextCleaned = false;
  let attachmentsCleaned = false;
  let workspaceCleaned = false;
  let lastActivityErrorAt = Number.NEGATIVE_INFINITY;
  const replyActivity = createReplyActivityClient(config.apiUrl);
  const workerQueueClient = createWorkerQueueClient(config.apiUrl, workerToken);
  const workerQueue = createWorkerQueueOperations(workerQueueClient);
  const replyCompletion = createReplyCompletionClient(
    config.apiUrl,
    workerToken,
    { queue: workerQueueClient },
  );
  const setupDurations = new Map<ChannelReplySetupStep, number>();
  const measureSetup = <T>(
    step: ChannelReplySetupStep,
    run: () => Promise<T>,
  ): Promise<T> => {
    const startedAt = performance.now();
    const pending = run().then((value) => {
      setupDurations.set(step, Math.round(performance.now() - startedAt));
      return value;
    });
    /*
      Nothing awaits a claim-scoped step until the workspace is ready, so a
      step that fails inside that window would reach the runtime as an
      unhandled rejection — fatal under Bun. The settle below still sees the
      rejection; this only says it has an owner.
    */
    pending.catch(() => undefined);
    return pending;
  };
  /*
    The memory vault answers per turn, but whether this reply has one at all is
    known from the first context, fetched here beside the workspace. `none`
    (the run has no Agent) runs the reply without memory.
  */
  const memoryVault = await openMemoryVaultInvocation({
    queue: workerQueueClient,
    projectId: project.id,
    workerId: registered.workerId,
    work: reply,
    personFacing: true,
    workspaceTools: true,
    citations: true,
    signal: signal,
    scriptPath: memoryToolsScriptPath(runtime),
  });
  const memoryVaultPending = memoryVault
    ? measureSetup("memoryVault", () => memoryVault.prefetch())
    : null;
  /*
    The message relay needs nothing but the claim: it listens on a Unix socket
    in a private directory of its own. Starting it here runs it against the
    workspace decision below rather than after it, and its result is collected
    with the workspace-bound steps in one settle.
  */
  const durablePublicMessages = reply.dmPublicMessageProtocol === 1 &&
    supportsDmMessagePublicationProvider(reply.provider);
  const messagePending = durablePublicMessages
    ? measureSetup("message", async () => {
      // A test supplies the bundle; the Worker finds the one it shipped. The
      // lookup stays ahead of the listener so a missing bundle cannot strand
      // an open relay socket.
      const serverPath = runtime.dmMessageMcpServerPath ?? await findAgentBundle(
        import.meta.dir,
        "dm-message-mcp-server.js",
      );
      const invocation = await DmMessageInvocation.create({
        queue: workerQueueClient,
        projectId: project.id,
        workerId: registered.workerId,
        work: reply,
        signal: signal,
      });
      return { invocation, serverPath };
    })
    : null;
  /** A workspace failure must not strand a relay socket or a memory vault. */
  const discardStartedInvocations = async () => {
    const [message] = await Promise.allSettled([messagePending]);
    await closeMemoryVault(memoryVault);
    if (message.status === "fulfilled" && message.value) {
      await message.value.invocation.cleanup().catch(() => undefined);
    }
  };
  let sessionWorktree:
    | Awaited<ReturnType<typeof allocateCachedAnalysisWorktree>>
    | null = null;
  let analysisWorktree:
    | Awaited<ReturnType<typeof allocateAnalysisWorktree>>
    | Awaited<ReturnType<typeof allocateCachedAnalysisWorktree>>
    | null = null;
  let retainedUntil = reply.session?.retainedUntil ?? null;
  // The repository-less workspace an Organization Agent already uses. It stays
  // addressable after a mid-turn checkout because the downloaded attachments
  // and the retained Skill catalog live under it.
  const detachedWorkspacePath = join(
    runtime.workspaceRoot,
    "worker-sessions",
    `channel-${reply.session?.id ?? reply.workId}`,
  );
  let workspacePath = detachedWorkspacePath;
  let detachedWorkspacePrepared = false;
  const logSessionWorkspace = (workspace: ChannelReplyWorkspaceKind) => {
    timeline.recordWorkspace(workspace);
    if (!reply.session) return;
    console.log(`channel reply session: ${JSON.stringify({
      sessionId: reply.session.id,
      channelId: reply.channelId,
      threadId: reply.session.threadId,
      agentId: reply.agent.id,
      claimReason: reply.session.claimReason,
      workspaceReused: sessionWorktree?.reused ?? false,
      workspace,
      acknowledgement: acknowledgement.mode,
      retainedUntil,
    })}`);
  };
  const workspaceStartedAt = performance.now();
  try {
    // One exception inside the gate: a session that already has a checkout on
    // this disk keeps it, because the conversation may already be talking about
    // files in it.
    const sessionWorktreeCached = sessionWorktreePath !== null &&
        startsWithoutWorktree && reply.session
      ? (await listCachedAnalysisWorktrees(worktreeRoot)).some(
        (candidate) => candidate.runId === reply.session!.id,
      )
      : false;
    if (sessionWorktreePath && (!startsWithoutWorktree || sessionWorktreeCached)) {
      retainCachedAnalysisWorktree(sessionWorktreePath);
      try {
        sessionWorktree = await allocateCachedAnalysisWorktree({
          repositoryPath: project.repositoryPath,
          projectId: project.id,
          runId: reply.session!.id,
          settings,
          git,
          retainedUntil: reply.session!.retainedUntil,
        });
      } catch (error) {
        releaseCachedAnalysisWorktree(sessionWorktreePath);
        throw error;
      }
    }
    analysisWorktree = reply.projectId && !startsWithoutWorktree
      ? sessionWorktree ?? await allocateAnalysisWorktree({
          repositoryPath: project.repositoryPath,
          projectId: project.id,
          workId: reply.workId,
          settings,
          git,
        })
      : sessionWorktree;
    if (analysisWorktree) workspacePath = analysisWorktree.path;
    logSessionWorkspace(
      analysisWorktree === null
        ? "none"
        : sessionWorktree?.reused
        ? "reused"
        : "created",
    );
    reportCheckpoint?.({ workspacePath });
    if (!analysisWorktree) {
      // A prior hard-killed attempt may have left a path behind. Recreate the
      // exact claim workspace so stale files or a planted symlink cannot become
      // trusted Workspace Agent context.
      await prepareWorkspaceAgentWorkspace(workspacePath, process.pid, {
        reuse: Boolean(reply.session),
        retainedUntil: retainedUntil ?? undefined,
      });
      detachedWorkspacePrepared = true;
    }
  } catch (error) {
    await discardStartedInvocations();
    throw error;
  }
  setupDurations.set(
    "workspace",
    Math.round(performance.now() - workspaceStartedAt),
  );
  // Only a project reply has a repository at all, and only one that started
  // without a checkout has one left to ask for.
  const repositoryRequestAvailable = startsWithoutWorktree &&
    reply.projectId !== null && analysisWorktree === null;
  const attachmentDirectory = channelReplyAttachmentDirectory(workspacePath);
  const activityPublisher = new ChannelActivityPublisher({
    credential: reply.activity,
    send: async (credential, activity) => {
      await replyActivity.publishReplyActivity({
        replyJobId: reply.workId,
        capability: credential.token,
        activity,
      });
    },
    onError: (error) => {
      const now = Date.now();
      if (now - lastActivityErrorAt < 60_000) return;
      lastActivityErrorAt = now;
      console.error(
        `channel activity publish failed for ${reply.workId}: ${
          dmReplyRedacted(reply, memoryVault?.scopeKind)
            ? dmReplyRedactedError(error).message
            : error instanceof Error ? error.message : String(error)
        } | ${replyErrorDiagnostic(error)}`,
      );
    },
  });
  activeReplyActivityPublishers.set(reply.workId, activityPublisher);
  const cleanupContext = () =>
    cleanupChannelReplyResources([
      {
        label: "memory vault",
        run: async () => closeMemoryVault(memoryVault),
      },
      ...(reply.scope.kind === "workspace"
        ? [{
            label: "workspace context",
            run: async () => {
              if (organizationContextCleaned) return;
              await cleanupWorkspaceAgentContext(workspacePath);
              organizationContextCleaned = true;
            },
          }]
        : []),
      {
        label: "channel attachments",
        run: async () => {
          if (attachmentsCleaned) return;
          await cleanupChannelReplyAttachments(attachmentDirectory);
          attachmentsCleaned = true;
        },
      },
      ...(!reply.session
        ? [{
            label: analysisWorktree ? "analysis worktree" : "channel workspace",
            run: async () => {
              if (workspaceCleaned) return;
              // A turn that asked for the repository mid-reply owns both: the
              // checkout it moved into and the repository-less workspace its
              // attachments were downloaded to.
              if (analysisWorktree) {
                await removeAnalysisWorktree({
                  repositoryPath: project.repositoryPath,
                  path: analysisWorktree.path,
                  git,
                });
              }
              if (detachedWorkspacePrepared) {
                await rm(detachedWorkspacePath, { recursive: true, force: true });
              }
              workspaceCleaned = true;
            },
          }]
        : []),
    ]);
  /*
    A pre-warmed provider process is the one setup resource that outlives the
    step that made it, so its account and its disposal are owned out here: the
    reply prints the setup line and kills the process exactly once, whichever
    way the turn ends.
  */
  let preparedRunner: PreparedDetachedProviderTurn | null = null;
  let prewarmOutcome = "none";
  let bootStartedAt: number | null = null;
  let bootMs: number | null = null;
  let steerFolded = false;
  let setupLogged = false;
  const logSetupOnce = () => {
    if (setupLogged) return;
    setupLogged = true;
    // One record, two lines: the timeline reports exactly what this prints.
    logChannelReplySetup(
      reply.workId,
      setupDurations,
      timeline.recordSetup({
        totalMs: performance.now() - claimedAt,
        bootMs,
        steerFolded,
        prewarm: prewarmOutcome,
      }),
    );
  };
  const observeProviderDiagnostic = (
    diagnostic: DetachedProviderTurnDiagnostic,
  ) => {
    if (diagnostic.phase === "turn.started") {
      bootStartedAt ??= performance.now();
      return;
    }
    if (diagnostic.phase === "runner.prewarm_used") {
      prewarmOutcome = "used";
      return;
    }
    if (diagnostic.phase === "runner.prewarm_discarded") {
      prewarmOutcome = `discarded:${String(diagnostic.reason)}`;
    }
  };
  try {
    executionContext = reply.routing && reply.session ? await DmExecutionContext.open(workspacePath) : null;
    const agent = detachedReplyAgent({
      workId: reply.workId,
      provider: reply.provider,
      model: reply.model,
      effort: reply.effort,
      agent: reply.agent,
      activeSkill: reply.activeSkill,
      fallbackName: "Briar Channel",
      scope: reply.scope,
    });
    const baseProviderEnvironment = providerExecutionEnvironment(
      config,
      agent.provider,
      {
        ...process.env,
        PATH: workerExecutionPath(),
        BRIAR_CLI: workerCliPath(),
        BRIAR_WORKER_TOKEN: workerToken,
        BRIAR_TEAM_ID: project.id,
        // Identifier only. It lets `briar channel messages` read this
        // channel's history under the claim the session already holds, so
        // the Agent never needs a member's Project Agent token. The claim
        // token stays out of the provider environment because it also
        // authorizes submitting the reply.
        BRIAR_CHANNEL_REPLY_WORK_ID: reply.workId,
      },
    );
    // The pre-warmed process is spawned with this environment, so the private
    // `tools` directory is on its PATH from the start. It stays empty, and
    // `tools` does not exist, until a turn's context gives this reply a vault.
    const providerEnvironment = memoryVault
      ? memoryVault.environment(baseProviderEnvironment)
      : baseProviderEnvironment;
    /*
      The provider process is the last thing on the critical path that needs
      nothing from the steps below: which binary, which workspace, which
      conversation and which sandbox are all settled. Starting it here lets its
      boot run against the message relay, the downloads and the Skill catalog
      instead of after them. Only Codex supports it; every other provider — and
      every later round — spawns when its turn starts.
    */
    const conversationIdAtClaim: string | null = reply.routing
      ? null
      : reply.session?.conversationId ?? reply.handoffContext?.conversationId ??
        null;
    const prewarmPending = measureSetup("prewarm", () =>
      runtime.prepareProviderTurn({
        agent,
        prompt: "",
        workspacePath,
        fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
        conversationId: conversationIdAtClaim,
        toolInheritance: "briar",
        environment: providerEnvironment,
        signal: signal,
        diagnosticContext: {
          runId: reply.runId,
          workId: reply.workId,
          workType: "channelReply",
        },
        onDiagnostic: (diagnostic) => {
          observeProviderDiagnostic(diagnostic);
          logDetachedProviderTurnDiagnostic(diagnostic);
        },
      }).catch((error) => {
        // A pre-warm is an optimization; its failure is one log line and a
        // cold spawn, never a failed reply.
        console.error(
          `channel reply prewarm failed for ${reply.workId}: ${
            replyErrorDiagnostic(error)
          }`,
        );
        return null;
      }));
    /*
      Everything left needs the prepared workspace and nothing from the other
      steps, so the manifest download, the attachment downloads and the Skill
      catalog start together and settle beside the relay that started with the
      claim. Serialized, these were the 15–30 seconds a DM spent between its
      claim and the first provider turn.
    */
    const organizationContextPending = reply.scope.kind === "workspace"
      ? measureSetup(
        "organizationContext",
        () => downloadWorkspaceAgentContextManifest({
          apiUrl: config.apiUrl,
          workerToken,
          workspaceId: reply.workspaceId,
          workId: reply.workId,
          workerId: registered.workerId,
          claimToken: reply.claimToken,
          snapshotAt: reply.organizationContext!.snapshotAt,
          workspacePath,
          signal: signal,
        }),
      )
      : null;
    const attachmentsPending = measureSetup(
      "attachments",
      () => downloadChannelReplyAttachments({
        apiUrl: config.apiUrl,
        workerToken,
        workspaceId: reply.workspaceId,
        workId: reply.workId,
        claimToken: reply.claimToken,
        triggerAttachments: reply.triggerAttachments,
        workspacePath,
      }),
    );
    // A retained channel session resumes the same provider conversation across
    // replies. Keep its Skill catalog at a stable workspace path for that
    // conversation; workspace/session TTL cleanup owns its eventual removal.
    const skillCatalogPending = reply.session
      ? measureSetup(
        "skills",
        () => materializeDetachedAgentSkillCatalog(agent, {
          temporaryParentPath: workspacePath,
          lifetime: "retained-conversation",
        }),
      )
      : null;
    const [
      messageSettled,
      organizationContextSettled,
      attachmentsSettled,
      skillCatalogSettled,
    ] = await Promise.allSettled([
      messagePending,
      organizationContextPending,
      attachmentsPending,
      skillCatalogPending,
    ]);
    // Assigned before anything can be thrown: the `finally` block below owns
    // every resource a settled step produced, including on the failure path.
    // That includes the pre-warmed process, which is killed there whether this
    // reply used it, replaced it or never reached its first turn.
    preparedRunner = await prewarmPending;
    if (preparedRunner) prewarmOutcome = "ready";
    if (messageSettled.status === "fulfilled" && messageSettled.value) {
      messageInvocation = messageSettled.value.invocation;
    }
    // Step order, so a reply reports the same failure the sequential setup did.
    const setupFailure = [
      messageSettled,
      organizationContextSettled,
      attachmentsSettled,
      skillCatalogSettled,
    ].find((step) => step.status === "rejected");
    if (setupFailure?.status === "rejected") throw setupFailure.reason;
    const publication = settledSetupValue(messageSettled);
    const organizationContext = settledSetupValue(organizationContextSettled);
    let downloadedAttachments = settledSetupValue(attachmentsSettled);
    const retainedSkillCatalog = settledSetupValue(skillCatalogSettled);
    /*
      The last thing owed before the provider runs. A message the person sent
      while this reply was being set up is already folded into this job on the
      server; nothing here used to notice until the finished answer was refused,
      which cost a whole provider turn, a requeue and a second setup. One RPC
      here brings the claim up to date inside the same claim: same claim token,
      same attempt, no restart.
    */
    const folded = await foldChannelReplySteer({
      queue: workerQueue,
      projectId: project.id,
      workerId: registered.workerId,
      reply,
      signal: signal,
    });
    steerFolded = folded !== null;
    if (folded) {
      /*
        Only what this turn is about to read. The session is deliberately left
        as it was claimed: the turn has not started, so there is no interrupted
        conversation to continue and the prompt must be the ordinary one for two
        unanswered messages.
      */
      const downloaded = new Set(
        reply.triggerAttachments.map((attachment) => attachment.id),
      );
      const addedAttachments = folded.triggerAttachments.some(
        (attachment) => !downloaded.has(attachment.id),
      );
      reply = {
        ...reply,
        snapshot: folded.snapshot,
        pendingTriggerMessageIds: folded.pendingTriggerMessageIds,
        inputRevision: folded.inputRevision,
        publishedMessageBatches: folded.publishedMessageBatches,
        triggerAttachments: folded.triggerAttachments,
      };
      if (addedAttachments) {
        downloadedAttachments = await downloadChannelReplyAttachments({
          apiUrl: config.apiUrl,
          workerToken,
          workspaceId: reply.workspaceId,
          workId: reply.workId,
          claimToken: reply.claimToken,
          triggerAttachments: reply.triggerAttachments,
          workspacePath,
        });
      }
      /*
        The relay carries the input revision the server checks every publication
        against, so the folded revision needs a relay of its own. Nothing has
        been published from this claim yet; the journal it reopens is the same
        one, keyed by work id.
      */
      if (messageInvocation) {
        await messageInvocation.cleanup();
        messageInvocation = await DmMessageInvocation.create({
          queue: workerQueueClient,
          projectId: project.id,
          workerId: registered.workerId,
          work: reply,
          signal: signal,
        });
      }
      console.log(
        `channel reply steer folded for ${reply.workId}: revision ${
          reply.inputRevision
        }, pending ${reply.pendingTriggerMessageIds.join(", ")}`,
      );
    }
    const dmMessageMcpServerPath = publication ? publication.serverPath : null;
    // Decided once, from the context fetched during setup.
    const memoryVaultMode = Boolean(memoryVaultPending && await memoryVaultPending);
    const outputContract = providerStructuredOutputContract(
      agent.provider,
      ChannelAgentReplyProviderOutputSchema,
      normalizeChannelAcknowledgementReaction,
    );
    // Rebuilt when a mid-turn checkout changes what the Agent may do, so the
    // continuation never repeats "you have no repository".
    const buildPrompt = () => detachedChannelReplyPrompt({
      agent,
      snapshot: {
        ...reply.snapshot,
        downloadedImagePaths: downloadedAttachments.imagePaths,
        downloadedFilePaths: downloadedAttachments.filePaths,
        unreadableAttachments: downloadedAttachments.unreadable,
      },
      workspaceAvailable: Boolean(analysisWorktree),
      workspaceRetained: Boolean(reply.routing && reply.session),
      repositoryRequestAvailable: repositoryRequestAvailable &&
        analysisWorktree === null,
      organizationContextAvailable: organizationContext !== null,
      memoryVaultAvailable: memoryVaultMode,
      delegationTargets: reply.delegationTargets,
      delegation: reply.delegation,
      // An Agent-to-Agent hop only changes what this turn may say. Hop 1 stays
      // an ordinary channel reply here, so the claimed scope keeps deciding the
      // worktree and workspace context exactly as it does for hop 0.
      agentMessageTargets: reply.agentMessageTargets,
      inboundAgentMessage: reply.inboundAgentMessage
        ? {
            senderAgentName: reply.inboundAgentMessage.senderAgentName,
            body: reply.inboundAgentMessage.body,
          }
        : null,
      agentMessageHop: agentMessageHop(reply.agentMessageHop),
      skillExecutionTarget: reply.skillExecutionTarget,
      pendingTriggerMessageIds: reply.pendingTriggerMessageIds,
    });
    let prompt = buildPrompt();
    let conversationId: string | null = conversationIdAtClaim;
    if (conversationId) reportCheckpoint?.({ conversationId });
    let lookupRounds = 0;
    let repairRounds = 0;
    let repositoryRounds = 0;
    /** One refusal per reply: a second context request is the model ignoring it. */
    let contextRefused = false;
    /**
     * Checks the project out mid-reply, once. A session keeps the checkout in
     * its cached analysis worktree so a retry or a steer of the same
     * conversation reuses it; a sessionless reply gets a disposable one that
     * the cleanup block removes.
     */
    const checkOutRepositoryOnDemand = async () => {
      if (sessionWorktreePath && reply.session) {
        retainCachedAnalysisWorktree(sessionWorktreePath);
        try {
          sessionWorktree = await allocateCachedAnalysisWorktree({
            repositoryPath: project.repositoryPath,
            projectId: project.id,
            runId: reply.session.id,
            settings,
            git,
            ...(retainedUntil === null ? {} : { retainedUntil }),
          });
        } catch (error) {
          releaseCachedAnalysisWorktree(sessionWorktreePath);
          throw error;
        }
        analysisWorktree = sessionWorktree;
      } else {
        analysisWorktree = await allocateAnalysisWorktree({
          repositoryPath: project.repositoryPath,
          projectId: project.id,
          workId: reply.workId,
          settings,
          git,
        });
      }
      workspacePath = analysisWorktree.path;
      reportCheckpoint?.({ workspacePath });
      logSessionWorkspace("on_demand");
    };
    const decodeReplyJson = repairableDecoder(outputContract.decodeJson);
    let turnPrompt = [
      !reply.routing && reply.session?.conversationId && reply.pendingTriggerMessageIds.length > 1
        ? "Continue the interrupted response in this same conversation with the updated user inputs below. Preserve completed work and tool results from the transcript; do not repeat completed actions unless the new input requires it."
        : null,
      prompt, reply.routing ? null : messageInvocation?.prompt()]
      .filter(Boolean)
      .join("\n\n");
    let result: ParsedChannelReplyAgentResult["result"] | null = null;
    let attachmentPaths: string[] = [];
    const generatedImages = new ReplyGeneratedImageCollector();
    startedChannelReplyTurns.add(reply.workId);
    while (!result) {
      // Every continuation bumps one of the three round counters, so this is
      // the claim's first provider turn.
      const firstRound = lookupRounds === 0 && repairRounds === 0 &&
        repositoryRounds === 0;
      /*
        Only the claim's first turn can use the pre-warmed process: a later
        round runs against a conversation the warm process was not prepared
        with.
      */
      const roundPreparedRunner = firstRound ? preparedRunner : null;
      timeline.startTurn();
      const turn = await runWithMemoryVault(memoryVault, {
        agent,
        prompt: reply.routing ? [turnPrompt, executionContext?.prompt(), messageInvocation?.prompt()].filter(Boolean).join("\n\n") : turnPrompt,
        workspacePath,
        /*
          A channel reply answers in a conversation with the tools Briar gave
          it. The host user's own MCP servers, apps and plugins are started
          before the prompt reaches the model on every single turn — 4.5 s of
          the measured boot on the reference machine — and a reply never uses
          them. Auto Hunt, issue replies and project agent tasks still inherit.
        */
        toolInheritance: "briar",
        fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
        conversationId: reply.routing ? null : conversationId,
        attachments: lookupRounds === 0 && repairRounds === 0 &&
            repositoryRounds === 0
          ? downloadedAttachments.attachments
          : undefined,
        outputSchema: outputContract.jsonSchema,
        dmMessagePublicationBinding: messageInvocation?.binding(),
        dmMessageMcpServerPath,
        organizationContextManifestPath:
          organizationContext?.manifestPath ?? null,
        delegationTargets: reply.scope.kind === "workspace"
          ? reply.delegationTargets
          : undefined,
        skillCatalog: reply.session ? retainedSkillCatalog : undefined,
        environment: providerEnvironment,
        signal: signal,
        diagnosticContext: {
          runId: reply.runId,
          workId: reply.workId,
          workType: "channelReply",
        },
        onDiagnostic: (diagnostic) => {
          observeProviderDiagnostic(diagnostic);
          logDetachedProviderTurnDiagnostic(diagnostic);
        },
        onConversationId: async (nextConversationId) => {
          conversationId = reply.routing ? null : nextConversationId;
          reportCheckpoint?.({ conversationId: nextConversationId });
          if (reply.session) {
            const checkpoint = await workerQueue.checkpointChannelReplySession({
              projectId: project.id,
              workerId: registered.workerId,
              work: reply,
              conversationId: nextConversationId,
            });
            retainedUntil = checkpoint.retainedUntil;
            if (sessionWorktree) {
              await extendCachedAnalysisWorktreeRetention({
                root: worktreeRoot,
                runId: reply.session.id,
                retainedUntil,
              });
            } else if (!analysisWorktree) {
              await prepareWorkspaceAgentWorkspace(
                workspacePath,
                process.pid,
                { reuse: true, retainedUntil },
              );
            }
          }
        },
        onPayload: async (payload) => {
          /*
            The provider accepting this turn's thread is the end of the boot
            this pre-warm exists to shorten, and the first thing the setup
            account can be complete about.
          */
          if (payload.payload.case === "sessionStarted" && bootStartedAt !== null) {
            bootMs ??= performance.now() - bootStartedAt;
            logSetupOnce();
          }
          await executionContext?.observe(payload);
          activityPublisher.observePayload(payload);
          generatedImages.observePayload(payload);
        },
      }, (turnInput) => runtime.runProviderTurn(turnInput, roundPreparedRunner));
      logSetupOnce();
      assertDetachedProviderTurnSucceeded(turn);
      if (!turn.resultText) {
        throw new Error("Agent returned an empty channel reply");
      }
      let decodedTurn: ChannelAgentReplyTurn;
      try {
        decodedTurn = decodeReplyJson(turn.resultText);
      } catch (error) {
        timeline.endTurn("repair");
        turnPrompt = nextStructuredOutputRepairPrompt({
          error,
          rounds: repairRounds,
          basePrompt: prompt,
          conversationId: reply.routing ? null : turn.conversationId,
        });
        repairRounds += 1;
        conversationId = reply.routing ? null : turn.conversationId;
        continue;
      }
      if (decodedTurn.case === "reply") {
        timeline.endTurn("reply");
        result = decodedTurn.result;
        attachmentPaths = decodedTurn.attachmentPaths;
        break;
      }
      if (decodedTurn.case === "repository") {
        timeline.endTurn("repository");
        // The request is consumed here and never reported to the server: like
        // a context lookup, it is not a completion.
        if (!repositoryRequestAvailable) {
          throw new Error("repository_unavailable");
        }
        if (repositoryRounds >= 1) throw new Error("repository_budget_exhausted");
        repositoryRounds += 1;
        activityPublisher.publishProgress(
          `repository-${reply.workId}`,
          "저장소 확인 중",
        );
        await checkOutRepositoryOnDemand();
        prompt = buildPrompt();
        conversationId = reply.routing ? null : turn.conversationId;
        const continuation = [
          `Briar checked the project repository out at ${
            JSON.stringify(workspacePath)
          } for the reason you gave: ${
            JSON.stringify(decodedTurn.request.reason)
          }.`,
          "Inspect it and run the commands or tools you need there, then return the normal channel reply JSON. Local changes in this checkout are discarded after this reply, so project-changing work still belongs in a Briar issue proposal.",
          "The repository is available now; do not request it again.",
        ].join("\n\n");
        turnPrompt = conversationId
          ? continuation
          : [
            prompt,
            continuation,
            messageInvocation?.prompt(),
          ].filter(Boolean).join("\n\n");
        continue;
      }
      timeline.endTurn("context");
      if (!organizationContext) {
        /*
          A project Agent has no workspace context index, but the shared
          response shape still names contextRequests, and a question like "how
          many issues are open" tempts the model into asking for one. Failing
          the reply here cost the person three attempts and a generic error;
          say once what is and is not available and let the model answer.
        */
        if (contextRefused) {
          throw new Error(
            "Project reply cannot request workspace context",
          );
        }
        contextRefused = true;
        repairRounds += 1;
        conversationId = reply.routing ? null : turn.conversationId;
        const refusal = [
          "Workspace context lookups are not available to this reply: contextRequests must be null.",
          repositoryRequestAvailable && analysisWorktree === null
            ? "If the answer needs the project repository, return the repositoryRequest object instead."
            : null,
          "Otherwise return the normal channel reply JSON now, answering from the conversation and saying plainly what cannot be established from it.",
        ].filter(Boolean).join(" ");
        turnPrompt = conversationId
          ? refusal
          : [prompt, refusal, messageInvocation?.prompt()]
            .filter(Boolean).join("\n\n");
        continue;
      }
      if (lookupRounds >= 3) {
        throw new Error("Workspace Agent context lookup limit exceeded");
      }
      const hydrated = await hydrateWorkspaceAgentContext({
        apiUrl: config.apiUrl,
        workerToken,
        workspaceId: reply.workspaceId,
        workId: reply.workId,
        workerId: registered.workerId,
        claimToken: reply.claimToken,
        snapshotAt: reply.organizationContext!.snapshotAt,
        workspacePath,
        requests: decodedTurn.requests.contextRequests,
        signal: signal,
      });
      if (hydrated.loaded === 0) {
        throw new Error("Workspace Agent repeated a loaded context query");
      }
      lookupRounds += 1;
      conversationId = reply.routing ? null : turn.conversationId;
      const continuation = [
        `Briar loaded ${hydrated.loaded} requested workspace context file(s).`,
        `Re-read the manifest at ${JSON.stringify(hydrated.manifestPath)} and the newly referenced lookup files.`,
        "Use those facts to continue. Request another smallest-possible lookup only if essential; otherwise return the normal channel reply JSON now.",
      ].join("\n\n");
      turnPrompt = conversationId
        ? continuation
        : `${prompt}\n\n${continuation}\n${messageInvocation?.prompt() ?? ""}`;
    }
    if (!result) throw new Error("Agent returned no channel reply");
    const skillExecutionProposalAllowed =
      reply.skillExecutionTarget?.executionMode === "task" ||
      (reply.skillExecutionTarget?.executionMode === "conversation" &&
        reply.skillExecutionTarget.approvalPolicy === "explicit" &&
        !reply.skillExecutionTarget.approved);
    if (result.skillExecutionProposal && !skillExecutionProposalAllowed) {
      throw new Error(
        "Channel reply Agent Skill execution target is not authorized",
      );
    }
    // Read reply attachments before the disposable workspace disappears. Private
    // inbound context must still be gone before the durable reply completes.
    const replyAttachments = validateReplyAttachments([
      ...await collectChannelReplyAttachments({
        workspacePath,
        paths: attachmentPaths,
      }),
      ...generatedImages.files(),
    ], "Channel reply");
    await messageInvocation?.settle();
    const finalReceipt = await publishPlainDmFinal(
      messageInvocation,
      result,
      replyAttachments,
      signal,
    );
    await cleanupContext();
    const completion = await replyCompletion.completeChannelReply({
      projectId: project.id,
      workerId: registered.workerId,
      work: reply,
      outcome: {
        case: "success",
        conversationId,
        result: channelReplyIssueAttachmentDefaults(
          result,
          reply.triggerAttachments,
        ),
        attachments: replyAttachments,
        publishedFinalBatchId: finalReceipt?.batchId,
      },
      signal,
    });
    timeline.recordCompletion(completion.disposition);
    retainedUntil = completion.retainedUntil;
    publicationTerminal = completion.disposition === "completed";
  } catch (error) {
    if (error instanceof DetachedProviderStopUnconfirmedError && reply.routing && reply.session) {
      // Retain the local stop fence even if the Worker cannot report it to D1.
      await writeFile(join(workspacePath, ".briar-stop-unconfirmed"), "provider_stop_unconfirmed\n", { flag: "wx" })
        .catch(() => undefined);
    }
    if (
      !dmReplyRedacted(reply, memoryVault?.scopeKind) ||
      error instanceof DetachedProviderBlockedError || error instanceof DetachedProviderStopUnconfirmedError
    ) throw error;
    throw dmReplyRedactedError(error);
  } finally {
    startedChannelReplyTurns.delete(reply.workId);
    // A pre-warmed process must never outlive the reply that started it, on
    // any path: used, replaced by a cold spawn, or never reached at all.
    await preparedRunner?.discard("reply_finished");
    logSetupOnce();
    await closeMemoryVault(memoryVault);
    await messageInvocation?.cleanup({ terminal: publicationTerminal });
    activityPublisher.stop();
    if (activeReplyActivityPublishers.get(reply.workId) === activityPublisher) {
      activeReplyActivityPublishers.delete(reply.workId);
    }
    try {
      await cleanupContext();
    } finally {
      if (sessionWorktree && sessionWorktreePath && reply.session) {
        try {
          await markCachedAnalysisWorktreeIdle({
            root: worktreeRoot,
            runId: reply.session.id,
            worktree: sessionWorktree,
            retainedUntil: retainedUntil ?? reply.session.retainedUntil,
          });
        } catch (error) {
          console.error(
            `channel session worktree retention update failed for ${reply.session.id}: ${
              dmReplyRedacted(reply, memoryVault?.scopeKind)
                ? dmReplyRedactedError(error).message
                : error instanceof Error ? error.message : String(error)
            } | ${replyErrorDiagnostic(error)}`,
          );
        } finally {
          releaseCachedAnalysisWorktree(sessionWorktreePath);
        }
      } else if (!analysisWorktree && reply.session && retainedUntil) {
        await prepareWorkspaceAgentWorkspace(workspacePath, 0, {
          reuse: true,
          retainedUntil,
        });
      }
    }
  }
}

/**
 * What a failed reply tells Briar, and what this Worker logs beside it. A
 * person's DM reports only a fixed code — the message can echo the
 * conversation, recalled memory or the prompt (`dm-reply-redaction.ts`) — so
 * the diagnostic is the operator's only account of what actually broke; it
 * carries the failure's shape and never its text. A provider block reports its
 * own (headline-only in a DM) block instead of a message.
 */
export function channelReplyFailureReport(
  error: unknown,
  reply: Pick<ClaimedChannelReply, "directMessage">,
) {
  const message = error instanceof Error ? error.message : String(error);
  const redacted = dmReplyRedacted(reply);
  const block = detachedProviderBlockOf(error);
  return {
    reported: redacted && !block ? dmReplyRedactedError(error).message : message,
    // A block names the provider and its reason; in a DM its message is
    // reduced to the headline, which cannot echo the conversation.
    block: block && redacted ? dmSafeProviderBlock(block) : block,
    diagnostic: replyErrorDiagnostic(error),
  };
}

async function failClaimedChannelReply(
  config: Config,
  project: TeamConfig,
  reply: ClaimedChannelReply,
  workerToken: string,
  error: unknown,
) {
  const workerId = project.executionWorker?.workerId;
  if (!workerId) throw error;
  const { reported, block, diagnostic } = channelReplyFailureReport(error, reply);
  console.error(
    `channel reply ${reply.workId} failed: ${reported} | ${diagnostic}`,
  );
  const completion = await createReplyCompletionClient(config.apiUrl, workerToken)
    .completeChannelReply({
      projectId: project.id,
      workerId,
      work: reply,
      outcome: {
        case: "failure",
        error: reported,
        ...(block ? { block } : {}),
      },
    });
  // Whether this failure ends the job or hands it back to the queue is the
  // server's answer, and it arrives only here: the timeline waits for it.
  settleChannelReplyTimelineOutcome(
    reply.workId,
    completion.disposition === "requeued" ? "requeued" : "failed",
  );
}

export {
  runClaimedProjectAgentTask,
  runClaimedIssueReply,
  failClaimedIssueReply,
  runClaimedChannelReply,
  failClaimedChannelReply,
};
