import {
  AtSign,
  Bot,
  Check,
  FileText,
  Hash,
  Headphones,
  LayoutGrid,
  LoaderCircle,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
  Search,
  Send,
  Type,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useI18n } from "../i18n";
import { useChannelComposer } from "../hooks/useChannelComposer";
import { useHorizontalPaneResize } from "../hooks/useHorizontalPaneResize";
import {
  acceptChannelProposal,
  listChannelMessages,
  listChannels,
  listOrganizationAgents,
  loadChannel,
  loadChannelDelta,
  loadOrganizationMembers,
  sendChannelMessage,
  setChannelAgent,
  setChannelMember,
} from "../lib/api";
import type { OrganizationMember } from "../types";
import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";
import type { MentionTarget } from "../lib/channel-mentions";
import { maxIssueAttachmentCount } from "../lib/issue-attachments";
import {
  ChannelDraftImages,
  ChannelMessageImages,
} from "./ChannelImages";
import { ChannelMentionMenu } from "./ChannelMentionMenu";
import {
  channelThreadWidthDefault,
  channelThreadWidthMax,
  channelThreadWidthMin,
  clampChannelThreadWidth,
  loadChannelThreadWidth,
  saveChannelThreadWidth,
} from "../lib/channel-thread-width";
import { ChannelMessageText } from "./ChannelMessageText";

/** Chat needs a tighter cadence than the 15s dashboard poll. */
const CHANNEL_POLL_INTERVAL_MS = 3_000;

type ChannelsProps = {
  organizationId: string;
  token: string;
  currentUserId: string | null;
  channels: ChannelSummary[];
  activeChannelId: string | null;
  onChannelSelect: (channelId: string | null) => void;
  onChannelsChange: Dispatch<SetStateAction<ChannelSummary[]>>;
  onIssueCreated?: (runId: string) => void;
  onCreateAgent?: () => void;
  requestedMessage?: {
    channelId: string;
    messageId: string;
    rootMessageId: string;
  } | null;
  onRequestedMessageOpen?: () => void;
};

type ChannelInviteCandidate =
  | { type: "user"; id: string; member: OrganizationMember }
  | { type: "agent"; id: string; agent: ChannelAgentSummary };

const mergeMessages = (
  current: ChannelMessage[],
  incoming: ChannelMessage[],
  removedIds: string[],
) => {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  for (const id of removedIds) byId.delete(id);
  return [...byId.values()].sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id.localeCompare(right.id)
      : left.createdAt.localeCompare(right.createdAt),
  );
};

const dayKey = (iso: string, localeTag: string) => {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
};

const formatDayLabel = (
  iso: string,
  localeTag: string,
  t: (key: "channel.today" | "channel.yesterday") => string,
) => {
  const date = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(iso, localeTag) === dayKey(today.toISOString(), localeTag)) {
    return t("channel.today");
  }
  if (dayKey(iso, localeTag) === dayKey(yesterday.toISOString(), localeTag)) {
    return t("channel.yesterday");
  }
  return new Intl.DateTimeFormat(localeTag, {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
};

const formatMessageTime = (iso: string, localeTag: string) =>
  new Intl.DateTimeFormat(localeTag, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));

const authorInitial = (name: string) =>
  name.trim().charAt(0).toUpperCase() || "?";

export function Channels({
  organizationId,
  token,
  currentUserId,
  channels,
  activeChannelId,
  onChannelSelect,
  onChannelsChange,
  onIssueCreated,
  requestedMessage,
  onRequestedMessageOpen,
  onCreateAgent,
}: ChannelsProps) {
  const { t, localeTag } = useI18n();
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [agents, setAgents] = useState<ChannelAgentSummary[]>([]);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [replies, setReplies] = useState<ChannelAgentReply[]>([]);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChannelMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteMembers, setInviteMembers] = useState<OrganizationMember[]>([]);
  const [inviteAgents, setInviteAgents] = useState<ChannelAgentSummary[]>([]);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteSaving, setInviteSaving] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const {
    containerRef: channelsRef,
    effectiveWidth: effectiveThreadWidth,
    isResizing: isResizingThread,
    separatorProps: threadResizeProps,
    width: threadWidth,
  } = useHorizontalPaneResize({
    clamp: clampChannelThreadWidth,
    defaultWidth: channelThreadWidthDefault,
    load: loadChannelThreadWidth,
    max: channelThreadWidthMax,
    min: channelThreadWidthMin,
    save: saveChannelThreadWidth,
  });
  const cursor = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const activeChannelIdRef = useRef(activeChannelId);
  activeChannelIdRef.current = activeChannelId;

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
  );

  const openInvite = useCallback(() => {
    if (!activeChannelId) return;
    setInviteOpen(true);
    setInviteLoading(true);
    setInviteError(null);
    setInviteMembers([]);
    setInviteAgents([]);
    void Promise.all([
      loadOrganizationMembers(token, organizationId),
      listOrganizationAgents(token, organizationId),
    ])
      .then(([organizationMembers, organizationAgents]) => {
        setInviteMembers(organizationMembers);
        setInviteAgents(organizationAgents.agents);
      })
      .catch((cause) => setInviteError(errorMessage(cause)))
      .finally(() => setInviteLoading(false));
  }, [activeChannelId, organizationId, token]);

  const addInvitees = useCallback(
    async (selected: ChannelInviteCandidate[]) => {
      if (!activeChannelId || selected.length === 0) return;
      setInviteSaving(true);
      setInviteError(null);
      const refreshRoster = async () => {
        const refreshed = await loadChannel(
          token,
          organizationId,
          activeChannelId,
        );
        setMembers(refreshed.members);
        setAgents(refreshed.agents);
        onChannelsChange((current) =>
          current.map((channel) =>
            channel.id === refreshed.channel.id ? refreshed.channel : channel,
          ),
        );
      };
      try {
        const results = await Promise.allSettled(
          selected.map((candidate) =>
            candidate.type === "user"
              ? setChannelMember(
                  token,
                  organizationId,
                  activeChannelId,
                  candidate.id,
                  true,
                )
              : setChannelAgent(
                  token,
                  organizationId,
                  activeChannelId,
                  candidate.id,
                  true,
                ),
          ),
        );
        const failed = results.find(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        try {
          await refreshRoster();
        } catch (cause) {
          setInviteError(errorMessage(failed?.reason ?? cause));
          return;
        }

        if (failed) {
          // Some idempotent roster writes may have succeeded. Keep the modal
          // open with the refreshed roster so retrying the remaining entries
          // is safe and cannot race an in-flight write.
          setInviteError(errorMessage(failed.reason));
          return;
        }
        setInviteOpen(false);
      } finally {
        setInviteSaving(false);
      }
    },
    [activeChannelId, onChannelsChange, organizationId, token],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listChannels(token, organizationId);
        if (cancelled) return;
        cursor.current = result.cursor;
        onChannelsChange(result.channels);
        if (!activeChannelIdRef.current) {
          onChannelSelect(result.channels[0]?.id ?? null);
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onChannelSelect, onChannelsChange, organizationId, token]);

  useEffect(() => {
    if (!activeChannelId) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await loadChannel(token, organizationId, activeChannelId);
        if (cancelled) return;
        setMembers(result.members);
        setAgents(result.agents);
        setMessages(result.messages);
        const target = requestedMessage?.channelId === activeChannelId
          ? requestedMessage
          : null;
        if (target && target.rootMessageId !== target.messageId) {
          const threadResult = await listChannelMessages(
            token,
            organizationId,
            activeChannelId,
            target.rootMessageId,
          );
          if (cancelled) return;
          setThreadParentId(target.rootMessageId);
          setThreadMessages(threadResult.messages);
        } else {
          setThreadParentId(null);
          setThreadMessages([]);
        }
        if (target) {
          window.requestAnimationFrame(() => {
            document
              .querySelector(`[data-channel-message-id="${target.messageId}"]`)
              ?.scrollIntoView?.({ block: "center" });
            onRequestedMessageOpen?.();
          });
        }
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    activeChannelId,
    onRequestedMessageOpen,
    organizationId,
    requestedMessage,
    token,
  ]);

  // The change feed is organization-wide, so messages for other channels are
  // dropped here rather than filtered server-side.
  useEffect(() => {
    let stopped = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const delta = await loadChannelDelta(token, organizationId, cursor.current);
        if (stopped) return;
        cursor.current = delta.cursor;
        if (delta.channels.length || delta.removedChannelIds.length) {
          onChannelsChange((current) => {
            const byId = new Map(current.map((channel) => [channel.id, channel]));
            for (const channel of delta.channels) byId.set(channel.id, channel);
            for (const id of delta.removedChannelIds) byId.delete(id);
            return [...byId.values()].sort((left, right) =>
              left.name.localeCompare(right.name),
            );
          });
        }
        if (delta.agentReplies.length) {
          setReplies((current) => {
            const byId = new Map(current.map((reply) => [reply.id, reply]));
            for (const reply of delta.agentReplies) byId.set(reply.id, reply);
            return [...byId.values()];
          });
        }
        const relevant = delta.messages.filter(
          (message) => message.channelId === activeChannelId,
        );
        if (relevant.length || delta.removedMessageIds.length) {
          setMessages((current) =>
            mergeMessages(
              current,
              relevant.filter((message) => message.parentMessageId === null),
              delta.removedMessageIds,
            ),
          );
          setThreadParentId((parentId) => {
            if (parentId) {
              const threadUpdates = relevant.filter(
                (message) =>
                  message.parentMessageId === parentId || message.id === parentId,
              );
              if (threadUpdates.length) {
                setThreadMessages((current) =>
                  mergeMessages(current, threadUpdates, delta.removedMessageIds),
                );
              }
            }
            return parentId;
          });
        }
      } catch {
        // A dropped poll is retried on the next interval.
      }
    };
    const timer = window.setInterval(() => void tick(), CHANNEL_POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeChannelId, onChannelsChange, organizationId, token]);

  useEffect(() => {
    if (
      activeChannelId &&
      channels.length > 0 &&
      !channels.some((channel) => channel.id === activeChannelId)
    ) {
      onChannelSelect(channels[0]?.id ?? null);
    }
  }, [activeChannelId, channels, onChannelSelect]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView?.({ block: "end" });
  }, [messages, activeChannelId, replies.length]);

  const openThread = useCallback(
    async (parentId: string) => {
      if (!activeChannelId) return;
      setThreadParentId(parentId);
      try {
        const result = await listChannelMessages(
          token,
          organizationId,
          activeChannelId,
          parentId,
        );
        setThreadMessages(result.messages);
      } catch (cause) {
        setError(errorMessage(cause));
      }
    },
    [activeChannelId, organizationId, token],
  );

  const send = useCallback(
    async (
      body: string,
      mentions: MentionTarget[],
      parentMessageId: string | null,
      attachments: File[],
      attachmentReferences: string[],
    ) => {
      if (!activeChannelId || !body.trim()) return;
      setBusy(true);
      setError(null);
      try {
        const result = await sendChannelMessage(token, organizationId, activeChannelId, {
          body: body.trim(),
          parentMessageId,
          mentionedUserIds: mentions
            .filter((mention) => mention.type === "user")
            .map((mention) => mention.id),
          mentionedAgentIds: mentions
            .filter((mention) => mention.type === "agent")
            .map((mention) => mention.id),
          attachments,
          attachmentReferences,
        });
        setReplies((current) => [...current, ...result.agentReplies]);
        if (parentMessageId) {
          setThreadMessages((current) => mergeMessages(current, [result.message], []));
        } else {
          setMessages((current) => mergeMessages(current, [result.message], []));
        }
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [activeChannelId, organizationId, token],
  );

  const acceptProposal = useCallback(
    async (message: ChannelMessage) => {
      if (!activeChannelId || !message.proposal) return;
      setBusy(true);
      try {
        const result = await acceptChannelProposal(
          token,
          organizationId,
          activeChannelId,
          message.proposal.id,
          message.proposal.projectId ?? activeChannel?.defaultProjectId ?? null,
        );
        if (result.resultRunId) onIssueCreated?.(result.resultRunId);
      } catch (cause) {
        setError(errorMessage(cause));
      } finally {
        setBusy(false);
      }
    },
    [
      activeChannel?.defaultProjectId,
      activeChannelId,
      onIssueCreated,
      organizationId,
      token,
    ],
  );

  const pendingReplies = replies.filter(
    (reply) => reply.status === "queued" || reply.status === "running",
  );

  const memberCount = Math.max(activeChannel?.memberCount ?? 0, members.length);
  let lastDay: string | null = null;

  return (
    <div
      className={`channels${isResizingThread ? " is-resizing-thread" : ""}`}
      ref={channelsRef}
      style={
        threadWidth === null
          ? undefined
          : ({
              "--channel-thread-width": `${threadWidth}%`,
            } as CSSProperties)
      }
    >
      <section className="channel-main">
        {activeChannel ? (
          <>
            <header className="channel-header">
              <div className="channel-header-title">
                {activeChannel.visibility === "private" ? (
                  <Lock size={16} aria-hidden="true" />
                ) : (
                  <Hash size={16} aria-hidden="true" />
                )}
                <h2>{activeChannel.name}</h2>
              </div>
              <div className="channel-header-actions">
                <button
                  type="button"
                  className="channel-header-icon"
                  aria-label={t("channel.headerMembers", { count: memberCount })}
                  title={t("channel.headerMembers", { count: memberCount })}
                >
                  <LayoutGrid size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="channel-header-icon channel-header-members"
                  aria-label={t("channel.headerMembers", { count: memberCount })}
                  onClick={openInvite}
                >
                  <Users size={16} aria-hidden="true" />
                  <span>{memberCount}</span>
                </button>
                <button
                  type="button"
                  className="channel-header-icon"
                  aria-label={t("channel.headerHuddle")}
                  title={t("channel.headerHuddle")}
                >
                  <Headphones size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="channel-header-icon"
                  aria-label={t("channel.headerMore")}
                  title={t("channel.headerMore")}
                >
                  <MoreHorizontal size={16} aria-hidden="true" />
                </button>
              </div>
            </header>

            {error ? <div className="channel-error">{error}</div> : null}

            <div className="channel-messages">
              <ChannelWelcome
                channel={activeChannel}
                onCreateAgent={onCreateAgent}
                onAddPeople={openInvite}
              />

              {messages.map((message) => {
                const currentDay = dayKey(message.createdAt, localeTag);
                const showDay = currentDay !== lastDay;
                lastDay = currentDay;
                return (
                  <div key={message.id} className="channel-message-block">
                    {showDay ? (
                      <div className="channel-day-separator">
                        <span>
                          {formatDayLabel(message.createdAt, localeTag, t)}
                        </span>
                      </div>
                    ) : null}
                    <MessageRow
                      agents={agents}
                      message={message}
                      members={members}
                      localeTag={localeTag}
                      currentUserId={currentUserId}
                      onAcceptProposal={() => void acceptProposal(message)}
                      onOpenThread={() => void openThread(message.id)}
                      busy={busy}
                      token={token}
                    />
                  </div>
                );
              })}

              {messages.length === 0 ? (
                <p className="channel-empty-hint muted">{t("channel.emptyHint")}</p>
              ) : null}

              {pendingReplies.length > 0 ? (
                <div className="channel-typing">
                  <LoaderCircle className="spin" size={15} />{" "}
                  {t("channel.agentTyping")}
                </div>
              ) : null}
              <div ref={messagesEndRef} />
            </div>

            <Composer
              agents={agents}
              busy={busy}
              members={members}
              currentUserId={currentUserId}
              channelName={activeChannel.name}
              onInvite={openInvite}
              onSend={(body, mentions, attachments, references) =>
                void send(body, mentions, null, attachments, references)
              }
            />
          </>
        ) : (
          <p className="muted channel-empty">{t("channel.selectPrompt")}</p>
        )}
      </section>

      {threadParentId && activeChannel ? (
        <>
          <div
            aria-label={t("channel.resizeThread")}
            aria-orientation="vertical"
            aria-valuemax={channelThreadWidthMax}
            aria-valuemin={channelThreadWidthMin}
            aria-valuenow={effectiveThreadWidth}
            className="channel-thread-resizer"
            role="separator"
            tabIndex={0}
            {...threadResizeProps}
          />
          <aside className="channel-thread">
          <header>
            <span>
              <MessageSquare size={15} /> {t("channel.thread")}
            </span>
            <button
              aria-label={t("channel.closeThread")}
              onClick={() => setThreadParentId(null)}
            >
              <X size={15} />
            </button>
          </header>
          <div className="channel-messages">
            {threadMessages.map((message) => (
              <MessageRow
                agents={agents}
                key={message.id}
                message={message}
                members={members}
                localeTag={localeTag}
                currentUserId={currentUserId}
                onAcceptProposal={() => void acceptProposal(message)}
                busy={busy}
                token={token}
              />
            ))}
          </div>
          <Composer
            agents={agents}
            busy={busy}
            members={members}
            currentUserId={currentUserId}
            channelName={activeChannel.name}
            onInvite={openInvite}
            placeholder={t("channel.threadPlaceholder")}
            onSend={(body, mentions, attachments, references) =>
              void send(
                body,
                mentions,
                threadParentId,
                attachments,
                references,
              )
            }
          />
          </aside>
        </>
      ) : null}

      {inviteOpen && activeChannel ? (
        <ChannelInviteDialog
          agents={inviteAgents}
          channel={activeChannel}
          channelAgents={agents}
          channelMembers={members}
          loading={inviteLoading}
          members={inviteMembers}
          saving={inviteSaving}
          error={inviteError}
          onAdd={(selected) => void addInvitees(selected)}
          onClose={() => {
            if (!inviteSaving) setInviteOpen(false);
          }}
        />
      ) : null}
    </div>
  );
}

function ChannelWelcome({
  channel,
  onCreateAgent,
  onAddPeople,
}: {
  channel: ChannelSummary;
  onCreateAgent?: () => void;
  onAddPeople?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="channel-welcome">
      <div className="channel-welcome-icon" aria-hidden="true">
        {channel.visibility === "private" ? <Lock size={28} /> : <Hash size={28} />}
      </div>
      <h3>
        {channel.visibility === "private" ? (
          <Lock size={18} aria-hidden="true" />
        ) : (
          <Hash size={18} aria-hidden="true" />
        )}
        {channel.name}
      </h3>
      <p className="channel-welcome-lead">
        {t("channel.welcomeLead", { name: channel.name })}
      </p>
      {channel.topic ? (
        <p className="channel-welcome-topic">{channel.topic}</p>
      ) : (
        <p className="channel-welcome-topic">{t("channel.welcomeDefaultTopic")}</p>
      )}

      <div className="channel-welcome-actions">
        <button
          type="button"
          className="channel-welcome-card"
          onClick={onCreateAgent}
          disabled={!onCreateAgent}
        >
          <span className="channel-welcome-card-icon" aria-hidden="true">
            <Bot size={20} />
          </span>
          <strong>{t("channel.createAgent")}</strong>
          <span>{t("channel.createAgentHint")}</span>
        </button>
        <button
          type="button"
          className="channel-welcome-card"
          onClick={onAddPeople}
          disabled={!onAddPeople}
        >
          <span className="channel-welcome-card-icon" aria-hidden="true">
            <UserPlus size={20} />
          </span>
          <strong>{t("channel.addPeople")}</strong>
          <span>{t("channel.addPeopleHint")}</span>
        </button>
      </div>
    </div>
  );
}

function ChannelInviteDialog({
  agents,
  channel,
  channelAgents,
  channelMembers,
  error,
  loading,
  members,
  saving,
  onAdd,
  onClose,
}: {
  agents: ChannelAgentSummary[];
  channel: ChannelSummary;
  channelAgents: ChannelAgentSummary[];
  channelMembers: ChannelMember[];
  error: string | null;
  loading: boolean;
  members: OrganizationMember[];
  saving: boolean;
  onAdd: (selected: ChannelInviteCandidate[]) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const titleId = useId();
  const [query, setQuery] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving]);

  const candidates = useMemo<ChannelInviteCandidate[]>(() => {
    const channelMemberIds = new Set(
      channelMembers.map((member) => member.userId),
    );
    const channelAgentIds = new Set(
      channelAgents.map((agent) => agent.agentId),
    );
    return [
      ...members
        .filter((member) => !channelMemberIds.has(member.userId))
        .map((member) => ({
          type: "user" as const,
          id: member.userId,
          member,
        })),
      ...agents
        .filter((agent) => !channelAgentIds.has(agent.agentId))
        .map((agent) => ({
          type: "agent" as const,
          id: agent.agentId,
          agent,
        })),
    ];
  }, [agents, channelAgents, channelMembers, members]);

  const normalizedQuery = query.trim().toLowerCase();
  const filtered = candidates.filter((candidate) => {
    if (!normalizedQuery) return true;
    const searchable =
      candidate.type === "user"
        ? `${candidate.member.name} ${candidate.member.email}`
        : `${candidate.agent.name} ${candidate.agent.handle ?? ""} ${candidate.agent.provider} ${candidate.agent.responsibility} ${candidate.agent.skills.map((skill) => skill.name).join(" ")}`;
    return searchable.toLowerCase().includes(normalizedQuery);
  });

  const toggle = (candidate: ChannelInviteCandidate) => {
    const key = `${candidate.type}:${candidate.id}`;
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const selected = candidates.filter((candidate) =>
    selectedKeys.has(`${candidate.type}:${candidate.id}`),
  );

  return (
    <div
      className="channel-invite-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        aria-labelledby={titleId}
        aria-modal="true"
        className="channel-invite-dialog"
        role="dialog"
      >
        <header>
          <div>
            <h2 id={titleId}>
              {t("channel.inviteTitle", { name: channel.name })}
            </h2>
            <p>{t("channel.inviteDescription")}</p>
          </div>
          <button
            aria-label={t("common.close")}
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            <X size={20} />
          </button>
        </header>

        <label className="channel-invite-search">
          <Search aria-hidden="true" size={17} />
          <input
            autoFocus
            disabled={loading || saving}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("channel.inviteSearchPlaceholder")}
            type="search"
            value={query}
          />
        </label>

        <div className="channel-invite-results">
          {loading ? (
            <p className="channel-invite-status">
              <LoaderCircle className="spin" size={16} />
              {t("channel.inviteLoading")}
            </p>
          ) : filtered.length > 0 ? (
            filtered.map((candidate) => {
              const key = `${candidate.type}:${candidate.id}`;
              const checked = selectedKeys.has(key);
              const name =
                candidate.type === "user"
                  ? candidate.member.name
                  : candidate.agent.name;
              const detail =
                candidate.type === "user"
                  ? candidate.member.email
                  : candidate.agent.projectId
                    ? t("channel.projectAgent")
                    : t("channel.orgAgent");
              const image =
                candidate.type === "user" ? candidate.member.image : null;
              return (
                <button
                  aria-pressed={checked}
                  className="channel-invite-candidate"
                  disabled={saving}
                  key={key}
                  onClick={() => toggle(candidate)}
                  type="button"
                >
                  <span className={`channel-invite-avatar ${candidate.type}`}>
                    {image ? (
                      <img alt="" src={image} />
                    ) : candidate.type === "agent" ? (
                      <Bot aria-hidden="true" size={18} />
                    ) : (
                      authorInitial(name)
                    )}
                  </span>
                  <span>
                    <strong>{name}</strong>
                    <small>{detail}</small>
                  </span>
                  <i aria-hidden="true">{checked ? <Check size={15} /> : null}</i>
                </button>
              );
            })
          ) : (
            <p className="channel-invite-status">
              {candidates.length === 0
                ? t("channel.inviteEveryoneAdded")
                : t("channel.inviteNoResults")}
            </p>
          )}
        </div>

        {error ? (
          <p className="channel-invite-error" role="alert">
            {error}
          </p>
        ) : null}

        <footer>
          <span>
            {selected.length > 0
              ? t("channel.inviteSelected", { count: selected.length })
              : t("channel.inviteSelectHint")}
          </span>
          <button
            disabled={selected.length === 0 || loading || saving}
            onClick={() => onAdd(selected)}
            type="button"
          >
            {saving ? t("channel.inviting") : t("channel.inviteAdd")}
          </button>
        </footer>
      </section>
    </div>
  );
}

function MessageRow({
  agents,
  message,
  members,
  localeTag,
  currentUserId,
  onOpenThread,
  onAcceptProposal,
  busy,
  token,
}: {
  agents: ChannelAgentSummary[];
  message: ChannelMessage;
  members: ChannelMember[];
  localeTag: string;
  currentUserId: string | null;
  onOpenThread?: () => void;
  onAcceptProposal: () => void;
  busy: boolean;
  token: string;
}) {
  const { t } = useI18n();
  const isAgent = message.author.type === "agent";
  const isSelf =
    message.author.type === "user" && message.author.id === currentUserId;
  const displayName = isSelf ? t("channel.you") : message.author.name;
  const image =
    message.author.type === "user" ? message.author.image : null;

  return (
    <article
      className={`channel-message ${message.author.type}`}
      data-channel-message-id={message.id}
    >
      <div className="channel-message-avatar" aria-hidden="true">
        {image ? (
          <img alt="" src={image} />
        ) : isAgent ? (
          <span className="channel-message-avatar-fallback agent">
            <Bot size={16} />
          </span>
        ) : (
          <span className="channel-message-avatar-fallback">
            {authorInitial(message.author.name)}
          </span>
        )}
      </div>
      <div className="channel-message-body">
        <header>
          <strong>{displayName}</strong>
          {message.author.type === "agent" ? (
            <span className="channel-agent-badge">
              <Bot size={12} /> {message.author.provider ?? "agent"}
            </span>
          ) : null}
          <time dateTime={message.createdAt}>
            {formatMessageTime(message.createdAt, localeTag)}
          </time>
        </header>
        <ChannelMessageText agents={agents} members={members} message={message} />
        <ChannelMessageImages attachments={message.attachments} token={token} />

        {message.document ? (
          <div className="channel-document-card">
            <FileText size={15} />
            <div>
              <strong>{message.document.title}</strong>
              <span>
                {t("channel.planDocument")}
                {message.document.projectId ? "" : ` · ${t("channel.orgDocument")}`}
              </span>
            </div>
          </div>
        ) : null}

        {message.proposal ? (
          <div className="channel-proposal-card">
            <div>
              <strong>{t("channel.issueProposal")}</strong>
              <span>
                {message.proposal.status === "accepted"
                  ? t("channel.issueProposalAccepted")
                  : t("channel.issueProposalPending")}
              </span>
            </div>
            {message.proposal.status === "pending" ? (
              <button disabled={busy} onClick={onAcceptProposal}>
                {t("channel.createIssue")}
              </button>
            ) : null}
          </div>
        ) : null}

        {onOpenThread ? (
          <button className="channel-thread-link" onClick={onOpenThread}>
            <MessageSquare size={13} />
            {message.replyCount > 0
              ? t("channel.replyCount", { count: message.replyCount })
              : t("channel.replyInThread")}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function Composer({
  agents,
  members,
  currentUserId,
  channelName,
  placeholder,
  busy,
  onInvite,
  onSend,
}: {
  agents: ChannelAgentSummary[];
  members: ChannelMember[];
  currentUserId: string | null;
  channelName: string;
  placeholder?: string;
  busy: boolean;
  onInvite: () => void;
  onSend: (
    body: string,
    mentions: MentionTarget[],
    attachments: File[],
    attachmentReferences: string[],
  ) => void;
}) {
  const { t } = useI18n();
  const {
    activeSuggestionIndex,
    attachmentError,
    attachmentInputRef,
    body,
    dragging,
    handleCaret,
    handleChange,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFileChange,
    handleKeyDown,
    handlePaste,
    handleSubmit,
    images,
    inputRef: textareaRef,
    insertAtCaret,
    mentionListId,
    pickSuggestion,
    removeImage,
    setActiveSuggestionIndex,
    showsSuggestions,
    suggestions,
  } = useChannelComposer<HTMLTextAreaElement>({
    agents,
    busy,
    currentUserId,
    members,
    onInvite,
    onSend,
    submitOnEnter: true,
  });

  const resolvedPlaceholder =
    placeholder ?? t("channel.messagePlaceholder", { name: channelName });

  return (
    <form
      className={`channel-composer${dragging ? " is-dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onSubmit={handleSubmit}
    >
      {showsSuggestions ? (
        <ChannelMentionMenu
          activeSuggestionIndex={activeSuggestionIndex}
          ariaLabel={t("channel.mentionCandidates")}
          id={mentionListId}
          onActiveSuggestionIndexChange={setActiveSuggestionIndex}
          onPickSuggestion={pickSuggestion}
          suggestions={suggestions}
          variant="desktop"
        />
      ) : null}

      <div className="channel-composer-shell">
        <ChannelDraftImages images={images} onRemove={removeImage} />
        <textarea
          aria-activedescendant={
            showsSuggestions
              ? `${mentionListId}-option-${activeSuggestionIndex}`
              : undefined
          }
          aria-autocomplete="list"
          aria-controls={showsSuggestions ? mentionListId : undefined}
          aria-expanded={showsSuggestions}
          aria-label={t("channel.messageAria")}
          disabled={busy}
          placeholder={resolvedPlaceholder}
          value={body}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onKeyUp={handleCaret}
          onPaste={handlePaste}
          onClick={handleCaret}
          ref={textareaRef}
          role="combobox"
          rows={1}
        />
        <div className="channel-composer-toolbar">
          <div className="channel-composer-tools">
            <button
              type="button"
              className="channel-composer-tool"
              aria-label={t("channel.toolMention")}
              onClick={() => insertAtCaret("@")}
              disabled={busy}
            >
              <AtSign size={16} />
            </button>
            <button
              type="button"
              className="channel-composer-tool"
              aria-label={t("channel.toolAttach")}
              disabled={busy || images.length >= maxIssueAttachmentCount}
              onClick={() => attachmentInputRef.current?.click()}
            >
              <Paperclip size={16} />
            </button>
            <input
              accept="image/*"
              className="channel-composer-file-input"
              disabled={busy || images.length >= maxIssueAttachmentCount}
              multiple
              onChange={handleFileChange}
              ref={attachmentInputRef}
              type="file"
            />
            <button
              type="button"
              className="channel-composer-tool"
              aria-label={t("channel.toolFormat")}
              disabled
              title={t("channel.toolComingSoon")}
            >
              <Type size={16} />
            </button>
          </div>
          <button
            aria-label={t("channel.send")}
            className="channel-composer-send"
            disabled={busy || (!body.trim() && images.length === 0)}
            type="submit"
          >
            <Send size={16} />
          </button>
        </div>
        {attachmentError ? (
          <p className="channel-composer-error">{attachmentError}</p>
        ) : null}
      </div>
    </form>
  );
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
