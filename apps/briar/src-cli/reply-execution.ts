import {
  providerBlockHeadline,
  type ProviderBlock,
} from "../src/lib/provider-block";
import {
  mkdtemp,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DmMemoryInvocation,
  dmMemoryExecutionError,
} from "./dm-memory-invocation";
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
  assertDetachedProviderTurnSucceeded,
  detachedProviderBlockOf,
  logDetachedProviderTurnDiagnostic,
  runDetachedProviderTurn,
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
  workerExecutionPath,
  type WorkerExecutionCheckpoint,
} from "./worker";
import {
  allocateAnalysisWorktree,
  allocateCachedAnalysisWorktree,
  analysisWorktreePath,
  extendCachedAnalysisWorktreeRetention,
  findExistingIssueWorktree,
  issueReplyWorkspaceMode,
  markCachedAnalysisWorktreeIdle,
  projectWorktreeRoot,
  removeAnalysisWorktree,
} from "./worktree";
import {
  collectChannelReplyAttachments,
} from "./channel-reply-attachments";
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
import { assertChannelReplyWorkspaceScope } from "./channel-reply-scope";
import {
  cleanupOrganizationAgentContext,
  downloadOrganizationAgentContextManifest,
  hydrateOrganizationAgentContext,
  prepareOrganizationAgentWorkspace,
} from "./organization-agent-context";
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
import { downloadClaimAttachment } from "./worktree-commands";
import {
  activeReplyActivityPublishers,
  retainCachedAnalysisWorktree,
  releaseCachedAnalysisWorktree,
  detachedAgentWithActiveSkill,
  detachedReplyAgent,
} from "./issue-execution";

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
  } = {
    allocateWorktree: allocateAnalysisWorktree,
    removeWorktree: removeAnalysisWorktree,
    runProviderTurn: runDetachedProviderTurn,
    git: runGit,
  },
) {
  const organizationId = project.executionWorker?.organizationId;
  if (!organizationId) throw new Error("Worker registration is missing");
  const worktree = await runtime.allocateWorktree({
    repositoryPath: project.repositoryPath,
    projectId: project.id,
    workId: task.workId,
    settings: worktreeSettings(project),
    git: runtime.git,
  });
  let taskError: unknown;
  try {
    const workspacePath = worktree.path;
    reportCheckpoint?.({ workspacePath });
    const agent: DetachedAgent = {
      ...detachedAgentWithActiveSkill(task.agent, task.activeSkill),
      scope: { kind: "project", organizationId, projectId: project.id },
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
        return await runtime.runProviderTurn({
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
        });
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
  const cleanupContext = () =>
    cleanupChannelReplyResources([
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
        organizationId: registered.organizationId,
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
        return await runDetachedProviderTurn({
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
        });
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

async function runClaimedChannelReply(
  config: Config,
  project: TeamConfig,
  reply: ClaimedChannelReply,
  workerToken: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
  runtime: {
    runProviderTurn: typeof runDetachedProviderTurn;
    workspaceRoot: string;
  } = {
    runProviderTurn: runDetachedProviderTurn,
    workspaceRoot: configDirectory,
  },
) {
  const registered = project.executionWorker;
  if (!registered) throw new Error("Worker registration is missing");
  assertChannelReplyWorkspaceScope(reply, project.id);
  const settings = worktreeSettings(project);
  const worktreeRoot = projectWorktreeRoot(settings.root, project.id);
  const sessionWorktreePath = reply.projectId && reply.session
    ? analysisWorktreePath(settings.root, project.id, reply.session.id)
    : null;
  let sessionWorktree:
    | Awaited<ReturnType<typeof allocateCachedAnalysisWorktree>>
    | null = null;
  if (sessionWorktreePath) {
    retainCachedAnalysisWorktree(sessionWorktreePath);
    try {
      sessionWorktree = await allocateCachedAnalysisWorktree({
        repositoryPath: project.repositoryPath,
        projectId: project.id,
        runId: reply.session!.id,
        settings,
        git: runGit,
        retainedUntil: reply.session!.retainedUntil,
      });
    } catch (error) {
      releaseCachedAnalysisWorktree(sessionWorktreePath);
      throw error;
    }
  }
  const analysisWorktree = reply.projectId
    ? sessionWorktree ?? await allocateAnalysisWorktree({
        repositoryPath: project.repositoryPath,
        projectId: project.id,
        workId: reply.workId,
        settings,
        git: runGit,
      })
    : null;
  let retainedUntil = reply.session?.retainedUntil ?? null;
  const workspacePath =
    analysisWorktree?.path ??
    join(
      runtime.workspaceRoot,
      "worker-sessions",
      `channel-${reply.session?.id ?? reply.workId}`,
    );
  if (reply.session) {
    console.log(`channel reply session: ${JSON.stringify({
      sessionId: reply.session.id,
      channelId: reply.channelId,
      threadId: reply.session.threadId,
      agentId: reply.agent.id,
      claimReason: reply.session.claimReason,
      workspaceReused: sessionWorktree?.reused ?? false,
      retainedUntil,
    })}`);
  }
  reportCheckpoint?.({ workspacePath });
  if (!analysisWorktree) {
    // A prior hard-killed attempt may have left a path behind. Recreate the
    // exact claim workspace so stale files or a planted symlink cannot become
    // trusted Organization Agent context.
    await prepareOrganizationAgentWorkspace(workspacePath, process.pid, {
      reuse: Boolean(reply.session),
      retainedUntil: retainedUntil ?? undefined,
    });
  }
  const attachmentDirectory = channelReplyAttachmentDirectory(workspacePath);
  const memoryAbort = new AbortController();
  const invocationSignal = AbortSignal.any([signal, memoryAbort.signal]);
  let memoryInvocation: DmMemoryInvocation | null = null;
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
  const activityPublisher = new ChannelActivityPublisher({
    credential: reply.activity,
    send: async (credential, activity) => {
      try {
        await memoryInvocation?.check(false);
      } catch (error) {
        memoryAbort.abort();
        await memoryInvocation?.cleanup();
        throw error;
      }
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
          reply.memory
            ? dmMemoryExecutionError(error).message
            : error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  activeReplyActivityPublishers.set(reply.workId, activityPublisher);
  const cleanupContext = () =>
    cleanupChannelReplyResources([
      {
        label: "private DM memory",
        run: async () => memoryInvocation?.cleanup(),
      },
      ...(reply.scope.kind === "organization"
        ? [{
            label: "organization context",
            run: async () => {
              if (organizationContextCleaned) return;
              await cleanupOrganizationAgentContext(workspacePath);
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
              if (analysisWorktree) {
                await removeAnalysisWorktree({
                  repositoryPath: project.repositoryPath,
                  path: analysisWorktree.path,
                  git: runGit,
                });
              } else {
                await rm(workspacePath, { recursive: true, force: true });
              }
              workspaceCleaned = true;
            },
          }]
        : []),
    ]);
  try {
    if (reply.memory) {
      memoryInvocation = await DmMemoryInvocation.create({
        queue: workerQueueClient,
        projectId: project.id,
        workerId: registered.workerId,
        work: reply,
        memory: reply.memory,
        signal: invocationSignal,
      });
    }
    const organizationContext = reply.scope.kind === "organization"
      ? await downloadOrganizationAgentContextManifest({
          apiUrl: config.apiUrl,
          workerToken,
          organizationId: reply.organizationId,
          workId: reply.workId,
          workerId: registered.workerId,
          claimToken: reply.claimToken,
          snapshotAt: reply.organizationContext!.snapshotAt,
          workspacePath,
          signal: invocationSignal,
        })
      : null;
    const downloadedAttachments = await downloadChannelReplyAttachments({
      apiUrl: config.apiUrl,
      workerToken,
      organizationId: reply.organizationId,
      workId: reply.workId,
      claimToken: reply.claimToken,
      triggerAttachments: reply.triggerAttachments,
      workspacePath,
    });
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
    const outputContract = providerStructuredOutputContract(
      agent.provider,
      ChannelAgentReplyProviderOutputSchema,
    );
    // A retained channel session resumes the same provider conversation across
    // replies. Keep its Skill catalog at a stable workspace path for that
    // conversation; workspace/session TTL cleanup owns its eventual removal.
    const retainedSkillCatalog = reply.session
      ? await materializeDetachedAgentSkillCatalog(agent, {
          temporaryParentPath: workspacePath,
          lifetime: "retained-conversation",
        })
      : null;
    const prompt = detachedChannelReplyPrompt({
      agent,
      snapshot: {
        ...reply.snapshot,
        downloadedImagePaths: downloadedAttachments.imagePaths,
        downloadedFilePaths: downloadedAttachments.filePaths,
      },
      workspaceAvailable: Boolean(analysisWorktree),
      organizationContextAvailable: organizationContext !== null,
      memoryLearningAvailable: reply.memoryLearningEnabled,
      delegationTargets: reply.delegationTargets,
      delegation: reply.delegation,
      skillExecutionTarget: reply.skillExecutionTarget,
    });
    let conversationId: string | null =
      reply.session?.conversationId ?? reply.handoffContext?.conversationId ?? null;
    if (conversationId) reportCheckpoint?.({ conversationId });
    let lookupRounds = 0;
    let repairRounds = 0;
    const decodeReplyJson = repairableDecoder(outputContract.decodeJson);
    let turnPrompt = [prompt, memoryInvocation?.prompt()]
      .filter(Boolean)
      .join("\n\n");
    let result: ParsedChannelReplyAgentResult["result"] | null = null;
    let attachmentPaths: string[] = [];
    const generatedImages = new ReplyGeneratedImageCollector();
    while (!result) {
      const currentMemoryInvocation = memoryInvocation;
      if (currentMemoryInvocation && await currentMemoryInvocation.check()) {
        conversationId = null;
        turnPrompt = [
          prompt,
          currentMemoryInvocation.prompt(),
          organizationContext
            ? "Re-read the organization context manifest for previously loaded context."
            : null,
        ].filter(Boolean).join("\n\n");
      }
      const turn = await runtime.runProviderTurn({
        agent,
        prompt: turnPrompt,
        workspacePath,
        fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
        conversationId,
        attachments: lookupRounds === 0 && repairRounds === 0
          ? downloadedAttachments.attachments
          : undefined,
        outputSchema: outputContract.jsonSchema,
        organizationContextManifestPath:
          organizationContext?.manifestPath ?? null,
        delegationTargets: reply.scope.kind === "organization"
          ? reply.delegationTargets
          : undefined,
        skillCatalog: reply.session ? retainedSkillCatalog : undefined,
        environment: providerExecutionEnvironment(config, agent.provider, {
          ...process.env,
          PATH: workerExecutionPath(),
          BRIAR_CLI: workerCliPath(),
          BRIAR_WORKER_TOKEN: workerToken,
          BRIAR_TEAM_ID: project.id,
        }),
        signal: invocationSignal,
        diagnosticContext: {
          runId: reply.runId,
          workId: reply.workId,
          workType: "channelReply",
        },
        onDiagnostic: (diagnostic) => {
          if (!reply.memory) {
            logDetachedProviderTurnDiagnostic(diagnostic);
            return;
          }
          if (
            ["turn.started", "turn.completed", "turn.aborted_before_start"]
              .includes(diagnostic.phase)
          ) {
            logDetachedProviderTurnDiagnostic({
              at: diagnostic.at,
              phase: diagnostic.phase,
              context: { workId: reply.workId, workType: "channelReply" },
            });
          }
        },
        onConversationId: async (nextConversationId) => {
          conversationId = nextConversationId;
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
              await prepareOrganizationAgentWorkspace(
                workspacePath,
                process.pid,
                { reuse: true, retainedUntil },
              );
            }
          }
        },
        onPayload: (payload) => {
          activityPublisher.observePayload(payload);
          generatedImages.observePayload(payload);
        },
      });
      assertDetachedProviderTurnSucceeded(turn);
      if (!turn.resultText) {
        throw new Error("Agent returned an empty channel reply");
      }
      let decodedTurn: ChannelAgentReplyTurn;
      try {
        decodedTurn = decodeReplyJson(turn.resultText);
      } catch (error) {
        turnPrompt = nextStructuredOutputRepairPrompt({
          error,
          rounds: repairRounds,
          basePrompt: prompt,
          conversationId: turn.conversationId,
        });
        repairRounds += 1;
        conversationId = turn.conversationId;
        continue;
      }
      if (decodedTurn.case === "reply") {
        result = decodedTurn.result;
        if (result.memorySaveRequest && !reply.memoryLearningEnabled) {
          throw new Error("memory_learning_unavailable");
        }
        attachmentPaths = decodedTurn.attachmentPaths;
        break;
      }
      if (decodedTurn.case === "memory") {
        if (!memoryInvocation) throw new Error("memory_unavailable");
        if (lookupRounds >= 3) throw new Error("lookup_budget_exhausted");
        const memoryPrompt = await memoryInvocation.lookup(decodedTurn.request);
        lookupRounds += 1;
        conversationId = turn.conversationId;
        const continuation =
          `The memory lookup is complete. Use only supported evidence and return the next structured result.\n${memoryPrompt}`;
        turnPrompt = conversationId
          ? continuation
          : `${prompt}\n\n${continuation}`;
        continue;
      }
      if (!organizationContext) {
        throw new Error(
          "Project reply cannot request organization context",
        );
      }
      if (lookupRounds >= 3) {
        throw new Error("Organization Agent context lookup limit exceeded");
      }
      const hydrated = await hydrateOrganizationAgentContext({
        apiUrl: config.apiUrl,
        workerToken,
        organizationId: reply.organizationId,
        workId: reply.workId,
        workerId: registered.workerId,
        claimToken: reply.claimToken,
        snapshotAt: reply.organizationContext!.snapshotAt,
        workspacePath,
        requests: decodedTurn.requests.contextRequests,
        signal: invocationSignal,
      });
      if (hydrated.loaded === 0) {
        throw new Error("Organization Agent repeated a loaded context query");
      }
      lookupRounds += 1;
      conversationId = turn.conversationId;
      const continuation = [
        `Briar loaded ${hydrated.loaded} requested organization context file(s).`,
        `Re-read the manifest at ${JSON.stringify(hydrated.manifestPath)} and the newly referenced lookup files.`,
        "Use those facts to continue. Request another smallest-possible lookup only if essential; otherwise return the normal channel reply JSON now.",
      ].join("\n\n");
      turnPrompt = conversationId
        ? continuation
        : `${prompt}\n\n${continuation}\n${memoryInvocation?.prompt() ?? ""}`;
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
    await memoryInvocation?.check(false);
    await cleanupContext();
    const completion = await replyCompletion.completeChannelReply({
      projectId: project.id,
      workerId: registered.workerId,
      work: reply,
      outcome: {
        case: "success",
        conversationId,
        result,
        attachments: replyAttachments,
      },
      signal,
    });
    retainedUntil = completion.retainedUntil;
  } catch (error) {
    if (!reply.memory || error instanceof DetachedProviderBlockedError) throw error;
    throw dmMemoryExecutionError(error);
  } finally {
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
              reply.memory
                ? dmMemoryExecutionError(error).message
                : error instanceof Error ? error.message : String(error)
            }`,
          );
        } finally {
          releaseCachedAnalysisWorktree(sessionWorktreePath);
        }
      } else if (!analysisWorktree && reply.session && retainedUntil) {
        await prepareOrganizationAgentWorkspace(workspacePath, 0, {
          reuse: true,
          retainedUntil,
        });
      }
    }
  }
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
  const block = detachedProviderBlockOf(error);
  await createReplyCompletionClient(config.apiUrl, workerToken)
    .completeChannelReply({
      projectId: project.id,
      workerId,
      work: reply,
      outcome: {
        case: "failure",
        error: block
          ? error instanceof Error ? error.message : String(error)
          : reply.memory
            ? dmMemoryExecutionError(error).message
            : error instanceof Error ? error.message : String(error),
        // A block names the provider and its reason, never the DM content,
        // so the memory privacy fence keeps it.
        ...(block ? { block: reply.memory ? dmSafeProviderBlock(block) : block } : {}),
      },
    });
}

/** Keep the reason and provider; drop provider text that could echo a prompt. */
function dmSafeProviderBlock(block: ProviderBlock): ProviderBlock {
  return {
    ...block,
    message: providerBlockHeadline(block),
  };
}

export {
  runClaimedProjectAgentTask,
  runClaimedIssueReply,
  failClaimedIssueReply,
  runClaimedChannelReply,
  failClaimedChannelReply,
};
