import { Buffer } from "node:buffer";
import {
  mkdtemp,
  mkdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeOrganizationAgentContextRequestTurn } from "../src/lib/organization-agent-context-contract";
import {
  createDetachedTranscriptSequencer,
  detachedChannelReplyPrompt,
  detachedChannelReplyOutputSchema,
  detachedIssueReplyPrompt,
  detachedIssueReplyOutputSchema,
  detachedProjectAgentPrompt,
  detachedPayloadDirection,
  detachedTranscriptPayload,
  parseDetachedIssueReplyResult,
  parseDetachedJsonResult,
  shouldPersistDetachedTranscriptPayload,
  type DetachedAgent,
} from "./agent-runner";
import { agentImageAttachments } from "../src-agent/runner-attachments";
import {
  assertDetachedProviderTurnSucceeded,
  runDetachedProviderTurn,
} from "./detached-provider-turn";
import { TranscriptBatcher } from "./transcript-batcher";
import { ChannelActivityPublisher } from "./channel-activity-publisher";
import {
  workerCliPath,
  workerExecutionPath,
  type WorkerExecutionCheckpoint,
} from "./worker";
import {
  allocateAnalysisWorktree,
  allocateCachedAnalysisWorktree,
  analysisWorktreePath,
  findExistingIssueWorktree,
  issueReplyWorkspaceMode,
  markCachedAnalysisWorktreeIdle,
  projectWorktreeRoot,
  removeAnalysisWorktree,
} from "./worktree";
import {
  channelReplyCompleteRequestBody,
  collectChannelReplyAttachments,
  parseChannelReplyAgentResult,
} from "./channel-reply-attachments";
import {
  channelReplyImageDirectory,
  cleanupChannelReplyImages,
  downloadChannelReplyImages,
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
  type ProjectConfig,
} from "./config-contract";
import {
  type ClaimedChannelReply,
  type ClaimedIssueReply,
  type ClaimedProjectAgentTask,
} from "./worker-claim-contract";
import {
  providerExecutionEnvironment,
  configDirectory,
  value,
  has,
  required,
  request,
  serializeTranscriptRequest,
  isTranscriptPayloadTooLarge,
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
  project: ProjectConfig,
  task: ClaimedProjectAgentTask,
  workerToken: string,
  workerId: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const workspacePath = project.repositoryPath;
  reportCheckpoint?.({ workspacePath });
  const organizationId = project.executionWorker?.organizationId;
  if (!organizationId) throw new Error("Worker registration is missing");
  const agent: DetachedAgent = {
    ...detachedAgentWithActiveSkill(task.agent, task.activeSkill),
    scope: { kind: "project", organizationId, projectId: project.id },
  };
  const prompt = detachedProjectAgentPrompt({
    agent,
    request: task.request,
    workspacePath,
  });
  const transcriptSequencer = createDetachedTranscriptSequencer(
    task.claimAttempts,
  );
  // Direct Agent tasks are not Hunt runs. Their task/session UUID is the
  // durable transcript key, while attempt-scoped sequence ranges make Worker
  // retries append safely without requiring a Hunt-run binding.
  const transcriptEnvelope = {
    projectId: project.id,
    sessionId: task.workId,
    workType: "projectAgentTask" as const,
    workId: task.workId,
    claimToken: task.claimToken,
    workerId,
    agentProvider: agent.provider,
  };
  const transcriptBatcher = new TranscriptBatcher({
    send: async (events) => {
      await request(config.apiUrl, "/transcripts", workerToken, {
        method: "POST",
        body: serializeTranscriptRequest(transcriptEnvelope, events),
      });
    },
    measureBytes: (events) =>
      Buffer.byteLength(
        serializeTranscriptRequest(transcriptEnvelope, events),
        "utf8",
      ),
    isPayloadTooLarge: isTranscriptPayloadTooLarge,
    onError: (error) => {
      console.error(
        `transcript upload failed for ${task.sourceKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  let conversationId: string | null = task.handoffContext?.conversationId ?? null;
  if (conversationId) reportCheckpoint?.({ conversationId });
  const turn = await (async () => {
    try {
      return await runDetachedProviderTurn({
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
          BRIAR_PROJECT_ID: project.id,
        }),
        signal,
        onConversationId: (nextConversationId) => {
          conversationId = nextConversationId;
          reportCheckpoint?.({ conversationId: nextConversationId });
        },
        onPayload: async (rawPayload, line) => {
          const payload = detachedTranscriptPayload(rawPayload, line);
          const sequence = transcriptSequencer.nextForPayload(payload);
          if (sequence === null) return;
          await transcriptBatcher.enqueue({
            sequence,
            direction: detachedPayloadDirection(rawPayload),
            payload,
          });
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
}

async function completeClaimedProjectAgentTask(
  config: Config,
  task: ClaimedProjectAgentTask,
  workerToken: string,
  completion: {
    projectId: string;
    workerId: string;
    claimToken: string;
    summary: string;
    conversationId: string | null;
  },
  signal: AbortSignal,
) {
  await request(
    config.apiUrl,
    `/agent-task-claims/${task.workId}/complete`,
    workerToken,
    {
      method: "POST",
      signal,
      body: JSON.stringify(completion),
    },
  );
}

async function failClaimedProjectAgentTask(
  config: Config,
  project: ProjectConfig,
  task: ClaimedProjectAgentTask,
  workerToken: string,
  error: unknown,
) {
  const workerId = project.executionWorker?.workerId;
  if (!workerId) throw error;
  await request(
    config.apiUrl,
    `/agent-task-claims/${task.workId}/complete`,
    workerToken,
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        workerId,
        claimToken: task.claimToken,
        error: error instanceof Error ? error.message : String(error),
      }),
    },
  );
}

async function runClaimedIssueReply(
  config: Config,
  project: ProjectConfig,
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
    branch: issue.branch,
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
  const activityPublisher = new ChannelActivityPublisher({
    credential: issue.activity,
    send: async (credential, input) => {
      await request(
        config.apiUrl,
        `/issue-reply-claims/${issue.workId}/activity`,
        null,
        {
          method: "POST",
          headers: {
            "X-Briar-Channel-Activity-Token": credential.token,
          },
          body: JSON.stringify(input),
        },
      );
    },
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
        label: "issue reply images",
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
      snapshot: issue.snapshot,
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
    let sequence = 0;
    const transcriptEnvelope = {
      projectId: project.id,
      sessionId: `reply-${issue.workId}`,
      runId: issue.runId,
      workType: "issueReply" as const,
      workId: issue.workId,
      claimToken: issue.claimToken,
      workerId: registered.workerId,
      agentProvider: provider,
    };
    const transcriptBatcher = new TranscriptBatcher({
      send: async (events) => {
        await request(config.apiUrl, "/transcripts", workerToken, {
          method: "POST",
          body: serializeTranscriptRequest(transcriptEnvelope, events),
        });
      },
      measureBytes: (events) =>
        Buffer.byteLength(
          serializeTranscriptRequest(transcriptEnvelope, events),
          "utf8",
        ),
      isPayloadTooLarge: isTranscriptPayloadTooLarge,
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
    const turn = await (async () => {
      try {
        return await runDetachedProviderTurn({
          agent,
          prompt,
          workspacePath,
          fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
          attachments,
          conversationId,
          outputSchema: detachedIssueReplyOutputSchema,
          environment: providerExecutionEnvironment(config, agent.provider, {
            ...process.env,
            PATH: workerExecutionPath(),
            BRIAR_CLI: workerCliPath(),
            BRIAR_WORKER_TOKEN: workerToken,
            BRIAR_PROJECT_ID: project.id,
          }),
          signal,
          onConversationId: (nextConversationId) => {
            conversationId = nextConversationId;
            reportCheckpoint?.({ conversationId: nextConversationId });
          },
          onPayload: async (payload, line) => {
            activityPublisher.observePayload(payload);
            sequence += 1;
            const direction = detachedPayloadDirection(payload);
            const bounded = detachedTranscriptPayload(payload, line);
            if (shouldPersistDetachedTranscriptPayload(bounded)) {
              await transcriptBatcher.enqueue({
                sequence,
                direction,
                payload: bounded,
              });
            }
          },
        });
      } finally {
        // The durable reply result remains more important than optional
        // transcript data, but buffered events must get one final send chance.
        await transcriptBatcher.flush();
      }
    })();
    assertDetachedProviderTurnSucceeded(turn);
    if (!turn.resultText) throw new Error("Agent returned an empty issue reply");
    const result = parseDetachedIssueReplyResult(turn.resultText, {
      allowSkillExecutionProposal: issue.skillExecutionTarget !== null,
    });
    if (!result.reply) throw new Error("Agent returned an empty issue reply");
    // Private downloaded images must be removed before the durable reply
    // succeeds. Worktree cache bookkeeping is best-effort in the outer cleanup.
    await cleanupContext();
    await request(
      config.apiUrl,
      `/issue-reply-claims/${issue.workId}/complete`,
      workerToken,
      {
        method: "POST",
        body: JSON.stringify({
          projectId: project.id,
          workerId: registered.workerId,
          claimToken: issue.claimToken,
          body: result.reply,
          proposedAction: result.proposedAction,
          executionProposal: result.executionProposal,
          skillExecutionProposal: result.skillExecutionProposal,
        }),
      },
    );
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
  project: ProjectConfig,
  issue: ClaimedIssueReply,
  workerToken: string,
  error: unknown,
) {
  const workerId = project.executionWorker?.workerId;
  if (!workerId) throw error;
  await request(
    config.apiUrl,
    `/issue-reply-claims/${issue.workId}/complete`,
    workerToken,
    {
      method: "POST",
      body: JSON.stringify({
        projectId: project.id,
        workerId,
        claimToken: issue.claimToken,
        error: error instanceof Error ? error.message : String(error),
      }),
    },
  );
}

async function runClaimedChannelReply(
  config: Config,
  project: ProjectConfig,
  reply: ClaimedChannelReply,
  workerToken: string,
  signal: AbortSignal,
  reportCheckpoint?: (value: WorkerExecutionCheckpoint) => void,
) {
  const registered = project.executionWorker;
  if (!registered) throw new Error("Worker registration is missing");
  assertChannelReplyWorkspaceScope(reply, project.id);
  const analysisWorktree = reply.projectId
    ? await allocateAnalysisWorktree({
        repositoryPath: project.repositoryPath,
        projectId: project.id,
        workId: reply.workId,
        settings: worktreeSettings(project),
        git: runGit,
      })
    : null;
  const workspacePath =
    analysisWorktree?.path ??
    join(configDirectory, "worker-sessions", `channel-${reply.workId}`);
  reportCheckpoint?.({ workspacePath });
  if (!analysisWorktree) {
    // A prior hard-killed attempt may have left a path behind. Recreate the
    // exact claim workspace so stale files or a planted symlink cannot become
    // trusted Organization Agent context.
    await prepareOrganizationAgentWorkspace(workspacePath);
  }
  const imageDirectory = channelReplyImageDirectory(workspacePath);
  let organizationContextCleaned = false;
  let imagesCleaned = false;
  let workspaceCleaned = false;
  let lastActivityErrorAt = Number.NEGATIVE_INFINITY;
  const activityPublisher = new ChannelActivityPublisher({
    credential: reply.activity,
    send: async (credential, input) => {
      await request(
        config.apiUrl,
        `/channel-reply-claims/${reply.workId}/activity`,
        null,
        {
          method: "POST",
          headers: {
            "X-Briar-Channel-Activity-Token": credential.token,
          },
          body: JSON.stringify(input),
        },
      );
    },
    onError: (error) => {
      const now = Date.now();
      if (now - lastActivityErrorAt < 60_000) return;
      lastActivityErrorAt = now;
      console.error(
        `channel activity publish failed for ${reply.workId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    },
  });
  activeReplyActivityPublishers.set(reply.workId, activityPublisher);
  const cleanupContext = () =>
    cleanupChannelReplyResources([
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
        label: "channel images",
        run: async () => {
          if (imagesCleaned) return;
          await cleanupChannelReplyImages(imageDirectory);
          imagesCleaned = true;
        },
      },
      {
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
      },
    ]);
  try {
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
          signal,
        })
      : null;
    const downloadedImages = await downloadChannelReplyImages({
      apiUrl: config.apiUrl,
      workerToken,
      organizationId: reply.organizationId,
      workId: reply.workId,
      claimToken: reply.claimToken,
      triggerMessageId: reply.triggerMessageId,
      snapshot: reply.snapshot,
      workspacePath,
    });
    const agent = detachedReplyAgent({
      workId: reply.workId,
      provider: reply.provider,
      model: reply.model,
      effort: reply.effort,
      agent: reply.agent,
      activeSkill: reply.activeSkill,
      snapshot: reply.snapshot,
      fallbackName: "Briar Channel",
      scope: reply.scope,
    });
    const prompt = detachedChannelReplyPrompt({
      agent,
      snapshot: {
        ...reply.snapshot,
        downloadedImagePaths: downloadedImages.paths,
      },
      workspaceAvailable: Boolean(analysisWorktree),
      organizationContextAvailable: organizationContext !== null,
      delegationTargets: reply.delegationTargets,
      delegation: reply.delegation,
      skillExecutionTarget: reply.skillExecutionTarget,
    });
    let conversationId: string | null = reply.handoffContext?.conversationId ?? null;
    if (conversationId) reportCheckpoint?.({ conversationId });
    let lookupRounds = 0;
    let turnPrompt = prompt;
    let result: ReturnType<typeof parseChannelReplyAgentResult>["result"] | null =
      null;
    let attachmentPaths: string[] = [];
    while (!result) {
      const turn = await runDetachedProviderTurn({
        agent,
        prompt: turnPrompt,
        workspacePath,
        fullAccess: project.autoHunt?.sandbox?.fullAccess ?? true,
        conversationId,
        attachments: lookupRounds === 0
          ? downloadedImages.attachments
          : undefined,
        outputSchema: detachedChannelReplyOutputSchema,
        organizationContextManifestPath:
          organizationContext?.manifestPath ?? null,
        delegationTargets: reply.scope.kind === "organization"
          ? reply.delegationTargets
          : undefined,
        environment: providerExecutionEnvironment(config, agent.provider, {
          ...process.env,
          PATH: workerExecutionPath(),
          BRIAR_CLI: workerCliPath(),
          BRIAR_WORKER_TOKEN: workerToken,
          BRIAR_PROJECT_ID: project.id,
        }),
        signal,
        onConversationId: (nextConversationId) => {
          conversationId = nextConversationId;
          reportCheckpoint?.({ conversationId: nextConversationId });
        },
        onPayload: (payload) => {
          activityPublisher.observePayload(payload);
        },
      });
      assertDetachedProviderTurnSucceeded(turn);
      if (!turn.resultText) {
        throw new Error("Agent returned an empty channel reply");
      }
      const parsed = parseDetachedJsonResult(turn.resultText);
      const parsedRecord = parsed && typeof parsed === "object" &&
          !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : null;
      const contextRequests = parsedRecord?.contextRequests;
      if (contextRequests === null || contextRequests === undefined) {
        const parsedResult = parseChannelReplyAgentResult(parsed);
        result = parsedResult.result;
        attachmentPaths = parsedResult.attachmentPaths;
        break;
      }
      const lookup = decodeOrganizationAgentContextRequestTurn({
        contextRequests,
      });
      if (
        parsedRecord?.body !== null ||
        !Array.isArray(parsedRecord.attachments) ||
        parsedRecord.attachments.length !== 0 ||
        parsedRecord.document !== null ||
        parsedRecord.issueProposal !== null ||
        parsedRecord.executionProposal !== null ||
        parsedRecord.skillExecutionProposal !== null ||
        parsedRecord.delegation !== null
      ) {
        throw new Error(
          "Organization context lookup cannot include a channel reply or proposal",
        );
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
        requests: lookup.contextRequests,
        signal,
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
      turnPrompt = conversationId ? continuation : `${prompt}\n\n${continuation}`;
    }
    if (!result) throw new Error("Agent returned no channel reply");
    if (result.skillExecutionProposal && !reply.skillExecutionTarget) {
      throw new Error(
        "Channel reply Agent Skill execution target is not authorized",
      );
    }
    // Read reply images before the disposable workspace disappears. Private
    // inbound context must still be gone before the durable reply completes.
    const replyImages = await collectChannelReplyAttachments({
      workspacePath,
      paths: attachmentPaths,
    });
    await cleanupContext();
    await request(
      config.apiUrl,
      `/channel-reply-claims/${reply.workId}/complete`,
      workerToken,
      {
        method: "POST",
        body: channelReplyCompleteRequestBody({
          organizationId: reply.organizationId,
          workerId: registered.workerId,
          claimToken: reply.claimToken,
          result,
          attachments: replyImages,
        }),
      },
    );
  } finally {
    activityPublisher.stop();
    if (activeReplyActivityPublishers.get(reply.workId) === activityPublisher) {
      activeReplyActivityPublishers.delete(reply.workId);
    }
    await cleanupContext();
  }
}

async function failClaimedChannelReply(
  config: Config,
  project: ProjectConfig,
  reply: ClaimedChannelReply,
  workerToken: string,
  error: unknown,
) {
  const workerId = project.executionWorker?.workerId;
  if (!workerId) throw error;
  await request(
    config.apiUrl,
    `/channel-reply-claims/${reply.workId}/complete`,
    workerToken,
    {
      method: "POST",
      body: JSON.stringify({
        organizationId: reply.organizationId,
        workerId,
        claimToken: reply.claimToken,
        error: error instanceof Error ? error.message : String(error),
      }),
    },
  );
}

export {
  runClaimedProjectAgentTask,
  completeClaimedProjectAgentTask,
  failClaimedProjectAgentTask,
  runClaimedIssueReply,
  failClaimedIssueReply,
  runClaimedChannelReply,
  failClaimedChannelReply,
};
