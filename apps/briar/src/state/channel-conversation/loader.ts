import * as Atom from "effect/unstable/reactivity/Atom";
import { useMemo } from "react";

import { listChannelMessages, loadChannel, loadDashboard } from "../../lib/api";
import type {
  ChannelAgentSummary,
  ChannelExecutionProposal,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../../lib/channels-contract";
import type { AgentSkillExecutionProposal, HuntRun } from "../../types";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { useRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import { applySyncEvent } from "../sync/apply";
import {
  channelAcceptingProposalIdAtom,
  channelAgentRepliesAtom,
  channelConversationBusyAtom,
  channelDecliningProposalIdAtom,
  channelEarlierMessagesLoadingAtom,
  channelMessageCursorAtom,
  channelProposalProjectsAtom,
  channelRootMessagesAtom,
  channelThreadLoadingAtom,
} from "./atoms";
import { reportChannelConversationError } from "./errors";
import { getChannelReplyLedger } from "./reply-ledger";
import { writeChannelOpenThreadId, writeChannelThreadMessages } from "./write";

/*
  Every read the channel conversation makes, and the ordering rules that decide
  whether an answer may still be committed.

  `use-channel-conversation.ts` owned this: a `requestVersion` counter, a
  `channelSurfaceGeneration` counter, a rendered-surface pair of refs and an
  `AbortController` the view kept beside them. All four were per hook instance,
  so "is this response still wanted?" was answerable only while the view that
  started the request was mounted, and the two conversation views could not
  share a request at all. They are registry scoped here, the way
  `state/sync/loader.ts` scopes the team dashboard's, and every result is
  applied through `applySyncEvent` rather than through a component's setter.

  The three guards are unchanged, because they are what keeps a channel switch
  from being overwritten by the channel it left:

  1. the request's own `AbortController`,
  2. a request version that any newer request or surface change advances, and
  3. the surface — channel plus open thread — the request was started on.
*/

/** The channel and thread a request was started on. */
export type ChannelSurfaceContext = {
  readonly generation: number;
  readonly channelId: string | null;
  readonly threadParentId: string | null;
};

/** A message a deep link asked for, and the root whose thread holds it. */
export type RequestedChannelMessage = {
  readonly channelId: string;
  readonly messageId: string;
  readonly rootMessageId: string;
};

/** The reads the loader performs. Tests supply in-memory implementations. */
export interface ChannelConversationApi {
  readonly listChannelMessages: typeof listChannelMessages;
  readonly loadChannel: typeof loadChannel;
  readonly loadDashboard: typeof loadDashboard;
}

export const liveChannelConversationApi: ChannelConversationApi = {
  listChannelMessages,
  loadChannel,
  loadDashboard,
};

/** Overrides layered over {@link liveChannelConversationApi}. */
export const channelConversationApiAtom = Atom.make<
  Partial<ChannelConversationApi>
>({}).pipe(Atom.keepAlive, Atom.withLabel("channelConversation/api"));

/** The API in force for this registry, resolved at call time. */
export function resolveChannelConversationApi(
  registry: AtomRegistry,
): ChannelConversationApi {
  return {
    ...liveChannelConversationApi,
    ...registry.get(channelConversationApiAtom),
  };
}

/** What a channel detail response left in the store. */
export type ChannelConversationSnapshot = {
  readonly channel: ChannelSummary;
  readonly members: ChannelMember[];
  readonly agents: ChannelAgentSummary[];
  readonly messages: ChannelMessage[];
  readonly nextCursor: string | null;
};

export type ChannelConversationLoadResult = ChannelConversationSnapshot & {
  readonly requestedMessage: RequestedChannelMessage | null;
};

export type LoadChannelConversationOptions = {
  readonly messageLimit: number;
  /** Keeps whatever the store already holds for the channel. */
  readonly mergeWithCurrentMessages: boolean;
  readonly requestedMessage?: RequestedChannelMessage | null;
  /** The catalog write the views still make with the loaded summary. */
  readonly onChannelLoaded?: (channel: ChannelSummary) => void;
};

export type LoadEarlierMessagesResult = {
  readonly applied: boolean;
  readonly nextCursor: string | null;
};

type DashboardResult = Awaited<ReturnType<typeof loadDashboard>>;

/** The proposal context an approval dialog renders. */
export type ChannelExecutionProposalContext = {
  readonly run: HuntRun | null;
  readonly workers: NonNullable<DashboardResult["workers"]>;
  readonly policy: DashboardResult["executionPolicy"];
};

export interface ChannelConversationLoader {
  /*
    Request ordering.
  */
  /** The surface a request started on, to be checked again before committing. */
  readonly captureSurface: () => ChannelSurfaceContext;
  /** Whether `context` still names what is on screen. */
  readonly surfaceIsCurrent: (context: ChannelSurfaceContext) => boolean;
  /**
   * The surface a view is rendering. Advances the generation when it moved, so
   * an answer started on the previous one is dropped.
   */
  readonly syncSurface: (
    channelId: string | null,
    threadParentId: string | null,
  ) => void;
  /**
   * Moves to a new surface and invalidates everything in flight, including the
   * per-channel flags whose spinner would otherwise outlive its request.
   */
  readonly invalidateSurface: (
    channelId: string | null,
    threadParentId: string | null,
  ) => void;
  /** Advances the request version without moving the surface. */
  readonly bumpRequestVersion: () => number;
  /** The request version as it stands, which any newer request advances. */
  readonly readRequestVersion: () => number;
  /** Aborts and invalidates whatever is in flight for one channel. */
  readonly cancel: (channelId: string) => void;
  /** {@link cancel} for every channel. */
  readonly cancelAll: () => void;

  /*
    Proposal history, which the approval flow compares its answer against.
  */
  /** Records the proposals carried by `messages` and versions the changed ones. */
  readonly recordProposalMessages: (messages: readonly ChannelMessage[]) => void;
  readonly proposalVersion: (proposalId: string) => number;
  readonly latestProposal: (
    proposalId: string,
  ) => NonNullable<ChannelMessage["proposal"]> | null;
  readonly clearProposalHistory: (channelId: string | null) => void;

  /*
    The reads.
  */
  readonly loadConversation: (
    channelId: string,
    options: LoadChannelConversationOptions,
  ) => Promise<ChannelConversationLoadResult | null>;
  readonly loadEarlier: (
    channelId: string,
    pageSize: number,
  ) => Promise<LoadEarlierMessagesResult>;
  readonly loadThread: (
    channelId: string,
    rootMessageId: string,
    cachedMessages?: readonly ChannelMessage[],
  ) => Promise<boolean>;
  /**
   * Refetches the surface holding `item` so an approval that raced a change
   * commits against the server's answer rather than the one it started from.
   */
  readonly refresh: (
    channelId: string,
    options: {
      readonly item: ChannelMessage;
      readonly proposalId: string;
      readonly pageSize: number;
      readonly onChannelLoaded?: (channel: ChannelSummary) => void;
    },
  ) => Promise<NonNullable<ChannelMessage["proposal"]> | null>;
  readonly loadExecutionProposalContext: (
    proposal: ChannelExecutionProposal,
  ) => Promise<ChannelExecutionProposalContext>;
  readonly loadCreateExecutionProposalContext: (
    projectId: string,
  ) => Promise<ChannelExecutionProposalContext>;
  readonly loadSkillExecutionProposalContext: (
    proposal: AgentSkillExecutionProposal,
  ) => Promise<Omit<ChannelExecutionProposalContext, "run">>;
  /** Drops the accepted-proposal dashboards, which a new session invalidates. */
  readonly clearExecutionHistory: () => void;
}

export function createChannelConversationLoader(
  registry: AtomRegistry,
  overrides?: Partial<ChannelConversationApi>,
): ChannelConversationLoader {
  const resolveApi = (): ChannelConversationApi => ({
    ...resolveChannelConversationApi(registry),
    ...overrides,
  });
  const ledger = getChannelReplyLedger(registry);
  const abortControllers = new Map<string, AbortController>();
  const proposalVersions = new Map<string, number>();
  const latestProposals = new Map<
    string,
    NonNullable<ChannelMessage["proposal"]>
  >();
  const executionHistoryDashboards = new Map<
    string,
    ReturnType<typeof loadDashboard>
  >();
  let surfaceGeneration = 0;
  let requestVersion = 0;
  let surfaceChannelId: string | null = null;
  let surfaceThreadParentId: string | null = null;

  const captureSurface = (): ChannelSurfaceContext => ({
    generation: surfaceGeneration,
    channelId: surfaceChannelId,
    threadParentId: surfaceThreadParentId,
  });
  const surfaceIsCurrent = (context: ChannelSurfaceContext) =>
    context.generation === surfaceGeneration &&
    context.channelId === surfaceChannelId &&
    context.threadParentId === surfaceThreadParentId;

  /** Drops the spinners a request that is no longer wanted would have cleared. */
  const clearPendingFlags = (channelId: string | null) => {
    if (!channelId) return;
    registry.set(channelConversationBusyAtom(channelId), false);
    registry.set(channelAcceptingProposalIdAtom(channelId), null);
    registry.set(channelDecliningProposalIdAtom(channelId), null);
    registry.set(channelThreadLoadingAtom(channelId), false);
    registry.set(channelEarlierMessagesLoadingAtom(channelId), false);
  };

  const invalidateSurface = (
    channelId: string | null,
    threadParentId: string | null,
  ) => {
    const previous = surfaceChannelId;
    surfaceGeneration += 1;
    requestVersion += 1;
    surfaceChannelId = channelId;
    surfaceThreadParentId = threadParentId;
    Atom.batch(() => {
      clearPendingFlags(previous);
      if (channelId !== previous) clearPendingFlags(channelId);
    });
  };

  /*
    A cancel advances the request version but leaves the surface alone: the view
    is still showing the same channel, it just no longer wants the answer it
    asked for. Bumping the generation as well would make every unrelated request
    on that surface look stale.
  */
  const cancel = (channelId: string) => {
    requestVersion += 1;
    const controller = abortControllers.get(channelId);
    if (!controller) return;
    abortControllers.delete(channelId);
    controller.abort();
  };

  const startRequest = (channelId: string) => {
    abortControllers.get(channelId)?.abort();
    const controller = new AbortController();
    abortControllers.set(channelId, controller);
    return controller;
  };

  const recordProposalMessages = (messages: readonly ChannelMessage[]) => {
    const recorded = new Set<string>();
    for (const item of messages) {
      const proposal = item.proposal;
      if (!proposal || recorded.has(proposal.id)) continue;
      recorded.add(proposal.id);
      const previous = latestProposals.get(proposal.id);
      latestProposals.set(proposal.id, proposal);
      if (previous && JSON.stringify(previous) === JSON.stringify(proposal)) {
        continue;
      }
      proposalVersions.set(
        proposal.id,
        (proposalVersions.get(proposal.id) ?? 0) + 1,
      );
    }
  };

  /** The token and organization every read needs, or `null` when signed out. */
  const credentials = () => {
    const token = registry.get(tokenAtom);
    const organizationId = registry.get(activeOrganizationIdAtom);
    return token && organizationId ? { token, organizationId } : null;
  };

  const loadConversation = async (
    channelId: string,
    {
      messageLimit,
      mergeWithCurrentMessages,
      requestedMessage,
      onChannelLoaded,
    }: LoadChannelConversationOptions,
  ): Promise<ChannelConversationLoadResult | null> => {
    const session = credentials();
    if (!session) return null;
    const { token, organizationId } = session;
    const api = resolveApi();
    const context = captureSurface();
    const version = ++requestVersion;
    const observedReplyVersion = ledger.capture(channelId);
    const abort = startRequest(channelId);
    const { signal } = abort;
    const isStale = () =>
      signal.aborted || version !== requestVersion || !surfaceIsCurrent(context);
    try {
      const result = await api.loadChannel(token, organizationId, channelId, {
        messageLimit,
        signal,
      });
      if (isStale()) return null;

      onChannelLoaded?.(result.channel);
      const stored = registry.get(channelRootMessagesAtom(channelId));
      /*
        A merged refresh whose page is shorter than what the store already holds
        keeps the stored cursor: the response describes the newest page, and the
        older one this channel has already paged in resumes from further back.
      */
      const nextCursor =
        mergeWithCurrentMessages && stored.length > result.messages.length
          ? registry.get(channelMessageCursorAtom(channelId))
          : result.nextCursor ?? null;
      recordProposalMessages(result.messages);
      const retainedReplyIds = ledger.retainedSince(
        channelId,
        observedReplyVersion,
        registry.get(channelAgentRepliesAtom(channelId)),
      );
      Atom.batch(() => {
        applySyncEvent(registry, {
          kind: "channel-agent-replies-authoritative",
          channelId,
          replies: result.agentReplies ?? [],
          retainedReplyIds,
        });
        applySyncEvent(registry, {
          kind: "channel-conversation-snapshot",
          channelId,
          members: result.members,
          agents: result.agents,
          messages: result.messages,
          nextCursor,
          merge: mergeWithCurrentMessages,
        });
      });
      ledger.note(channelId, result.agentReplies ?? []);

      const target =
        requestedMessage?.channelId === channelId ? requestedMessage : null;
      let requestedThreadResult: Awaited<
        ReturnType<typeof listChannelMessages>
      > | null = null;
      if (
        target &&
        !registry
          .get(channelRootMessagesAtom(channelId))
          .some((item) => item.id === target.rootMessageId)
      ) {
        requestedThreadResult = await api.listChannelMessages(
          token,
          organizationId,
          channelId,
          target.rootMessageId,
          { signal },
        );
        if (isStale()) return null;
        const roots = requestedThreadResult.messages.filter(
          (item) => item.parentMessageId === null,
        );
        recordProposalMessages(roots);
        applySyncEvent(registry, {
          kind: "channel-conversation-snapshot",
          channelId,
          messages: roots,
          nextCursor,
          merge: true,
        });
      }
      if (target && target.rootMessageId !== target.messageId) {
        const threadResult =
          requestedThreadResult ??
          (await api.listChannelMessages(
            token,
            organizationId,
            channelId,
            target.rootMessageId,
            { signal },
          ));
        if (isStale()) return null;
        recordProposalMessages(threadResult.messages);
        invalidateSurface(channelId, target.rootMessageId);
        Atom.batch(() => {
          writeChannelOpenThreadId(registry, channelId, target.rootMessageId);
          applySyncEvent(registry, {
            kind: "channel-thread-snapshot",
            channelId,
            rootMessageId: target.rootMessageId,
            messages: threadResult.messages,
          });
        });
      } else if (target) {
        writeChannelOpenThreadId(registry, channelId, null);
      }
      return {
        channel: result.channel,
        members: result.members,
        agents: result.agents,
        messages: registry.get(channelRootMessagesAtom(channelId)),
        nextCursor,
        requestedMessage: target,
      };
    } catch (cause) {
      if (!isStale()) reportChannelConversationError(registry, cause);
      return null;
    } finally {
      if (abortControllers.get(channelId) === abort) {
        abortControllers.delete(channelId);
      }
    }
  };

  const loadEarlier = async (
    channelId: string,
    pageSize: number,
  ): Promise<LoadEarlierMessagesResult> => {
    const cursor = registry.get(channelMessageCursorAtom(channelId));
    const session = credentials();
    if (
      !session ||
      !cursor ||
      registry.get(channelEarlierMessagesLoadingAtom(channelId))
    ) {
      return { applied: false, nextCursor: cursor };
    }
    const { token, organizationId } = session;
    const api = resolveApi();
    const context = captureSurface();
    registry.set(channelEarlierMessagesLoadingAtom(channelId), true);
    try {
      const result = await api.listChannelMessages(
        token,
        organizationId,
        channelId,
        undefined,
        { limit: pageSize, cursor },
      );
      if (!surfaceIsCurrent(context)) {
        return { applied: false, nextCursor: cursor };
      }
      recordProposalMessages(result.messages);
      const nextCursor = result.nextCursor ?? null;
      applySyncEvent(registry, {
        kind: "channel-conversation-snapshot",
        channelId,
        messages: result.messages,
        nextCursor,
        merge: true,
      });
      return { applied: true, nextCursor };
    } catch (cause) {
      if (surfaceIsCurrent(context)) {
        reportChannelConversationError(registry, cause);
      }
      return { applied: false, nextCursor: cursor };
    } finally {
      registry.set(channelEarlierMessagesLoadingAtom(channelId), false);
    }
  };

  const loadThread = async (
    channelId: string,
    rootMessageId: string,
    cachedMessages: readonly ChannelMessage[] = [],
  ): Promise<boolean> => {
    const session = credentials();
    if (!session) return false;
    const { token, organizationId } = session;
    const api = resolveApi();
    invalidateSurface(channelId, rootMessageId);
    const version = requestVersion;
    const context = captureSurface();
    Atom.batch(() => {
      writeChannelOpenThreadId(registry, channelId, rootMessageId);
      writeChannelThreadMessages(
        registry,
        channelId,
        rootMessageId,
        cachedMessages,
      );
      registry.set(
        channelThreadLoadingAtom(channelId),
        cachedMessages.length === 0,
      );
    });
    const isStale = () =>
      version !== requestVersion || !surfaceIsCurrent(context);
    try {
      const result = await api.listChannelMessages(
        token,
        organizationId,
        channelId,
        rootMessageId,
      );
      if (isStale()) return false;
      recordProposalMessages(result.messages);
      applySyncEvent(registry, {
        kind: "channel-thread-snapshot",
        channelId,
        rootMessageId,
        messages: result.messages,
      });
      return true;
    } catch (cause) {
      if (!isStale()) reportChannelConversationError(registry, cause);
      return false;
    } finally {
      if (!isStale()) {
        registry.set(channelThreadLoadingAtom(channelId), false);
      }
    }
  };

  const refresh = async (
    channelId: string,
    {
      item,
      proposalId,
      pageSize,
      onChannelLoaded,
    }: {
      readonly item: ChannelMessage;
      readonly proposalId: string;
      readonly pageSize: number;
      readonly onChannelLoaded?: (channel: ChannelSummary) => void;
    },
  ) => {
    const session = credentials();
    if (!session) return null;
    const { token, organizationId } = session;
    const api = resolveApi();
    const context = captureSurface();
    const version = ++requestVersion;
    const isStale = () =>
      version !== requestVersion || !surfaceIsCurrent(context);
    if (item.parentMessageId) {
      const result = await api.listChannelMessages(
        token,
        organizationId,
        channelId,
        item.parentMessageId,
      );
      if (isStale()) return latestProposals.get(proposalId) ?? null;
      recordProposalMessages(result.messages);
      applySyncEvent(registry, {
        kind: "channel-thread-snapshot",
        channelId,
        rootMessageId: item.parentMessageId,
        messages: result.messages,
      });
    } else {
      const result = await api.loadChannel(token, organizationId, channelId, {
        messageLimit: pageSize,
      });
      if (isStale()) return latestProposals.get(proposalId) ?? null;
      recordProposalMessages(result.messages);
      applySyncEvent(registry, {
        kind: "channel-conversation-snapshot",
        channelId,
        members: result.members,
        agents: result.agents,
        messages: result.messages,
        nextCursor: registry.get(channelMessageCursorAtom(channelId)),
        merge: true,
      });
      onChannelLoaded?.(result.channel);
    }
    /*
      The request version stays advanced on purpose: any response that started
      before this authoritative refresh must not overwrite it.
    */
    return latestProposals.get(proposalId) ?? null;
  };

  return {
    captureSurface,
    surfaceIsCurrent,
    syncSurface: (channelId, threadParentId) => {
      if (
        surfaceChannelId === channelId &&
        surfaceThreadParentId === threadParentId
      ) {
        return;
      }
      surfaceGeneration += 1;
      surfaceChannelId = channelId;
      surfaceThreadParentId = threadParentId;
    },
    invalidateSurface,
    bumpRequestVersion: () => ++requestVersion,
    readRequestVersion: () => requestVersion,
    cancel,
    cancelAll: () => {
      for (const channelId of [...abortControllers.keys()]) cancel(channelId);
    },
    recordProposalMessages,
    proposalVersion: (proposalId) => proposalVersions.get(proposalId) ?? 0,
    latestProposal: (proposalId) => latestProposals.get(proposalId) ?? null,
    clearProposalHistory: (channelId) => {
      proposalVersions.clear();
      latestProposals.clear();
      if (channelId) registry.set(channelProposalProjectsAtom(channelId), {});
    },
    loadConversation,
    loadEarlier,
    loadThread,
    refresh,
    loadExecutionProposalContext: async (proposal) => {
      const session = credentials();
      if (!session) throw new Error("No active session");
      const cacheHistory = proposal.status === "accepted";
      let request = cacheHistory
        ? executionHistoryDashboards.get(proposal.projectId)
        : undefined;
      if (!request) {
        request = resolveApi().loadDashboard(session.token, proposal.projectId);
        if (cacheHistory) {
          executionHistoryDashboards.set(proposal.projectId, request);
        }
      }
      try {
        const dashboard = await request;
        return {
          run: dashboard.runs.find((run) => run.id === proposal.runId) ?? null,
          workers: dashboard.workers ?? [],
          policy: dashboard.executionPolicy,
        };
      } catch (cause) {
        if (
          cacheHistory &&
          executionHistoryDashboards.get(proposal.projectId) === request
        ) {
          executionHistoryDashboards.delete(proposal.projectId);
        }
        throw cause;
      }
    },
    loadCreateExecutionProposalContext: async (projectId) => {
      const session = credentials();
      if (!session) throw new Error("No active session");
      const dashboard = await resolveApi().loadDashboard(
        session.token,
        projectId,
      );
      return {
        run: null,
        workers: dashboard.workers ?? [],
        policy: dashboard.executionPolicy,
      };
    },
    loadSkillExecutionProposalContext: async (proposal) => {
      const session = credentials();
      if (!session) throw new Error("No active session");
      const dashboard = await resolveApi().loadDashboard(
        session.token,
        proposal.projectId,
      );
      return {
        workers: dashboard.workers ?? [],
        policy: dashboard.executionPolicy,
      };
    },
    clearExecutionHistory: () => executionHistoryDashboards.clear(),
  };
}

/*
  One loader per registry. The desktop and companion conversation views never
  render together, but the actions and the realtime sync do run beside the view,
  and all three have to agree on which request is the current one.
*/
const loaders = new WeakMap<AtomRegistry, ChannelConversationLoader>();

export function getChannelConversationLoader(
  registry: AtomRegistry,
): ChannelConversationLoader {
  let loader = loaders.get(registry);
  if (!loader) {
    loader = createChannelConversationLoader(registry);
    loaders.set(registry, loader);
  }
  return loader;
}

export function useChannelConversationLoader(): ChannelConversationLoader {
  const registry = useRegistry();
  return useMemo(() => getChannelConversationLoader(registry), [registry]);
}
