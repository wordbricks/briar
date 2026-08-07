import {
  Bot,
  ChevronLeft,
  FileText,
  Hash,
  LoaderCircle,
  Lock,
  MessageSquare,
  Plus,
  Send,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  listChannelMessages,
  listChannels,
  loadChannel,
  sendChannelMessage,
} from "../lib/api";
import {
  groupChannels,
  type ChannelGroupProject,
} from "../lib/channel-grouping";
import type {
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
import { useI18n } from "../i18n";
import {
  ChannelDraftImages,
  ChannelMessageImages,
  channelBodyWithImages,
  draftChannelImage,
  type DraftChannelImage,
} from "./ChannelImages";
import { ChannelMessageText } from "./ChannelMessageText";

type CompanionChannelsProps = {
  organizationId: string;
  activeProjectId: string | null;
  currentUserId: string | null;
  projects: readonly ChannelGroupProject[];
  token: string;
};

/**
 * Home on mobile is a channel list, then a channel's root messages, then one
 * message's thread. Each level replaces the previous one rather than opening a
 * side panel: a phone has no room for the desktop three-column layout.
 */
export function CompanionChannels({
  organizationId,
  activeProjectId,
  currentUserId,
  projects,
  token,
}: CompanionChannelsProps) {
  const { t } = useI18n();
  const [channels, setChannels] = useState<ChannelSummary[]>([]);
  const [channel, setChannel] = useState<ChannelSummary | null>(null);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [agents, setAgents] = useState<ChannelAgentSummary[]>([]);
  const [thread, setThread] = useState<ChannelMessage[] | null>(null);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await listChannels(token, organizationId);
        if (!cancelled) setChannels(result.channels);
      } catch (cause) {
        if (!cancelled) setError(message(cause));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [organizationId, token]);

  const groups = useMemo(
    () =>
      groupChannels(channels, {
        activeProjectId,
        projects,
        commonLabel: t("companion.channelsCommon"),
        unknownProjectLabel: t("companion.channelsOtherProject"),
      }),
    [activeProjectId, channels, projects, t],
  );

  const openChannel = useCallback(
    async (summary: ChannelSummary) => {
      setChannel(summary);
      setThread(null);
      setThreadParentId(null);
      setMessages([]);
      setMembers([]);
      setAgents([]);
      setLoading(true);
      try {
        const result = await loadChannel(token, organizationId, summary.id);
        setChannel(result.channel);
        setMessages(result.messages);
        setMembers(result.members);
        setAgents(result.agents);
      } catch (cause) {
        setError(message(cause));
      } finally {
        setLoading(false);
      }
    },
    [organizationId, token],
  );

  const openThread = useCallback(
    async (parent: ChannelMessage) => {
      if (!channel) return;
      setThreadParentId(parent.id);
      setThread(null);
      setLoading(true);
      try {
        const result = await listChannelMessages(
          token,
          organizationId,
          channel.id,
          parent.id,
        );
        setThread(result.messages);
      } catch (cause) {
        setError(message(cause));
      } finally {
        setLoading(false);
      }
    },
    [channel, organizationId, token],
  );

  const send = useCallback(
    async (
      body: string,
      mentions: MentionTarget[],
      attachments: File[],
      attachmentReferences: string[],
    ) => {
      if (!channel || !body.trim()) return;
      setBusy(true);
      try {
        const result = await sendChannelMessage(token, organizationId, channel.id, {
          body: body.trim(),
          parentMessageId: threadParentId,
          mentionedUserIds: mentions
            .filter((mention) => mention.type === "user")
            .map((mention) => mention.id),
          mentionedAgentIds: mentions
            .filter((mention) => mention.type === "agent")
            .map((mention) => mention.id),
          attachments,
          attachmentReferences,
        });
        if (threadParentId) {
          setThread((current) => [...(current ?? []), result.message]);
        } else {
          setMessages((current) => [...current, result.message]);
        }
      } catch (cause) {
        setError(message(cause));
      } finally {
        setBusy(false);
      }
    },
    [channel, organizationId, threadParentId, token],
  );

  if (channel && threadParentId) {
    return (
      <section className="companion-channels companion-channel-detail">
        <ChannelBar
          onBack={() => {
            setThreadParentId(null);
            setThread(null);
          }}
          title={t("companion.channelThread")}
        />
        {error ? <p className="companion-channel-error">{error}</p> : null}
        <div className="companion-channel-messages">
          {loading && !thread ? <Spinner /> : null}
          {(thread ?? []).map((item) => (
            <MessageRow
              agents={agents}
              key={item.id}
              members={members}
              message={item}
              token={token}
            />
          ))}
        </div>
        <CompanionChannelComposer
          agents={agents}
          busy={busy}
          currentUserId={currentUserId}
          members={members}
          onSend={send}
        />
      </section>
    );
  }

  if (channel) {
    return (
      <section className="companion-channels companion-channel-detail">
        <ChannelBar
          onBack={() => {
            setChannel(null);
            setMessages([]);
          }}
          title={channel.name}
          visibility={channel.visibility}
        />
        {error ? <p className="companion-channel-error">{error}</p> : null}
        <div className="companion-channel-messages">
          {loading && messages.length === 0 ? <Spinner /> : null}
          {messages.map((item) => (
            <MessageRow
              agents={agents}
              key={item.id}
              members={members}
              message={item}
              onOpenThread={() => void openThread(item)}
              showThreadSummary
              token={token}
            />
          ))}
          {!loading && messages.length === 0 ? (
            <p className="companion-channel-empty">
              {t("companion.channelsEmpty")}
            </p>
          ) : null}
        </div>
        <CompanionChannelComposer
          agents={agents}
          busy={busy}
          currentUserId={currentUserId}
          members={members}
          onSend={send}
        />
      </section>
    );
  }

  return (
    <section className="companion-channels">
      {error ? <p className="companion-channel-error">{error}</p> : null}
      {loading && channels.length === 0 ? <Spinner /> : null}
      {groups.map((group) => (
        <div className="companion-channel-group" key={group.key}>
          <h2 className="companion-channel-divider">{group.label}</h2>
          <ul>
            {group.channels.map((item) => (
              <li key={item.id}>
                <button onClick={() => void openChannel(item)} type="button">
                  {item.visibility === "private" ? (
                    <Lock size={15} />
                  ) : (
                    <Hash size={15} />
                  )}
                  <span>{item.name}</span>
                  {item.agentCount > 0 ? (
                    <i className="companion-channel-agent-count">
                      <Bot size={12} />
                      {item.agentCount}
                    </i>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {!loading && groups.length === 0 ? (
        <p className="companion-channel-empty">{t("companion.channelsEmpty")}</p>
      ) : null}
    </section>
  );
}

function ChannelBar({
  onBack,
  title,
  visibility,
}: {
  onBack: () => void;
  title: string;
  visibility?: "public" | "private";
}) {
  const { t } = useI18n();
  return (
    <header className="companion-channel-bar">
      <button aria-label={t("navigation.back")} onClick={onBack} type="button">
        <ChevronLeft size={18} />
      </button>
      {visibility === "private" ? <Lock size={15} /> : null}
      {visibility === "public" ? <Hash size={15} /> : null}
      <strong>{title}</strong>
    </header>
  );
}

function MessageRow({
  agents,
  members,
  message,
  onOpenThread,
  showThreadSummary = false,
  token,
}: {
  agents: ChannelAgentSummary[];
  members: ChannelMember[];
  message: ChannelMessage;
  onOpenThread?: () => void;
  showThreadSummary?: boolean;
  token: string;
}) {
  const { localeTag, t } = useI18n();
  return (
    <article className="companion-channel-message">
      <MessageAvatar message={message} />
      <div className="companion-channel-message-copy">
        <header>
          <strong>{message.author.name}</strong>
          {message.author.type === "agent" ? <Bot size={12} /> : null}
          <time>
            {new Date(message.createdAt).toLocaleTimeString(localeTag, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </header>
        <ChannelMessageText agents={agents} members={members} message={message} />
        <ChannelMessageImages
          attachments={message.attachments}
          interactive={!showThreadSummary}
          token={token}
        />
        {message.document ? (
          <span className="companion-channel-document">
            <FileText size={13} />
            {message.document.title}
          </span>
        ) : null}
        {showThreadSummary && onOpenThread ? (
          <button
            aria-label={`${t("run.viewThread")}: ${message.author.name} — ${message.body}`}
            className="companion-channel-message-button companion-channel-thread-summary"
            onClick={onOpenThread}
            type="button"
          >
            <MessageSquare size={14} />
            <strong>
              {message.replyCount > 0
                ? t("run.replies", { count: message.replyCount })
                : t("channel.replyInThread")}
            </strong>
            {message.lastReplyAt ? (
              <small>
                · {t("companion.channelLastReply", {
                  time: relativeTime(message.lastReplyAt, localeTag),
                })}
              </small>
            ) : null}
          </button>
        ) : null}
      </div>
    </article>
  );
}

function MessageAvatar({ message }: { message: ChannelMessage }) {
  if (message.author.type === "user" && message.author.image) {
    return (
      <img
        alt=""
        className="companion-channel-avatar"
        src={message.author.image}
      />
    );
  }
  return (
    <span
      aria-label={message.author.name}
      className={`companion-channel-avatar fallback ${message.author.type}`}
      role="img"
    >
      {message.author.type === "agent" ? (
        <Bot size={18} />
      ) : (
        message.author.name.trim().charAt(0).toUpperCase() || "?"
      )}
    </span>
  );
}

export function CompanionChannelComposer({
  agents,
  busy,
  currentUserId,
  members,
  onSend,
}: {
  agents: ChannelAgentSummary[];
  busy: boolean;
  currentUserId: string | null;
  members: ChannelMember[];
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
  const [mentions, setMentions] = useState<MentionTarget[]>([]);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [images, setImages] = useState<DraftChannelImage[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const pendingCaret = useRef<number | null>(null);
  const mentionListId = useId();
  const candidates = useMemo<MentionTarget[]>(
    () => [
      ...agents.map((agent) => ({
        type: "agent" as const,
        id: agent.agentId,
        handle: mentionHandle(agent.handle?.trim() || agent.name),
        label: agent.name,
        detail: agent.projectId ? "프로젝트 에이전트" : "조직 에이전트",
      })),
      ...members.map((member) => ({
          type: "user" as const,
          id: member.userId,
          handle: mentionHandle(member.email.split("@")[0] || member.userId),
          label: member.name,
          detail:
            member.userId === currentUserId ? `나 · ${member.email}` : member.email,
          image: member.image,
        })),
    ],
    [agents, currentUserId, members],
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

  useEffect(() => setActiveSuggestionIndex(0), [query?.query]);

  useEffect(() => {
    if (pendingCaret.current === null) return;
    const nextCaret = pendingCaret.current;
    pendingCaret.current = null;
    inputRef.current?.focus();
    inputRef.current?.setSelectionRange(nextCaret, nextCaret);
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

  return (
    <form
      className={`companion-channel-composer${dragging ? " is-dragging" : ""}`}
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
      }}
    >
      {showsSuggestions ? (
        <ul
          aria-label={t("run.mention")}
          className="companion-channel-mention-menu"
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
                ) : (
                  <span className={`companion-channel-mention-avatar ${target.type}`}>
                    {target.type === "agent" ? (
                      <Bot size={16} />
                    ) : (
                      target.label.trim().charAt(0).toUpperCase() || "?"
                    )}
                  </span>
                )}
                <span className="companion-channel-mention-copy">
                  <strong>{target.label}</strong>
                  <small>@{target.handle}</small>
                </span>
                <em>{target.detail}</em>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ChannelDraftImages
        images={images}
        onRemove={(reference) => {
          setImages((current) =>
            current.filter((image) => image.reference !== reference),
          );
          setAttachmentError(null);
        }}
      />
      <button
        aria-label={t("channel.toolAttach")}
        className="companion-channel-composer-add"
        disabled={busy || images.length >= maxIssueAttachmentCount}
        onClick={() => attachmentInputRef.current?.click()}
        type="button"
      >
        <Plus size={20} />
      </button>
      <input
        aria-activedescendant={
          showsSuggestions
            ? `${mentionListId}-option-${activeSuggestionIndex}`
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={showsSuggestions ? mentionListId : undefined}
        aria-expanded={showsSuggestions}
        aria-label={t("companion.channelMessagePlaceholder")}
        disabled={busy}
        onChange={(event) => {
          setBody(event.target.value);
          setCaret(event.target.selectionStart ?? event.target.value.length);
          setMentionDismissed(false);
        }}
        onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onKeyDown={(event) => {
          if (!showsSuggestions) return;
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const offset = event.key === "ArrowDown" ? 1 : -1;
            setActiveSuggestionIndex(
              (index) => (index + offset + suggestions.length) % suggestions.length,
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
          }
        }}
        onKeyUp={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        onPaste={(event) => {
          const pasted = filesFromDataTransfer(event.clipboardData).filter(
            (file) => file.type.startsWith("image/"),
          );
          if (pasted.length === 0) return;
          event.preventDefault();
          addImages(pasted);
        }}
        placeholder={t("companion.channelMessagePlaceholder")}
        ref={inputRef}
        role="combobox"
        value={body}
      />
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
      {body.trim() || images.length > 0 ? (
        <button aria-label={t("run.sendMessage")} disabled={busy} type="submit">
          <Send size={16} />
        </button>
      ) : null}
      {attachmentError ? (
        <p className="channel-composer-error">{attachmentError}</p>
      ) : null}
    </form>
  );
}

function relativeTime(value: string, locale: string) {
  const elapsedSeconds = Math.round(
    (new Date(value).getTime() - Date.now()) / 1_000,
  );
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  if (Math.abs(elapsedSeconds) < 3_600) {
    return formatter.format(Math.round(elapsedSeconds / 60), "minute");
  }
  if (Math.abs(elapsedSeconds) < 86_400) {
    return formatter.format(Math.round(elapsedSeconds / 3_600), "hour");
  }
  return formatter.format(Math.round(elapsedSeconds / 86_400), "day");
}

function Spinner() {
  return (
    <p className="companion-channel-loading">
      <LoaderCircle className="spin" size={16} />
    </p>
  );
}

function message(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
