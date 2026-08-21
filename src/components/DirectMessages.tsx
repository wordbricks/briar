import {
  Bot,
  Check,
  MessageCircle,
  Plus,
  Search,
  Users,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useI18n } from "../i18n";
import {
  createDirectMessage,
  listOrganizationAgents,
  loadOrganizationMembers,
} from "../lib/api";
import type {
  ChannelAgentSummary,
  ChannelSummary,
  DirectMessageParticipant,
} from "../lib/channels-contract";
import {
  directMessageDisplayName,
  directMessageParticipants,
  sortDirectMessages,
} from "../lib/direct-messages";
import type { AutoHuntSession } from "../hooks/useAutoHuntSessions";
import type { OrganizationMember, Project } from "../types";
import { Channels } from "./Channels";
import { Spinner } from "./ui/spinner";

type Candidate =
  | { type: "user"; id: string; name: string; image: string | null; detail: string }
  | { type: "agent"; id: string; name: string; image: string | null; detail: string };

type DirectMessagesProps = {
  organizationId: string;
  organizationName?: string;
  token: string;
  currentUserId: string | null;
  channels: ChannelSummary[];
  projects?: readonly Pick<Project, "id" | "name" | "organizationId">[];
  activeChannelId: string | null;
  channelCatalogCursor?: number | null;
  channelInboxSyncSignal?: string;
  onChannelSelect: (channelId: string | null) => void;
  onChannelsChange: Dispatch<SetStateAction<ChannelSummary[]>>;
  onIssueCreated?: (projectId: string, runId: string) => void | Promise<void>;
  onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  onViewingChannelChange?: (channelId: string | null) => void;
  onCreateAgent?: () => void;
};

const candidateKey = (candidate: Pick<Candidate, "type" | "id">) =>
  `${candidate.type}:${candidate.id}`;

const participantInitial = (name: string) =>
  name.trim().charAt(0).toUpperCase() || "?";

function DirectMessageAvatar({
  participants,
  label,
  size = "default",
}: {
  participants: readonly DirectMessageParticipant[];
  label: string;
  size?: "default" | "large";
}) {
  const visible = participants.slice(0, 2);
  return (
    <span
      aria-label={label}
      className={`dm-avatar${visible.length > 1 ? " dm-avatar-group" : ""}${
        size === "large" ? " dm-avatar-large" : ""
      }`}
      role="img"
    >
      {(visible.length > 0
        ? visible
        : [{ type: "user" as const, id: "fallback", name: label, image: null }]
      ).map((participant) => (
        <span className="dm-avatar-part" key={`${participant.type}:${participant.id}`}>
          {participant.image ? (
            <img alt="" src={participant.image} />
          ) : participant.type === "agent" ? (
            <Bot aria-hidden="true" size={size === "large" ? 22 : 16} />
          ) : (
            participantInitial(participant.name)
          )}
        </span>
      ))}
    </span>
  );
}

const formatConversationTime = (value: string, localeTag: string) => {
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return new Intl.DateTimeFormat(
    localeTag,
    sameDay
      ? { hour: "numeric", minute: "2-digit" }
      : { month: "short", day: "numeric" },
  ).format(date);
};

export function DirectMessages({
  organizationId,
  organizationName,
  token,
  currentUserId,
  channels,
  projects = [],
  activeChannelId,
  channelCatalogCursor,
  channelInboxSyncSignal,
  onChannelSelect,
  onChannelsChange,
  onIssueCreated,
  onSkillSessionAccepted,
  onViewingChannelChange,
  onCreateAgent,
}: DirectMessagesProps) {
  const { localeTag, t } = useI18n();
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(channels.length === 0);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [candidateSearch, setCandidateSearch] = useState("");
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!creating) return;
    let cancelled = false;
    setLoadingCandidates(true);
    setError(null);
    void Promise.all([
      loadOrganizationMembers(token, organizationId),
      listOrganizationAgents(token, organizationId),
    ])
      .then(([members, agentResult]) => {
        if (cancelled) return;
        const memberCandidates: Candidate[] = members
          .filter((member: OrganizationMember) => member.userId !== currentUserId)
          .map((member: OrganizationMember) => ({
            type: "user",
            id: member.userId,
            name: member.name,
            image: member.image,
            detail: member.email,
          }));
        const agentCandidates: Candidate[] = agentResult.agents.map(
          (agent: ChannelAgentSummary) => ({
            type: "agent",
            id: agent.agentId,
            name: agent.name,
            image: agent.avatar,
            detail: agent.description || agent.responsibility,
          }),
        );
        setCandidates([...memberCandidates, ...agentCandidates]);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingCandidates(false);
      });
    return () => {
      cancelled = true;
    };
  }, [creating, currentUserId, organizationId, token]);

  const directMessages = useMemo(
    () => sortDirectMessages(channels.filter((channel) => channel.kind === "dm")),
    [channels],
  );
  const visibleDirectMessages = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return directMessages;
    return directMessages.filter((channel) =>
      directMessageDisplayName(channel, currentUserId)
        .toLocaleLowerCase()
        .includes(query)
    );
  }, [currentUserId, directMessages, search]);
  const filteredCandidates = useMemo(() => {
    const query = candidateSearch.trim().toLocaleLowerCase();
    return candidates.filter((candidate) =>
      !query || `${candidate.name} ${candidate.detail}`.toLocaleLowerCase().includes(query)
    );
  }, [candidateSearch, candidates]);
  const selected = useMemo(
    () => candidates.filter((candidate) => selectedKeys.has(candidateKey(candidate))),
    [candidates, selectedKeys],
  );

  const startCreate = () => {
    setCreating(true);
    setCandidateSearch("");
    setSelectedKeys(new Set());
    setError(null);
  };
  const openConversation = (channelId: string) => {
    setCreating(false);
    onChannelSelect(channelId);
  };
  const toggleCandidate = (candidate: Candidate) => {
    const key = candidateKey(candidate);
    setSelectedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const submit = async () => {
    if (selected.length === 0 || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await createDirectMessage(token, organizationId, {
        memberIds: selected.filter((candidate) => candidate.type === "user").map(
          (candidate) => candidate.id,
        ),
        agentIds: selected.filter((candidate) => candidate.type === "agent").map(
          (candidate) => candidate.id,
        ),
      });
      onChannelsChange((current) =>
        current.some((channel) => channel.id === result.channel.id)
          ? current.map((channel) =>
              channel.id === result.channel.id ? result.channel : channel
            )
          : [...current, result.channel],
      );
      onChannelSelect(result.channel.id);
      setCreating(false);
      setSelectedKeys(new Set());
      setCandidateSearch("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={`dm-layout${creating ? " is-creating" : ""}`}>
      <aside aria-label={t("dm.conversations")} className="dm-list-pane">
        <div className="dm-list-toolbar">
          <label className="dm-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label={t("dm.search")}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("dm.search")}
              value={search}
            />
          </label>
          <button aria-label={t("dm.new")} onClick={startCreate} title={t("dm.new")} type="button">
            <Plus aria-hidden="true" size={17} />
          </button>
        </div>
        <button className={`dm-create-row${creating ? " active" : ""}`} onClick={startCreate} type="button">
          <span><Plus aria-hidden="true" size={17} /></span>
          {t("dm.new")}
        </button>
        <div className="dm-conversation-list">
          {visibleDirectMessages.map((channel) => {
            const name = directMessageDisplayName(channel, currentUserId);
            const participants = directMessageParticipants(channel, currentUserId);
            return (
              <button
                aria-current={!creating && channel.id === activeChannelId ? "page" : undefined}
                className={!creating && channel.id === activeChannelId ? "active" : ""}
                key={channel.id}
                onClick={() => openConversation(channel.id)}
                type="button"
              >
                <DirectMessageAvatar label={name} participants={participants} />
                <span className="dm-conversation-copy">
                  <strong>{name}</strong>
                  <small>{channel.lastMessagePreview ?? t("dm.noMessages")}</small>
                </span>
                <span className="dm-conversation-meta">
                  <time dateTime={channel.lastMessageAt ?? channel.createdAt}>
                    {formatConversationTime(channel.lastMessageAt ?? channel.createdAt, localeTag)}
                  </time>
                  {channel.hasUnread ? <i aria-label={t("dm.unread")} /> : null}
                </span>
              </button>
            );
          })}
          {!visibleDirectMessages.length && !creating ? (
            <p className="dm-list-empty">{t("dm.empty")}</p>
          ) : null}
        </div>
      </aside>

      <main className="dm-main-pane">
        {creating ? (
          <div className="dm-compose-view">
            <div className="dm-recipient-composer">
              <span>{t("dm.to")}</span>
              <div className="dm-recipient-field">
                {selected.map((candidate) => (
                  <button
                    aria-label={t("dm.removeRecipient", { name: candidate.name })}
                    className="dm-recipient-chip"
                    key={candidateKey(candidate)}
                    onClick={() => toggleCandidate(candidate)}
                    type="button"
                  >
                    {candidate.name}<X aria-hidden="true" size={12} />
                  </button>
                ))}
                <input
                  autoFocus
                  onChange={(event) => setCandidateSearch(event.target.value)}
                  placeholder={selected.length ? t("dm.addMore") : t("dm.recipientPlaceholder")}
                  value={candidateSearch}
                />
              </div>
              <button
                className="dm-start-button"
                disabled={selected.length === 0 || submitting}
                onClick={() => void submit()}
                type="button"
              >
                {submitting ? <Spinner aria-hidden="true" size={14} /> : <MessageCircle aria-hidden="true" size={15} />}
                {selected.length > 1 ? t("dm.startGroup") : t("dm.start")}
              </button>
            </div>
            <div className="dm-candidate-popover">
              {loadingCandidates ? (
                <div className="dm-candidate-status"><Spinner aria-hidden="true" size={16} />{t("dm.loadingPeople")}</div>
              ) : filteredCandidates.length ? (
                filteredCandidates.map((candidate) => {
                  const checked = selectedKeys.has(candidateKey(candidate));
                  return (
                    <button
                      aria-pressed={checked}
                      className={checked ? "selected" : ""}
                      key={candidateKey(candidate)}
                      onClick={() => toggleCandidate(candidate)}
                      type="button"
                    >
                      <span className="dm-candidate-avatar">
                        {candidate.image ? <img alt="" src={candidate.image} /> : candidate.type === "agent" ? <Bot aria-hidden="true" size={17} /> : participantInitial(candidate.name)}
                      </span>
                      <span><strong>{candidate.name}</strong><small>{candidate.detail}</small></span>
                      {candidate.type === "agent" ? <em>{t("dm.agent")}</em> : null}
                      {checked ? <Check aria-hidden="true" size={16} /> : null}
                    </button>
                  );
                })
              ) : (
                <p>{t("dm.noResults")}</p>
              )}
            </div>
            {error ? <p className="dm-error" role="alert">{error}</p> : null}
            <div className="dm-compose-empty">
              <Users aria-hidden="true" size={42} strokeWidth={1.3} />
              <h2>{t("dm.composeTitle")}</h2>
              <p>{t("dm.composeDescription")}</p>
            </div>
          </div>
        ) : (
          <Channels
            activeChannelId={activeChannelId}
            channelCatalogCursor={channelCatalogCursor}
            channelInboxSyncSignal={channelInboxSyncSignal}
            channels={directMessages}
            currentUserId={currentUserId}
            onChannelSelect={onChannelSelect}
            onChannelsChange={onChannelsChange}
            onCreateAgent={onCreateAgent}
            onIssueCreated={onIssueCreated}
            onSkillSessionAccepted={onSkillSessionAccepted}
            onViewingChannelChange={onViewingChannelChange}
            organizationId={organizationId}
            organizationName={organizationName}
            projects={projects}
            surface="dm"
            token={token}
          />
        )}
      </main>
    </div>
  );
}
