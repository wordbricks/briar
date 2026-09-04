import {
  Bot,
  Check,
  FolderKanban,
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
  listDirectMessageRecipients,
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
import type { AutoHuntSession } from "../types";
import { cn } from "../lib/utils";
import type { OrganizationMember, Project } from "../types";
import { Channels } from "./Channels";
import { Button } from "./ui/button";
import { Spinner } from "./ui/spinner";

type Candidate =
  | {
      type: "user";
      id: string;
      name: string;
      image: string | null;
      detail: string;
      isSelf: boolean;
    }
  | {
      type: "agent";
      id: string;
      name: string;
      image: string | null;
      detail: string;
      projectName: string | null;
    };

type DirectMessagesProps = {
  isSidebarOpen: boolean;
  organizationId: string;
  organizationName?: string;
  token: string;
  currentUserId: string | null;
  channels: ChannelSummary[];
  projects?: readonly Pick<Project, "id" | "name" | "organizationId">[];
  activeChannelId: string | null;
  channelCatalogCursor: number | null;
  onChannelSelect: (channelId: string | null) => void;
  onChannelFallback?: (channelId: string | null) => void;
  onChannelsChange: Dispatch<SetStateAction<ChannelSummary[]>>;
  onIssueCreated?: (projectId: string, runId: string) => void | Promise<void>;
  onSkillSessionAccepted?: (session: AutoHuntSession) => void;
  onViewingChannelChange?: (
    channelId: string | null,
    threadRootMessageId: string | null,
  ) => void;
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
      className={cn(
        "dm-avatar relative block size-[38px] shrink-0",
        visible.length > 1 && "dm-avatar-group",
        size === "large" && "size-12",
      )}
      role="img"
    >
      {(visible.length > 0
        ? visible
        : [{ type: "user" as const, id: "fallback", name: label, image: null }]
      ).map((participant, index) => (
        <span
          className={cn(
            "dm-avatar-part absolute inset-0 grid place-items-center overflow-hidden rounded-full border-2 border-card text-[13px] font-bold text-white [&>img]:size-full [&>img]:object-cover",
            visible.length > 1 && index === 1
              ? "bg-[#82847f]"
              : "bg-[#8f6cef]",
            visible.length > 1 && index === 0 &&
              "bottom-auto left-0 right-auto top-0 size-7",
            visible.length > 1 && index === 1 &&
              "bottom-0 left-auto right-0 top-auto size-7",
            size === "large" && visible.length <= 1 && "text-base",
          )}
          key={`${participant.type}:${participant.id}`}
        >
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
  isSidebarOpen,
  organizationId,
  organizationName,
  token,
  currentUserId,
  channels,
  projects = [],
  activeChannelId,
  channelCatalogCursor,
  onChannelSelect,
  onChannelFallback,
  onChannelsChange,
  onIssueCreated,
  onSkillSessionAccepted,
  onViewingChannelChange,
  onCreateAgent,
}: DirectMessagesProps) {
  const { localeTag, t } = useI18n();
  const candidateLabel = (candidate: Candidate) =>
    candidate.type === "user" && candidate.isSelf
      ? t("dm.self")
      : candidate.name;
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
    void listDirectMessageRecipients(token, organizationId)
      .then(({ members, agents }) => {
        if (cancelled) return;
        const memberCandidates: Candidate[] = members.map(
          (member: OrganizationMember) => ({
            type: "user",
            id: member.userId,
            name: member.name,
            image: member.image,
            detail: member.userId === currentUserId
              ? t("dm.selfDescription")
              : member.email,
            isSelf: member.userId === currentUserId,
          }),
        );
        const agentCandidates: Candidate[] = agents.map(
          (agent: ChannelAgentSummary) => ({
            type: "agent",
            id: agent.agentId,
            name: agent.name,
            image: agent.avatar,
            detail: agent.description || agent.responsibility,
            projectName: agent.projectName,
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
  }, [creating, currentUserId, organizationId, t, token]);

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
      !query || `${candidate.name} ${candidate.detail} ${
        candidate.type === "agent"
          ? candidate.projectName ?? ""
          : candidate.isSelf
          ? t("dm.self")
          : ""
      }`.toLocaleLowerCase().includes(query)
    );
  }, [candidateSearch, candidates, t]);
  const selected = useMemo(
    () => candidates.filter((candidate) => selectedKeys.has(candidateKey(candidate))),
    [candidates, selectedKeys],
  );
  const isSelfMessage = selected.length === 1 && selected[0]?.type === "user" &&
    selected[0].isSelf;
  const showMainOnMobile =
    creating || visibleDirectMessages.some((channel) => channel.id === activeChannelId);

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
    <div
      className={cn(
        "dm-layout grid min-h-0 min-w-0 flex-1 grid-cols-[300px_minmax(0,1fr)] bg-card max-[760px]:grid-cols-1",
        creating && "is-creating",
      )}
    >
      <aside
        aria-label={t("dm.conversations")}
        className={cn(
          "dm-list-pane flex min-h-0 min-w-0 flex-col border-r border-border bg-muted/35",
          showMainOnMobile && "max-[760px]:hidden",
        )}
      >
        <div
          className={cn(
            "dm-list-toolbar flex h-[52px] shrink-0 items-center gap-[7px] px-3 pb-1.5 pt-2.5",
            !isSidebarOpen && "pl-[var(--window-navigation-content-inset)]",
          )}
        >
          <label className="dm-search flex h-8 min-w-0 flex-1 items-center gap-[7px] rounded-lg border border-transparent bg-foreground/5 px-[9px] text-muted-foreground transition-[border-color,background-color,box-shadow] focus-within:border-ring/55 focus-within:bg-card focus-within:ring-2 focus-within:ring-ring/20">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label={t("dm.search")}
              className="h-full min-w-0 w-full border-0 bg-transparent px-0 py-0 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("dm.search")}
              value={search}
            />
          </label>
          <Button
            aria-label={t("dm.new")}
            className="size-8 shrink-0 text-muted-foreground"
            onClick={startCreate}
            size="icon-sm"
            title={t("dm.new")}
            type="button"
            variant="ghost"
          >
            <Plus aria-hidden="true" size={17} />
          </Button>
        </div>
        <button
          className={cn(
            "dm-create-row mx-3 mb-[7px] mt-0.5 flex h-12 items-center gap-2.5 rounded-[9px] border-0 px-2.5 text-left text-sm font-semibold text-foreground transition-colors hover:bg-foreground/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[.985]",
            creating ? "active bg-foreground/10" : "bg-transparent",
          )}
          onClick={startCreate}
          type="button"
        >
          <span className="grid size-[30px] place-items-center rounded-full border border-border bg-card">
            <Plus aria-hidden="true" size={17} />
          </span>
          {t("dm.new")}
        </button>
        <div className="dm-conversation-list scrollbar-subtle min-h-0 flex-1 overflow-auto px-2 pb-3">
          {visibleDirectMessages.map((channel) => {
            const name = directMessageDisplayName(channel, currentUserId);
            const participants = directMessageParticipants(channel, currentUserId);
            return (
              <button
                aria-current={!creating && channel.id === activeChannelId ? "page" : undefined}
                className={cn(
                  "relative grid min-h-[60px] w-full grid-cols-[38px_minmax(0,1fr)_auto] items-center gap-[9px] rounded-[9px] border-0 p-2 text-left text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[.99]",
                  !creating &&
                    channel.id === activeChannelId &&
                    "active bg-foreground/10 hover:bg-foreground/10",
                  creating || channel.id !== activeChannelId
                    ? "bg-transparent hover:bg-foreground/5"
                    : null,
                )}
                key={channel.id}
                onClick={() => openConversation(channel.id)}
                type="button"
              >
                <DirectMessageAvatar label={name} participants={participants} />
                <span className="dm-conversation-copy grid min-w-0 gap-[3px]">
                  <strong className="truncate text-sm font-[650]">{name}</strong>
                  <small className="truncate text-xs text-muted-foreground">
                    {channel.lastMessagePreview ?? t("dm.noMessages")}
                  </small>
                </span>
                <span className="dm-conversation-meta flex h-full flex-col items-end justify-center gap-[7px] self-stretch text-[11px] text-muted-foreground">
                  <time dateTime={channel.lastMessageAt ?? channel.createdAt}>
                    {formatConversationTime(channel.lastMessageAt ?? channel.createdAt, localeTag)}
                  </time>
                  {channel.hasUnread ? (
                    <i
                      aria-label={t("dm.unread")}
                      className="size-[7px] rounded-full bg-[#7d5ce7]"
                    />
                  ) : null}
                </span>
              </button>
            );
          })}
          {!visibleDirectMessages.length && !creating ? (
            <p className="dm-list-empty m-[22px_12px] text-center text-sm text-muted-foreground">
              {t("dm.empty")}
            </p>
          ) : null}
        </div>
      </aside>

      <main
        className={cn(
          "dm-main-pane flex min-h-0 min-w-0 bg-card [&>.channels]:flex-1",
          !showMainOnMobile && "max-[760px]:hidden",
        )}
      >
        {creating ? (
          <div className="dm-compose-view relative flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="dm-recipient-composer flex min-h-[52px] shrink-0 items-start gap-[9px] border-b border-border px-3.5 py-2">
              <span className="pt-2 text-sm font-semibold text-muted-foreground">
                {t("dm.to")}
              </span>
              <div className="dm-recipient-field flex min-h-[35px] min-w-0 flex-1 flex-wrap items-center gap-[5px]">
                {selected.map((candidate) => (
                  <button
                    aria-label={t("dm.removeRecipient", {
                      name: candidateLabel(candidate),
                    })}
                    className="dm-recipient-chip flex h-7 items-center gap-[5px] rounded-full border border-primary/25 bg-primary/10 px-2 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={candidateKey(candidate)}
                    onClick={() => toggleCandidate(candidate)}
                    type="button"
                  >
                    {candidateLabel(candidate)}
                    <X aria-hidden="true" size={12} />
                  </button>
                ))}
                <input
                  autoFocus
                  className="h-[34px] min-w-[170px] flex-1 border-0 bg-transparent px-0 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0"
                  onChange={(event) => setCandidateSearch(event.target.value)}
                  placeholder={selected.length ? t("dm.addMore") : t("dm.recipientPlaceholder")}
                  value={candidateSearch}
                />
              </div>
              <Button
                className="dm-start-button h-[34px] min-h-[34px] shrink-0 rounded-lg px-3 text-xs font-[650] shadow-none disabled:opacity-40"
                disabled={selected.length === 0 || submitting}
                onClick={() => void submit()}
                size="sm"
                type="button"
                variant="default"
              >
                {submitting ? <Spinner aria-hidden="true" className="size-[14px]" /> : <MessageCircle aria-hidden="true" size={15} />}
                {isSelfMessage
                  ? t("dm.self")
                  : selected.length > 1
                  ? t("dm.startGroup")
                  : t("dm.start")}
              </Button>
            </div>
            <div className="dm-candidate-popover scrollbar-subtle absolute left-5 top-[57px] z-20 max-h-[360px] w-[min(600px,calc(100%_-_40px))] overflow-auto rounded-xl border border-border bg-popover p-[7px] shadow-[0_16px_42px_rgba(20,20,18,.14),0_2px_7px_rgba(20,20,18,.08)]">
              {loadingCandidates ? (
                <div className="dm-candidate-status m-0 flex items-center justify-center gap-2 p-[18px] text-sm text-muted-foreground">
                  <Spinner aria-hidden="true" className="size-[16px]" />
                  {t("dm.loadingPeople")}
                </div>
              ) : filteredCandidates.length ? (
                filteredCandidates.map((candidate) => {
                  const checked = selectedKeys.has(candidateKey(candidate));
                  return (
                    <button
                      aria-pressed={checked}
                      className={cn(
                        "grid min-h-12 w-full grid-cols-[32px_minmax(0,1fr)_auto_20px] items-center gap-[9px] rounded-lg border-0 px-[9px] py-1.5 text-left text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        checked
                          ? "selected bg-accent hover:bg-accent"
                          : "bg-transparent hover:bg-accent",
                      )}
                      key={candidateKey(candidate)}
                      onClick={() => toggleCandidate(candidate)}
                      type="button"
                    >
                      <span className="dm-candidate-avatar grid size-[30px] place-items-center overflow-hidden rounded-full bg-[#8f6cef] text-xs font-bold text-white [&>img]:size-full [&>img]:object-cover">
                        {candidate.image ? <img alt="" src={candidate.image} /> : candidate.type === "agent" ? <Bot aria-hidden="true" size={17} /> : participantInitial(candidate.name)}
                      </span>
                      <span className="grid min-w-0 gap-0.5">
                        <strong className="truncate text-sm">
                          {candidate.type === "user" && candidate.isSelf
                            ? t("dm.self")
                            : candidate.name}
                        </strong>
                        <small className="truncate text-xs text-muted-foreground">
                          {candidate.detail}
                        </small>
                      </span>
                      {candidate.type === "agent" ? (
                        <span className="dm-candidate-badges flex min-w-0 items-center justify-end gap-[5px]">
                          {candidate.projectName ? (
                            <span
                              className="dm-candidate-project flex min-w-0 max-w-[150px] items-center gap-1 overflow-hidden rounded-full bg-secondary px-1.5 py-0.5 text-[10px] font-[650] whitespace-nowrap text-secondary-foreground"
                              title={candidate.projectName}
                            >
                              <FolderKanban aria-hidden="true" className="shrink-0" size={11} />
                              <span className="min-w-0 truncate">{candidate.projectName}</span>
                            </span>
                          ) : null}
                          <em className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold not-italic text-primary">
                            {t("dm.agent")}
                          </em>
                        </span>
                      ) : null}
                      {checked ? <Check aria-hidden="true" size={16} /> : null}
                    </button>
                  );
                })
              ) : (
                <p className="m-0 flex items-center justify-center p-[18px] text-sm text-muted-foreground">
                  {t("dm.noResults")}
                </p>
              )}
            </div>
            {error ? (
              <p
                className="dm-error absolute left-5 top-[430px] z-[21] m-0 text-sm text-destructive"
                role="alert"
              >
                {error}
              </p>
            ) : null}
            <div className="dm-compose-empty m-auto grid max-w-[440px] justify-items-center gap-2.5 px-8 pb-8 pt-[120px] text-center text-muted-foreground">
              <Users aria-hidden="true" size={42} strokeWidth={1.3} />
              <h2 className="mt-[3px] text-xl font-semibold text-foreground">
                {t("dm.composeTitle")}
              </h2>
              <p className="m-0 text-sm leading-relaxed">{t("dm.composeDescription")}</p>
            </div>
          </div>
        ) : (
          <Channels
            activeChannelId={activeChannelId}
            channelCatalogCursor={channelCatalogCursor}
            channels={directMessages}
            currentUserId={currentUserId}
            onChannelFallback={onChannelFallback}
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
