import {
  AtSign,
  Bot,
  FileText,
  Hash,
  Headphones,
  LayoutGrid,
  LoaderCircle,
  Lock,
  MessageSquare,
  MoreHorizontal,
  Paperclip,
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
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useI18n } from "../i18n";
import {
  acceptChannelProposal,
  listChannelMessages,
  listChannels,
  loadChannel,
  loadChannelDelta,
  sendChannelMessage,
} from "../lib/api";
import type {
  ChannelAgentReply,
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
  ChannelSummary,
} from "../lib/channels-contract";
import {
  mentionAtCaret,
  mentionHandle,
  retainedMentions,
  type MentionTarget,
} from "../lib/channel-mentions";
import {
  dataTransferHasFiles,
  filesFromDataTransfer,
  maxIssueAttachmentCount,
  normalizeIssueAttachmentFile,
  validateIssueAttachments,
} from "../lib/issue-attachments";
import {
  ChannelDraftImages,
  ChannelMessageImages,
  channelBodyWithImages,
  channelBodyWithoutImages,
  draftChannelImage,
  type DraftChannelImage,
} from "./ChannelImages";
import {
  channelThreadWidthDefault,
  channelThreadWidthMax,
  channelThreadWidthMin,
  clampChannelThreadWidth,
  loadChannelThreadWidth,
  saveChannelThreadWidth,
} from "../lib/channel-thread-width";

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
  onAddPeople?: () => void;
};

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
  onCreateAgent,
  onAddPeople,
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
  const [threadWidth, setThreadWidth] = useState<number | null>(() =>
    loadChannelThreadWidth(),
  );
  const [isResizingThread, setIsResizingThread] = useState(false);
  const cursor = useRef(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const channelsRef = useRef<HTMLDivElement | null>(null);
  const threadWidthRef = useRef<number | null>(threadWidth);
  threadWidthRef.current = threadWidth;
  const activeThreadResizePointerRef = useRef<number | null>(null);
  const activeChannelIdRef = useRef(activeChannelId);
  activeChannelIdRef.current = activeChannelId;

  const activeChannel = useMemo(
    () => channels.find((channel) => channel.id === activeChannelId) ?? null,
    [channels, activeChannelId],
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
        setThreadParentId(null);
        setThreadMessages([]);
      } catch (cause) {
        if (!cancelled) setError(errorMessage(cause));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeChannelId, organizationId, token]);

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

  const effectiveThreadWidth = threadWidth ?? channelThreadWidthDefault;

  const updateThreadWidthFromPointer = (clientX: number) => {
    const layout = channelsRef.current;
    if (!layout) return;
    const bounds = layout.getBoundingClientRect();
    const availableWidth = Math.max(1, bounds.width);
    const paneWidth = Math.max(0, (bounds.right - clientX) / availableWidth);
    const width = clampChannelThreadWidth(paneWidth * 100);
    setThreadWidth(width);
    threadWidthRef.current = width;
  };

  const startThreadResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    activeThreadResizePointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizingThread(true);
    event.preventDefault();
  };

  const moveThreadResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeThreadResizePointerRef.current !== event.pointerId) return;
    updateThreadWidthFromPointer(event.clientX);
  };

  const finishThreadResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activeThreadResizePointerRef.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    activeThreadResizePointerRef.current = null;
    setIsResizingThread(false);
    const width = threadWidthRef.current;
    if (width !== null) saveChannelThreadWidth(width);
  };

  const resizeThreadWithKeyboard = (
    event: ReactKeyboardEvent<HTMLDivElement>,
  ) => {
    let nextWidth: number | null = null;
    if (event.key === "ArrowLeft") {
      nextWidth = effectiveThreadWidth - 5;
    }
    if (event.key === "ArrowRight") {
      nextWidth = effectiveThreadWidth + 5;
    }
    if (event.key === "Home") {
      nextWidth = channelThreadWidthMin;
    }
    if (event.key === "End") {
      nextWidth = channelThreadWidthMax;
    }
    if (nextWidth === null) return;
    event.preventDefault();
    const width = clampChannelThreadWidth(nextWidth);
    setThreadWidth(width);
    threadWidthRef.current = width;
    saveChannelThreadWidth(width);
  };

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
                  onClick={onAddPeople}
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
                onAddPeople={onAddPeople}
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
                      message={message}
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
            onKeyDown={resizeThreadWithKeyboard}
            onPointerCancel={finishThreadResize}
            onPointerDown={startThreadResize}
            onPointerMove={moveThreadResize}
            onPointerUp={finishThreadResize}
            role="separator"
            tabIndex={0}
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
                key={message.id}
                message={message}
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

function MessageRow({
  message,
  localeTag,
  currentUserId,
  onOpenThread,
  onAcceptProposal,
  busy,
  token,
}: {
  message: ChannelMessage;
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
    <article className={`channel-message ${message.author.type}`}>
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
        {channelBodyWithoutImages(message.body) ? (
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {channelBodyWithoutImages(message.body)}
          </ReactMarkdown>
        ) : null}
        <ChannelMessageImages attachments={message.attachments} token={token} />

        {message.document ? (
          <div className="channel-document-card">
            <FileText size={15} />
            <div>
              <strong>{message.document.title}</strong>
              <span>
                {t("channel.planDocument")} · v{message.document.version}
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
  onSend,
}: {
  agents: ChannelAgentSummary[];
  members: ChannelMember[];
  currentUserId: string | null;
  channelName: string;
  placeholder?: string;
  busy: boolean;
  onSend: (
    body: string,
    mentions: MentionTarget[],
    attachments: File[],
    attachmentReferences: string[],
  ) => void;
}) {
  const { t } = useI18n();
  const [body, setBody] = useState("");
  const [caret, setCaret] = useState(0);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  // Mentions are tracked as picked entities, never re-parsed from the text:
  // the server trusts this list, so a handle typed by hand is just text.
  const [mentions, setMentions] = useState<MentionTarget[]>([]);
  const [images, setImages] = useState<DraftChannelImage[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const mentionListId = useId();

  const resolvedPlaceholder =
    placeholder ?? t("channel.messagePlaceholder", { name: channelName });

  const candidates = useMemo<MentionTarget[]>(
    () => [
      ...agents.map((agent) => ({
        type: "agent" as const,
        id: agent.agentId,
        handle: mentionHandle(agent.handle?.trim() || agent.name),
        label: agent.name,
        detail: agent.projectId
          ? t("channel.projectAgent")
          : t("channel.orgAgent"),
      })),
      ...members.map((member) => ({
        type: "user" as const,
        id: member.userId,
        handle: mentionHandle(member.email.split("@")[0] || member.userId),
        label: member.name,
        detail:
          member.userId === currentUserId
            ? t("channel.mentionSelf", { email: member.email })
            : member.email,
        image: member.image,
      })),
    ],
    [agents, members, currentUserId, t],
  );

  const query = mentionAtCaret(body, caret);
  const suggestions = query
    ? candidates
        .filter((candidate) =>
          `${candidate.handle} ${candidate.label}`
            .toLowerCase()
            .includes(query.query.toLowerCase()),
        )
        .slice(0, 6)
    : [];
  const showsSuggestions = !mentionDismissed && suggestions.length > 0;

  useEffect(() => {
    setActiveSuggestionIndex(0);
  }, [query?.query]);

  useEffect(() => {
    if (pendingCaret.current === null) return;
    const nextCaret = pendingCaret.current;
    pendingCaret.current = null;
    textareaRef.current?.focus();
    textareaRef.current?.setSelectionRange(nextCaret, nextCaret);
  }, [body]);

  const pick = (target: MentionTarget) => {
    if (!query) return;
    const inserted = `@${target.handle} `;
    const nextCaret = query.start + inserted.length;
    setBody(`${body.slice(0, query.start)}${inserted}${body.slice(query.end)}`);
    setCaret(nextCaret);
    pendingCaret.current = nextCaret;
    setMentionDismissed(true);
    setMentions((current) =>
      current.some(
        (mention) => mention.id === target.id && mention.type === target.type,
      )
        ? current
        : [...current, target],
    );
  };

  const insertAt = (text: string) => {
    const start = textareaRef.current?.selectionStart ?? body.length;
    const end = textareaRef.current?.selectionEnd ?? body.length;
    const next = `${body.slice(0, start)}${text}${body.slice(end)}`;
    const nextCaret = start + text.length;
    setBody(next);
    setCaret(nextCaret);
    pendingCaret.current = nextCaret;
    setMentionDismissed(false);
    textareaRef.current?.focus();
  };

  const addImages = (files: readonly File[]) => {
    const normalized = files.map(normalizeIssueAttachmentFile);
    if (
      normalized.length === 0 ||
      normalized.some((file) => !file.type.startsWith("image/"))
    ) {
      setAttachmentError(t("channel.imageOnly"));
      return;
    }
    const next = [...images, ...normalized.map(draftChannelImage)];
    const validationError = validateIssueAttachments(
      next.map((image) => image.file),
    );
    if (validationError) {
      setAttachmentError(validationError);
      return;
    }
    setImages(next);
    setAttachmentError(null);
  };

  const submit = () => {
    if ((!body.trim() && images.length === 0) || busy) return;
    onSend(
      channelBodyWithImages(body, images),
      retainedMentions(body, mentions),
      images.map((image) => image.file),
      images.map((image) => image.reference),
    );
    setBody("");
    setImages([]);
    setMentions([]);
    setMentionDismissed(false);
  };

  return (
    <form
      className={`channel-composer${dragging ? " is-dragging" : ""}`}
      onDragEnter={(event) => {
        if (!dataTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => {
        if (!dataTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDragging(false);
        }
      }}
      onDrop={(event) => {
        if (!dataTransferHasFiles(event.dataTransfer)) return;
        event.preventDefault();
        setDragging(false);
        addImages(filesFromDataTransfer(event.dataTransfer));
      }}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {showsSuggestions ? (
        <ul
          aria-label={t("channel.mentionCandidates")}
          className="channel-mention-menu"
          id={mentionListId}
          role="listbox"
        >
          {suggestions.map((target, index) => (
            <li key={`${target.type}:${target.id}`}>
              <button
                aria-selected={index === activeSuggestionIndex}
                className={index === activeSuggestionIndex ? "active" : undefined}
                id={`${mentionListId}-option-${index}`}
                onClick={() => pick(target)}
                onMouseEnter={() => setActiveSuggestionIndex(index)}
                role="option"
                type="button"
              >
                {target.image ? (
                  <img alt="" src={target.image} />
                ) : target.type === "agent" ? (
                  <Bot size={15} />
                ) : (
                  <span className="channel-mention-avatar">
                    {target.label.trim().charAt(0).toUpperCase() || "?"}
                  </span>
                )}
                <strong>@{target.handle}</strong>
                <span>{target.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="channel-composer-shell">
        <ChannelDraftImages
          images={images}
          onRemove={(reference) => {
            setImages((current) =>
              current.filter((image) => image.reference !== reference),
            );
            setAttachmentError(null);
          }}
        />
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
          onChange={(event) => {
            setBody(event.target.value);
            setCaret(event.target.selectionStart ?? event.target.value.length);
            setMentionDismissed(false);
          }}
          onKeyDown={(event) => {
            if (showsSuggestions) {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                const offset = event.key === "ArrowDown" ? 1 : -1;
                setActiveSuggestionIndex(
                  (index) =>
                    (index + offset + suggestions.length) % suggestions.length,
                );
                return;
              }
              if (event.key === "Enter" || event.key === "Tab") {
                event.preventDefault();
                const target = suggestions[activeSuggestionIndex] ?? suggestions[0];
                if (target) pick(target);
                return;
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setMentionDismissed(true);
                return;
              }
            }
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          onKeyUp={(event) =>
            setCaret(event.currentTarget.selectionStart ?? 0)
          }
          onPaste={(event) => {
            const pasted = filesFromDataTransfer(event.clipboardData).filter(
              (file) => file.type.startsWith("image/"),
            );
            if (pasted.length === 0) return;
            event.preventDefault();
            addImages(pasted);
          }}
          onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
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
              onClick={() => insertAt("@")}
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
              onChange={(event) => {
                addImages(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
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
