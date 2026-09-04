import { useAtomValue } from "@effect/atom-react";
import * as Atom from "effect/unstable/reactivity/Atom";
import { useEffect, useMemo, useRef } from "react";

import {
  acceptChannelExecutionProposal,
  acceptChannelProposal,
  acceptChannelSkillExecutionProposal,
  declineChannelProposal,
  deleteChannelMessage,
  sendChannelMessage,
  toggleChannelMessageReaction,
  updateChannelThreadSubscription,
} from "../../lib/api";
import {
  applyChannelThreadSubscribers,
  type ChannelExecutionProposal,
  type ChannelMessage,
  type ChannelSummary,
} from "../../lib/channels-contract";
import { applyChannelMessageDeletion } from "../../lib/channel-message-deletion";
import { mergeChannelMessages } from "../../lib/channel-message-merge";
import type { MentionTarget } from "../../lib/channel-mentions";
import { createOptimisticChannelMessage } from "../../lib/optimistic-channel-message";
import { removeOptimisticChannelMessage } from "../../lib/optimistic-channel-message";
import { toggleOptimisticChannelReaction } from "../../lib/optimistic-channel-reaction";
import { currentExecutionWorkerDeviceId } from "../../lib/execution-worker-device";
import { channelIssueProposalRequestsExecution } from "../../components/ChannelIssueProposalDetails";
import {
  registerChannelMessageImageSource,
  type ChannelMessageImageCache,
} from "../../components/ChannelImages";
import type { ChannelSkillCommandTarget } from "../../hooks/useChannelComposer";
import { useToast } from "../../components/ui/toast";
import { useI18n } from "../../i18n";
import type {
  AgentSkillExecutionApprovalInput,
  AgentSkillExecutionProposal,
  AutoHuntSession,
  IssueExecutionApprovalInput,
} from "../../types";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import {
  channelAcceptingProposalIdAtom,
  channelAgentRepliesAtom,
  channelAgentsAtom,
  channelConversationBusyAtom,
  channelDecliningProposalIdAtom,
  channelMembersAtom,
  channelOpenThreadIdAtom,
  channelProposalProjectsAtom,
  channelRootMessagesAtom,
  channelThreadKey,
  channelThreadMessagesAtom,
  channelThreadSubscriptionPendingAtom,
} from "./atoms";
import {
  channelConversationFailureAtom,
  reportChannelConversationError,
} from "./errors";
import { applyIncomingChannelAgentReplies } from "./incoming";
import {
  appendReplySummary,
  removeReplySummary,
  channelConversationError,
} from "./model";
import {
  getChannelConversationLoader,
  type ChannelSurfaceContext,
} from "./loader";
import {
  writeChannelAgentReplies,
  writeChannelOpenThreadId,
  writeChannelThreadMessages,
  writeChannelTimeline,
} from "./write";

/*
  Every write the channel conversation makes.

  These were `useCallback`s inside `use-channel-conversation.ts`, closing over
  the view's `useState` setters and over the request-ordering refs beside them.
  What made them impossible to move was not the requests but the ordering: each
  one captures the surface it started on and refuses to commit onto a different
  one, and that bookkeeping is `state/channel-conversation/loader.ts`'s now.

  So the shape here is the one `state/issues/actions.ts` established — a factory
  bound to a registry, a per-registry singleton, and a hook that curries the
  open channel — with one addition. A few things an action needs cannot come
  from the store: the image cache the view owns, the shell callbacks that
  navigate or adopt a session, and the translated strings. Those arrive through
  a context accessor the binding hook keeps current, read at call time, so the
  action identities stay stable for the view's whole life. The rows depend on
  that: `MessageRowHandlers` is memoised on it.
*/

/** The writes the actions perform. Tests supply in-memory implementations. */
export interface ChannelConversationWriteApi {
  readonly acceptChannelExecutionProposal: typeof acceptChannelExecutionProposal;
  readonly acceptChannelProposal: typeof acceptChannelProposal;
  readonly acceptChannelSkillExecutionProposal: typeof acceptChannelSkillExecutionProposal;
  readonly currentExecutionWorkerDeviceId: typeof currentExecutionWorkerDeviceId;
  readonly declineChannelProposal: typeof declineChannelProposal;
  readonly deleteChannelMessage: typeof deleteChannelMessage;
  readonly sendChannelMessage: typeof sendChannelMessage;
  readonly toggleChannelMessageReaction: typeof toggleChannelMessageReaction;
  readonly updateChannelThreadSubscription: typeof updateChannelThreadSubscription;
}

export const liveChannelConversationWriteApi: ChannelConversationWriteApi = {
  acceptChannelExecutionProposal,
  acceptChannelProposal,
  acceptChannelSkillExecutionProposal,
  currentExecutionWorkerDeviceId,
  declineChannelProposal,
  deleteChannelMessage,
  sendChannelMessage,
  toggleChannelMessageReaction,
  updateChannelThreadSubscription,
};

/** Overrides layered over {@link liveChannelConversationWriteApi}. */
export const channelConversationWriteApiAtom = Atom.make<
  Partial<ChannelConversationWriteApi>
>({}).pipe(Atom.keepAlive, Atom.withLabel("channelConversation/writeApi"));

/**
 * What an action needs that the store does not hold: the view's image cache,
 * the shell callbacks, and the strings only a render can translate.
 */
export interface ChannelConversationActionContext {
  readonly currentUserId: string | null;
  /** A direct message with one member and one agent invokes that agent. */
  readonly channelKind?: ChannelSummary["kind"];
  readonly defaultProjectId?: string | null;
  readonly includeRepliesInRoot?: boolean;
  readonly pageSize: number;
  readonly imageCache?: ChannelMessageImageCache | null;
  readonly onIssueOpen?: (
    projectId: string,
    runId: string,
  ) => void | Promise<void>;
  readonly onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  readonly onRootMessagePending?: () => void;
  readonly onThreadClosed?: () => void;
  readonly onChannelLoaded?: (channel: ChannelSummary) => void;
  readonly text: {
    readonly you: string;
    readonly deleteMessageConfirm: string;
    readonly executionTargetUnavailable: string;
    readonly skillApprovalUnavailable: string;
  };
}

export interface ChannelConversationActions {
  readonly send: (
    channelId: string,
    input: {
      readonly body: string;
      readonly mentions: MentionTarget[];
      readonly parentMessageId: string | null;
      readonly attachments: File[];
      readonly attachmentReferences: string[];
      readonly selectedSkill?: ChannelSkillCommandTarget;
    },
  ) => Promise<void>;
  readonly closeThread: (channelId: string) => boolean;
  readonly toggleReaction: (
    channelId: string,
    item: ChannelMessage,
    emoji: string,
  ) => Promise<void>;
  readonly removeMessage: (
    channelId: string,
    item: ChannelMessage,
  ) => Promise<void>;
  readonly toggleThreadSubscription: (
    channelId: string,
    subscribed: boolean,
  ) => Promise<void>;
  readonly acceptProposal: (
    channelId: string,
    item: ChannelMessage,
    execution?: IssueExecutionApprovalInput | null,
  ) => Promise<string | null | undefined>;
  readonly declineProposal: (
    channelId: string,
    item: ChannelMessage,
  ) => Promise<void>;
  readonly acceptExecutionProposal: (
    channelId: string,
    item: ChannelMessage,
    input: IssueExecutionApprovalInput,
  ) => Promise<ChannelExecutionProposal>;
  readonly applyAcceptedExecutionProposal: (
    channelId: string,
    messageId: string,
    proposal: ChannelExecutionProposal,
  ) => void;
  readonly acceptSkillExecutionProposal: (
    channelId: string,
    item: ChannelMessage,
    input: AgentSkillExecutionApprovalInput,
  ) => Promise<AgentSkillExecutionProposal>;
  readonly applyAcceptedSkillExecutionProposal: (
    channelId: string,
    messageId: string,
    proposal: AgentSkillExecutionProposal,
  ) => void;
  readonly openIssue: (
    projectId: string,
    runId: string,
    context?: ChannelSurfaceContext,
  ) => Promise<void>;
}

export function createChannelConversationActions(
  registry: AtomRegistry,
  options: {
    readonly context: () => ChannelConversationActionContext;
    readonly api?: Partial<ChannelConversationWriteApi>;
  },
): ChannelConversationActions {
  const loader = getChannelConversationLoader(registry);
  const optimisticThreadMessageIds = new Set<string>();
  const resolveApi = (): ChannelConversationWriteApi => ({
    ...liveChannelConversationWriteApi,
    ...registry.get(channelConversationWriteApiAtom),
    ...options.api,
  });
  const credentials = () => {
    const token = registry.get(tokenAtom);
    const organizationId = registry.get(activeOrganizationIdAtom);
    return token && organizationId ? { token, organizationId } : null;
  };

  /*
    The two timeline updaters. They are the shape the hook handed to the view's
    `useState` setters, kept because the merge rules they call live in
    `model.ts` and the ordering, identity preservation and retention bound live
    in `write.ts` — the action only decides what the next list is.
  */
  const updateRoot = (
    channelId: string,
    update: (current: ChannelMessage[]) => ChannelMessage[],
  ) => {
    writeChannelTimeline(
      registry,
      channelId,
      update(registry.get(channelRootMessagesAtom(channelId))),
    );
  };
  const updateThread = (
    channelId: string,
    update: (current: ChannelMessage[]) => ChannelMessage[],
  ) => {
    const rootMessageId = registry.get(channelOpenThreadIdAtom(channelId));
    if (!rootMessageId) return;
    writeChannelThreadMessages(
      registry,
      channelId,
      rootMessageId,
      update(
        registry.get(
          channelThreadMessagesAtom(channelThreadKey(channelId, rootMessageId)),
        ),
      ),
    );
  };
  const setBusy = (channelId: string, value: boolean) =>
    registry.set(channelConversationBusyAtom(channelId), value);

  const send: ChannelConversationActions["send"] = async (
    channelId,
    { body, mentions, parentMessageId, attachments, attachmentReferences, selectedSkill },
  ) => {
    const session = credentials();
    if (!session || !channelId || !body.trim()) return;
    const { token, organizationId } = session;
    const api = resolveApi();
    const context = options.context();
    const { imageCache } = context;
    const sendContext = loader.captureSurface();
    const clientMessageId = crypto.randomUUID();
    const attachmentUrls = attachments.map((attachment) =>
      URL.createObjectURL(attachment),
    );
    if (imageCache) {
      for (let i = 0; i < attachmentUrls.length; i++) {
        const url = attachmentUrls[i]!;
        const ref = attachmentReferences[i];
        registerChannelMessageImageSource(imageCache, url, url);
        if (ref) {
          registerChannelMessageImageSource(imageCache, ref, url);
          registerChannelMessageImageSource(imageCache, `${ref}:${url}`, url);
        }
      }
    }
    const members = registry.get(channelMembersAtom(channelId));
    const agents = registry.get(channelAgentsAtom(channelId));
    const optimisticMessage = createOptimisticChannelMessage({
      id: clientMessageId,
      channelId,
      parentMessageId,
      body: body.trim(),
      currentUserId: context.currentUserId,
      fallbackAuthorName: context.text.you,
      members,
      mentions,
      attachments,
      attachmentReferences,
      attachmentUrls,
    });
    const parentBeforeSend = parentMessageId
      ? registry
          .get(channelRootMessagesAtom(channelId))
          .find((item) => item.id === parentMessageId) ?? null
      : null;
    setBusy(channelId, true);
    if (parentMessageId) {
      optimisticThreadMessageIds.add(clientMessageId);
      updateRoot(channelId, (current) =>
        current.map((item) =>
          item.id === parentMessageId
            ? appendReplySummary(item, optimisticMessage)
            : item,
        ),
      );
      updateThread(channelId, (current) =>
        mergeChannelMessages(current, [optimisticMessage], []),
      );
    } else {
      context.onRootMessagePending?.();
      updateRoot(channelId, (current) =>
        mergeChannelMessages(current, [optimisticMessage], []),
      );
    }
    try {
      const hasAgentMention = mentions.some(
        (mention) => mention.type === "agent",
      );
      const implicitlyInvokesDirectAgent =
        context.channelKind === "dm" &&
        members.length === 1 &&
        agents.length === 1;
      const preferredDeviceId =
        hasAgentMention || implicitlyInvokesDirectAgent || selectedSkill
          ? await api.currentExecutionWorkerDeviceId(organizationId)
          : null;
      const mentionedAgentIds = mentions
        .filter((mention) => mention.type === "agent")
        .map((mention) => mention.id);
      if (selectedSkill && !mentionedAgentIds.includes(selectedSkill.agentId)) {
        mentionedAgentIds.push(selectedSkill.agentId);
      }
      const result = await api.sendChannelMessage(
        token,
        organizationId,
        channelId,
        {
          body: body.trim(),
          clientMessageId,
          skillId: selectedSkill?.skill.id ?? null,
          parentMessageId,
          mentionedUserIds: mentions
            .filter((mention) => mention.type === "user")
            .map((mention) => mention.id),
          mentionedAgentIds,
          ...(preferredDeviceId ? { preferredDeviceId } : {}),
          attachments,
          attachmentReferences,
        },
      );
      if (!loader.surfaceIsCurrent(sendContext)) return;
      if (imageCache && result?.message?.attachments) {
        result.message.attachments.forEach((attachment, index) => {
          const url = attachmentUrls[index];
          if (url) {
            registerChannelMessageImageSource(imageCache, attachment.id, url);
            registerChannelMessageImageSource(imageCache, attachment.url, url);
            registerChannelMessageImageSource(
              imageCache,
              `${attachment.id}:${attachment.url}`,
              url,
            );
          }
        });
      }
      applyIncomingChannelAgentReplies(
        registry,
        channelId,
        result.agentReplies,
        false,
      );
      if (parentMessageId) {
        optimisticThreadMessageIds.delete(clientMessageId);
        updateThread(channelId, (current) =>
          mergeChannelMessages(current, [result.message], []),
        );
      } else {
        context.onRootMessagePending?.();
        updateRoot(channelId, (current) =>
          mergeChannelMessages(current, [result.message], []),
        );
      }
    } catch (cause) {
      if (loader.surfaceIsCurrent(sendContext)) {
        const shouldRollbackReplySummary = parentMessageId
          ? optimisticThreadMessageIds.delete(clientMessageId)
          : false;
        updateThread(channelId, (current) =>
          removeOptimisticChannelMessage(current, clientMessageId),
        );
        updateRoot(channelId, (current) => {
          const removed = removeOptimisticChannelMessage(
            current,
            clientMessageId,
          );
          return parentMessageId && shouldRollbackReplySummary
            ? removed.map((item) =>
                item.id === parentMessageId
                  ? removeReplySummary(item, optimisticMessage, parentBeforeSend)
                  : item,
              )
            : removed;
        });
        reportChannelConversationError(registry, cause);
      }
      for (const url of attachmentUrls) {
        URL.revokeObjectURL(url);
        imageCache?.entries.delete(url);
      }
    } finally {
      optimisticThreadMessageIds.delete(clientMessageId);
      if (loader.surfaceIsCurrent(sendContext)) setBusy(channelId, false);
    }
  };

  const closeThread: ChannelConversationActions["closeThread"] = (channelId) => {
    if (!channelId || !registry.get(channelOpenThreadIdAtom(channelId))) {
      return false;
    }
    loader.invalidateSurface(channelId, null);
    writeChannelOpenThreadId(registry, channelId, null);
    options.context().onThreadClosed?.();
    return true;
  };

  const applyProposalPatch = (
    channelId: string,
    apply: (item: ChannelMessage) => ChannelMessage,
  ) => {
    updateRoot(channelId, (current) => current.map(apply));
    updateThread(channelId, (current) => current.map(apply));
  };

  const acceptProposal: ChannelConversationActions["acceptProposal"] = async (
    channelId,
    item,
    execution = null,
  ) => {
    const context = options.context();
    const session = credentials();
    if (!session || !channelId || item.channelId !== channelId || !item.proposal) {
      return context.text.executionTargetUnavailable;
    }
    const { token, organizationId } = session;
    const api = resolveApi();
    const proposalId = item.proposal.id;
    const requestsExecution = channelIssueProposalRequestsExecution(
      item.proposal,
    );
    const projectId =
      item.proposal.projectId ??
      context.defaultProjectId ??
      registry.get(channelProposalProjectsAtom(channelId))[proposalId] ??
      null;
    if (!projectId) return;
    const approvalContext = loader.captureSurface();
    const approvalContextIsCurrent = () =>
      approvalContext.channelId === channelId &&
      loader.surfaceIsCurrent(approvalContext);
    const approvalProposalVersion = loader.proposalVersion(proposalId);
    setBusy(channelId, true);
    registry.set(channelAcceptingProposalIdAtom(channelId), proposalId);
    try {
      const result = execution
        ? await api.acceptChannelProposal(
            token,
            organizationId,
            channelId,
            proposalId,
            projectId,
            execution,
          )
        : await api.acceptChannelProposal(
            token,
            organizationId,
            channelId,
            proposalId,
            projectId,
          );
      const hasExecutionFollowUp =
        requestsExecution || result.executionProposal != null;
      if (!approvalContextIsCurrent()) return;
      const applyResult = (candidate: ChannelMessage): ChannelMessage =>
        candidate.proposal?.id === proposalId
          ? {
              ...candidate,
              proposal: {
                ...candidate.proposal,
                status: "accepted",
                projectId: result.projectId,
                resultRunId: result.resultRunId,
                resultItems: result.resultItems,
              },
              executionProposal:
                result.executionProposal ?? candidate.executionProposal,
            }
          : candidate;
      const applySuccessfulResponse = () => {
        applyProposalPatch(channelId, applyResult);
        loader.recordProposalMessages([applyResult(item)]);
      };
      const refresh = (target: ChannelMessage) =>
        loader.refresh(channelId, {
          item: target,
          proposalId,
          pageSize: context.pageSize,
          onChannelLoaded: context.onChannelLoaded,
        });
      if (loader.proposalVersion(proposalId) === approvalProposalVersion) {
        applySuccessfulResponse();
        if (hasExecutionFollowUp && !result.executionProposal) {
          await refresh(applyResult(item));
        }
      } else {
        let latest = loader.latestProposal(proposalId) ?? undefined;
        if (latest?.status !== "accepted") {
          latest = (await refresh(item)) ?? undefined;
        }
        if (!approvalContextIsCurrent()) return;
        if (
          latest?.status === "accepted" &&
          latest.projectId &&
          latest.resultRunId
        ) {
          if (hasExecutionFollowUp) {
            if (result.executionProposal) applySuccessfulResponse();
            else await refresh(item);
          }
        } else if (
          latest?.status === "pending" &&
          latest.projectId === result.projectId
        ) {
          applySuccessfulResponse();
          if (hasExecutionFollowUp && !result.executionProposal) {
            await refresh(applyResult(item));
          }
        }
      }
      return null;
    } catch (cause) {
      if (approvalContextIsCurrent()) {
        reportChannelConversationError(registry, cause);
      }
      return channelConversationError(cause);
    } finally {
      if (approvalContextIsCurrent()) {
        setBusy(channelId, false);
        registry.set(channelAcceptingProposalIdAtom(channelId), null);
      }
    }
  };

  const declineProposal: ChannelConversationActions["declineProposal"] = async (
    channelId,
    item,
  ) => {
    const session = credentials();
    const proposal = item.proposal;
    if (
      !session ||
      !channelId ||
      item.channelId !== channelId ||
      !proposal ||
      proposal.status !== "pending"
    ) return;
    const { token, organizationId } = session;
    const api = resolveApi();
    const declineContext = loader.captureSurface();
    setBusy(channelId, true);
    registry.set(channelDecliningProposalIdAtom(channelId), proposal.id);
    try {
      await api.declineChannelProposal(
        token,
        organizationId,
        channelId,
        proposal.id,
      );
      if (!loader.surfaceIsCurrent(declineContext)) return;
      const applyDecline = (candidate: ChannelMessage): ChannelMessage =>
        candidate.proposal?.id === proposal.id &&
        candidate.proposal.status === "pending"
          ? {
              ...candidate,
              proposal: { ...candidate.proposal, status: "declined" },
            }
          : candidate;
      applyProposalPatch(channelId, applyDecline);
      loader.recordProposalMessages([applyDecline(item)]);
    } catch (cause) {
      if (loader.surfaceIsCurrent(declineContext)) {
        reportChannelConversationError(registry, cause);
      }
    } finally {
      if (loader.surfaceIsCurrent(declineContext)) {
        setBusy(channelId, false);
        registry.set(channelDecliningProposalIdAtom(channelId), null);
      }
    }
  };

  const toggleReaction: ChannelConversationActions["toggleReaction"] = async (
    channelId,
    item,
    emoji,
  ) => {
    const session = credentials();
    if (!session || !channelId) return;
    const { token, organizationId } = session;
    const api = resolveApi();
    const { currentUserId } = options.context();
    const reactionContext = loader.captureSurface();
    const optimisticReactions = (candidate: ChannelMessage) =>
      candidate.id === item.id
        ? {
            ...candidate,
            reactions: toggleOptimisticChannelReaction(
              candidate.reactions,
              emoji,
              currentUserId,
            ),
          }
        : candidate;
    applyProposalPatch(channelId, optimisticReactions);
    try {
      const result = await api.toggleChannelMessageReaction(
        token,
        organizationId,
        channelId,
        item.id,
        emoji,
      );
      if (!loader.surfaceIsCurrent(reactionContext)) return;
      applyProposalPatch(channelId, (candidate) =>
        candidate.id === result.message.id
          ? { ...candidate, reactions: result.message.reactions }
          : candidate,
      );
    } catch (cause) {
      if (!loader.surfaceIsCurrent(reactionContext)) return;
      applyProposalPatch(channelId, optimisticReactions);
      reportChannelConversationError(registry, cause);
    }
  };

  const removeMessage: ChannelConversationActions["removeMessage"] = async (
    channelId,
    item,
  ) => {
    const session = credentials();
    const context = options.context();
    if (!session || !channelId || item.deletedAt) return;
    if (!window.confirm(context.text.deleteMessageConfirm)) return;
    const { token, organizationId } = session;
    const api = resolveApi();
    const deletionContext = loader.captureSurface();
    setBusy(channelId, true);
    try {
      const result = await api.deleteChannelMessage(
        token,
        organizationId,
        channelId,
        item.id,
      );
      if (!loader.surfaceIsCurrent(deletionContext)) return;
      updateRoot(channelId, (current) =>
        applyChannelMessageDeletion(current, item.id, result),
      );
      updateThread(channelId, (current) =>
        applyChannelMessageDeletion(current, item.id, result),
      );
      if (result.deleted) {
        writeChannelAgentReplies(
          registry,
          channelId,
          registry
            .get(channelAgentRepliesAtom(channelId))
            .filter(
              (reply) =>
                reply.triggerMessageId !== item.id &&
                reply.replyMessageId !== item.id,
            ),
        );
        if (
          registry.get(channelOpenThreadIdAtom(channelId)) === item.id &&
          !result.message
        ) {
          closeThread(channelId);
        }
      }
    } catch (cause) {
      if (loader.surfaceIsCurrent(deletionContext)) {
        reportChannelConversationError(registry, cause);
      }
    } finally {
      if (loader.surfaceIsCurrent(deletionContext)) setBusy(channelId, false);
    }
  };

  const toggleThreadSubscription: ChannelConversationActions["toggleThreadSubscription"] =
    async (channelId, subscribed) => {
      const session = credentials();
      const parentId = channelId
        ? registry.get(channelOpenThreadIdAtom(channelId))
        : null;
      if (
        !session ||
        !channelId ||
        !parentId ||
        registry.get(channelThreadSubscriptionPendingAtom(channelId))
      ) return;
      const { token, organizationId } = session;
      const api = resolveApi();
      const context = loader.captureSurface();
      registry.set(channelThreadSubscriptionPendingAtom(channelId), true);
      try {
        const result = await api.updateChannelThreadSubscription(
          token,
          organizationId,
          channelId,
          parentId,
          subscribed,
        );
        if (!loader.surfaceIsCurrent(context)) return;
        const apply = (current: ChannelMessage[]) =>
          applyChannelThreadSubscribers(
            current,
            result.rootMessageId,
            result.subscribers,
          );
        updateRoot(channelId, apply);
        updateThread(channelId, apply);
      } catch (cause) {
        if (loader.surfaceIsCurrent(context)) {
          reportChannelConversationError(registry, cause);
        }
      } finally {
        registry.set(channelThreadSubscriptionPendingAtom(channelId), false);
      }
    };

  return {
    send,
    closeThread,
    toggleReaction,
    removeMessage,
    toggleThreadSubscription,
    acceptProposal,
    declineProposal,
    acceptExecutionProposal: async (channelId, item, input) => {
      const session = credentials();
      const context = options.context();
      const proposal = item.executionProposal;
      if (
        !session ||
        !proposal ||
        proposal.status !== "pending" ||
        !channelId ||
        channelId !== item.channelId
      ) {
        throw new Error(context.text.executionTargetUnavailable);
      }
      const result = await resolveApi().acceptChannelExecutionProposal(
        session.token,
        session.organizationId,
        item.channelId,
        proposal.id,
        input,
      );
      return result.proposal;
    },
    applyAcceptedExecutionProposal: (channelId, messageId, proposal) => {
      applyProposalPatch(channelId, (item) =>
        item.id === messageId && item.executionProposal?.id === proposal.id
          ? { ...item, executionProposal: proposal }
          : item,
      );
    },
    acceptSkillExecutionProposal: async (channelId, item, input) => {
      const session = credentials();
      const context = options.context();
      const proposal = item.skillExecutionProposal;
      if (
        !session ||
        !proposal ||
        proposal.status !== "pending" ||
        !channelId ||
        channelId !== item.channelId
      ) {
        throw new Error(context.text.skillApprovalUnavailable);
      }
      const result = await resolveApi().acceptChannelSkillExecutionProposal(
        session.token,
        session.organizationId,
        item.channelId,
        proposal,
        input,
      );
      if (result.session) context.onSkillSessionAccepted?.(result.session);
      return result.proposal;
    },
    applyAcceptedSkillExecutionProposal: (channelId, messageId, proposal) => {
      applyProposalPatch(channelId, (item) =>
        item.id === messageId && item.skillExecutionProposal?.id === proposal.id
          ? { ...item, skillExecutionProposal: proposal }
          : item,
      );
    },
    openIssue: async (projectId, runId, surface = loader.captureSurface()) => {
      try {
        await options.context().onIssueOpen?.(projectId, runId);
      } catch (cause) {
        if (loader.surfaceIsCurrent(surface)) {
          reportChannelConversationError(registry, cause);
        }
      }
    },
  };
}

/** The actions curried to one channel, as the conversation views call them. */
export interface BoundChannelConversationActions {
  readonly send: (
    body: string,
    mentions: MentionTarget[],
    parentMessageId: string | null,
    attachments: File[],
    attachmentReferences: string[],
    selectedSkill?: ChannelSkillCommandTarget,
  ) => Promise<void>;
  readonly openThread: (
    parentMessageId: string,
    cachedMessages?: readonly ChannelMessage[],
  ) => Promise<boolean>;
  readonly closeThread: () => boolean;
  readonly loadEarlierMessages: () => Promise<{
    readonly applied: boolean;
    readonly nextCursor: string | null;
  }>;
  readonly toggleReaction: (item: ChannelMessage, emoji: string) => Promise<void>;
  readonly removeMessage: (item: ChannelMessage) => Promise<void>;
  readonly toggleThreadSubscription: (subscribed: boolean) => Promise<void>;
  readonly acceptProposal: (
    item: ChannelMessage,
    execution?: IssueExecutionApprovalInput | null,
  ) => Promise<string | null | undefined>;
  readonly declineProposal: (item: ChannelMessage) => Promise<void>;
  readonly acceptExecutionProposal: (
    item: ChannelMessage,
    input: IssueExecutionApprovalInput,
  ) => Promise<ChannelExecutionProposal>;
  readonly applyAcceptedExecutionProposal: (
    messageId: string,
    proposal: ChannelExecutionProposal,
  ) => void;
  readonly acceptSkillExecutionProposal: (
    item: ChannelMessage,
    input: AgentSkillExecutionApprovalInput,
  ) => Promise<AgentSkillExecutionProposal>;
  readonly applyAcceptedSkillExecutionProposal: (
    messageId: string,
    proposal: AgentSkillExecutionProposal,
  ) => void;
  readonly openIssue: (projectId: string, runId: string) => Promise<void>;
  readonly setProposalProject: (proposalId: string, projectId: string) => void;
}

export type ChannelConversationActionOptions = Omit<
  ChannelConversationActionContext,
  "text"
>;

/**
 * The conversation actions for `channelId`. The returned object is stable for
 * the registry's life — the view memoises row handlers on it — so everything
 * that changes per render reaches the actions through the context ref instead.
 */
export function useChannelConversationActions(
  channelId: string | null,
  options: ChannelConversationActionOptions,
): BoundChannelConversationActions {
  const registry = useRegistry();
  const { t } = useI18n();
  const { toast } = useToast();
  const loader = getChannelConversationLoader(registry);

  /*
    A failed read or write publishes its message rather than raising a toast,
    because registry-bound code has no provider context. Subscribing rather than
    reading keeps a failure from re-rendering the conversation: nothing here
    draws it.
  */
  useEffect(() => {
    let seen = registry.get(channelConversationFailureAtom)?.id ?? 0;
    return registry.subscribe(channelConversationFailureAtom, (failure) => {
      if (!failure || failure.id <= seen) return;
      seen = failure.id;
      toast(failure.message, { tone: "error" });
    });
  }, [registry, toast]);
  const contextRef = useRef<ChannelConversationActionContext>(null as never);
  contextRef.current = {
    ...options,
    text: {
      you: t("channel.you"),
      deleteMessageConfirm: t("channel.deleteMessageConfirm"),
      executionTargetUnavailable: t("executionApproval.targetUnavailable"),
      skillApprovalUnavailable: t("skillExecution.approvalUnavailable"),
    },
  };
  const channelIdRef = useRef(channelId);
  channelIdRef.current = channelId;
  const pageSizeRef = useRef(options.pageSize);
  pageSizeRef.current = options.pageSize;

  /*
    The surface the loader compares a response against is what this render is
    showing. Publishing it here rather than from an effect is what lets a
    request started in a layout effect already see the channel being drawn, and
    it is the reason a view that forgets to invalidate still cannot commit a
    response onto the wrong channel.
  */
  const threadParentId = useAtomValue(
    channelOpenThreadIdAtom(channelId ?? ""),
  );
  loader.syncSurface(channelId, channelId ? threadParentId : null);
  useEffect(
    () => () => {
      loader.invalidateSurface(null, null);
    },
    [loader],
  );

  const actions = useMemo(
    () =>
      createChannelConversationActions(registry, {
        context: () => contextRef.current,
      }),
    [registry],
  );

  return useMemo<BoundChannelConversationActions>(() => {
    const id = () => channelIdRef.current ?? "";
    return {
      send: (body, mentions, parentMessageId, attachments, attachmentReferences, selectedSkill) =>
        actions.send(id(), {
          body,
          mentions,
          parentMessageId,
          attachments,
          attachmentReferences,
          selectedSkill,
        }),
      openThread: (parentMessageId, cachedMessages = []) =>
        id()
          ? loader.loadThread(id(), parentMessageId, cachedMessages)
          : Promise.resolve(false),
      closeThread: () => actions.closeThread(id()),
      loadEarlierMessages: () =>
        id()
          ? loader.loadEarlier(id(), pageSizeRef.current)
          : Promise.resolve({ applied: false, nextCursor: null }),
      toggleReaction: (item, emoji) => actions.toggleReaction(id(), item, emoji),
      removeMessage: (item) => actions.removeMessage(id(), item),
      toggleThreadSubscription: (subscribed) =>
        actions.toggleThreadSubscription(id(), subscribed),
      acceptProposal: (item, execution = null) =>
        actions.acceptProposal(id(), item, execution),
      declineProposal: (item) => actions.declineProposal(id(), item),
      acceptExecutionProposal: (item, input) =>
        actions.acceptExecutionProposal(id(), item, input),
      applyAcceptedExecutionProposal: (messageId, proposal) =>
        actions.applyAcceptedExecutionProposal(id(), messageId, proposal),
      acceptSkillExecutionProposal: (item, input) =>
        actions.acceptSkillExecutionProposal(id(), item, input),
      applyAcceptedSkillExecutionProposal: (messageId, proposal) =>
        actions.applyAcceptedSkillExecutionProposal(id(), messageId, proposal),
      openIssue: (projectId, runId) => actions.openIssue(projectId, runId),
      setProposalProject: (proposalId, projectId) =>
        registry.update(channelProposalProjectsAtom(id()), (current) => ({
          ...current,
          [proposalId]: projectId,
        })),
    };
  }, [actions, loader, registry]);
}
