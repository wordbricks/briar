import {
  Bot,
  FileText,
  Hash,
  LoaderCircle,
  Lock,
  MessageSquare,
  Send,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
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

export function Channels({
  organizationId,
  token,
  currentUserId,
  channels,
  activeChannelId,
  onChannelSelect,
  onChannelsChange,
  onIssueCreated,
}: ChannelsProps) {
  const [members, setMembers] = useState<ChannelMember[]>([]);
  const [agents, setAgents] = useState<ChannelAgentSummary[]>([]);
  const [messages, setMessages] = useState<ChannelMessage[]>([]);
  const [replies, setReplies] = useState<ChannelAgentReply[]>([]);
  const [threadParentId, setThreadParentId] = useState<string | null>(null);
  const [threadMessages, setThreadMessages] = useState<ChannelMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cursor = useRef(0);
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
    async (body: string, mentions: MentionTarget[], parentMessageId: string | null) => {
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

  return (
    <div className="channels">
      <section className="channel-main">
        {activeChannel ? (
          <>
            <header className="channel-header">
              <h2>
                {activeChannel.visibility === "private" ? (
                  <Lock size={16} />
                ) : (
                  <Hash size={16} />
                )}
                {activeChannel.name}
              </h2>
              {activeChannel.topic ? <p>{activeChannel.topic}</p> : null}
              <div className="channel-roster">
                {agents.map((agent) => (
                  <span key={agent.agentId} title={agent.responsibility}>
                    <Bot size={13} />@{agent.handle ?? agent.name}
                    {agent.projectId ? null : <em> · 조직</em>}
                  </span>
                ))}
              </div>
            </header>

            {error ? <div className="channel-error">{error}</div> : null}

            <div className="channel-messages">
              {messages.map((message) => (
                <MessageRow
                  key={message.id}
                  message={message}
                  onAcceptProposal={() => void acceptProposal(message)}
                  onOpenThread={() => void openThread(message.id)}
                  busy={busy}
                />
              ))}
              {messages.length === 0 ? (
                <p className="muted">첫 메시지를 남겨보세요.</p>
              ) : null}
              {pendingReplies.length > 0 ? (
                <div className="channel-typing">
                  <LoaderCircle className="spin" size={15} /> 에이전트가 답변을
                  작성하고 있습니다…
                </div>
              ) : null}
            </div>

            <Composer
              agents={agents}
              busy={busy}
              members={members}
              currentUserId={currentUserId}
              placeholder={`#${activeChannel.name}에 메시지 보내기`}
              onSend={(body, mentions) => void send(body, mentions, null)}
            />
          </>
        ) : (
          <p className="muted channel-empty">채널을 선택하세요.</p>
        )}
      </section>

      {threadParentId && activeChannel ? (
        <aside className="channel-thread">
          <header>
            <span>
              <MessageSquare size={15} /> 스레드
            </span>
            <button aria-label="스레드 닫기" onClick={() => setThreadParentId(null)}>
              <X size={15} />
            </button>
          </header>
          <div className="channel-messages">
            {threadMessages.map((message) => (
              <MessageRow
                key={message.id}
                message={message}
                onAcceptProposal={() => void acceptProposal(message)}
                busy={busy}
              />
            ))}
          </div>
          <Composer
            agents={agents}
            busy={busy}
            members={members}
            currentUserId={currentUserId}
            placeholder="스레드에 답글 남기기"
            onSend={(body, mentions) => void send(body, mentions, threadParentId)}
          />
        </aside>
      ) : null}
    </div>
  );
}

function MessageRow({
  message,
  onOpenThread,
  onAcceptProposal,
  busy,
}: {
  message: ChannelMessage;
  onOpenThread?: () => void;
  onAcceptProposal: () => void;
  busy: boolean;
}) {
  return (
    <article className={`channel-message ${message.author.type}`}>
      <header>
        <strong>{message.author.name}</strong>
        {message.author.type === "agent" ? (
          <span className="channel-agent-badge">
            <Bot size={12} /> {message.author.provider ?? "agent"}
          </span>
        ) : null}
        <time>{new Date(message.createdAt).toLocaleTimeString()}</time>
      </header>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.body}</ReactMarkdown>

      {message.document ? (
        <div className="channel-document-card">
          <FileText size={15} />
          <div>
            <strong>{message.document.title}</strong>
            <span>
              계획서 · v{message.document.version}
              {message.document.projectId ? "" : " · 조직 문서"}
            </span>
          </div>
        </div>
      ) : null}

      {message.proposal ? (
        <div className="channel-proposal-card">
          <div>
            <strong>이슈 생성 제안</strong>
            <span>
              {message.proposal.status === "accepted"
                ? "승인되어 이슈가 생성되었습니다."
                : "승인하면 이슈가 생성됩니다."}
            </span>
          </div>
          {message.proposal.status === "pending" ? (
            <button disabled={busy} onClick={onAcceptProposal}>
              이슈 만들기
            </button>
          ) : null}
        </div>
      ) : null}

      {onOpenThread ? (
        <button className="channel-thread-link" onClick={onOpenThread}>
          <MessageSquare size={13} />
          {message.replyCount > 0 ? `답글 ${message.replyCount}개` : "스레드에서 답글"}
        </button>
      ) : null}
    </article>
  );
}

function Composer({
  agents,
  members,
  currentUserId,
  placeholder,
  busy,
  onSend,
}: {
  agents: ChannelAgentSummary[];
  members: ChannelMember[];
  currentUserId: string | null;
  placeholder: string;
  busy: boolean;
  onSend: (body: string, mentions: MentionTarget[]) => void;
}) {
  const [body, setBody] = useState("");
  const [caret, setCaret] = useState(0);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  // Mentions are tracked as picked entities, never re-parsed from the text:
  // the server trusts this list, so a handle typed by hand is just text.
  const [mentions, setMentions] = useState<MentionTarget[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
    [agents, members, currentUserId],
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

  const submit = () => {
    if (!body.trim() || busy) return;
    onSend(body, retainedMentions(body, mentions));
    setBody("");
    setMentions([]);
    setMentionDismissed(false);
  };

  return (
    <form
      className="channel-composer"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {showsSuggestions ? (
        <ul
          aria-label="멘션 후보"
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
      <textarea
        aria-activedescendant={
          showsSuggestions
            ? `${mentionListId}-option-${activeSuggestionIndex}`
            : undefined
        }
        aria-autocomplete="list"
        aria-controls={showsSuggestions ? mentionListId : undefined}
        aria-expanded={showsSuggestions}
        aria-label="채널 메시지"
        disabled={busy}
        placeholder={placeholder}
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
        onClick={(event) => setCaret(event.currentTarget.selectionStart ?? 0)}
        ref={textareaRef}
        role="combobox"
      />
      <button aria-label="메시지 보내기" disabled={busy || !body.trim()} type="submit">
        <Send size={17} />
      </button>
    </form>
  );
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}
