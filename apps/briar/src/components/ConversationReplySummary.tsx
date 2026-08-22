import { Bot, MessageSquare } from "lucide-react";

export type ConversationReplyParticipant = {
  id: string;
  name: string;
  image: string | null;
  isAgent: boolean;
};

type ConversationReplySummaryProps = {
  ariaLabel?: string;
  countLabel: string;
  lastReplyLabel?: string | null;
  onClick?: () => void;
  participants: readonly ConversationReplyParticipant[];
};

function SummaryContents({
  countLabel,
  lastReplyLabel,
  participants,
}: Pick<
  ConversationReplySummaryProps,
  "countLabel" | "lastReplyLabel" | "participants"
>) {
  const visibleParticipants = participants.slice(0, 3);
  return (
    <>
      {visibleParticipants.length > 0 ? (
        <span
          aria-hidden="true"
          className="conversation-reply-participants"
          title={visibleParticipants.map((participant) => participant.name).join(", ")}
        >
          {visibleParticipants.map((participant) => (
            <span
              className={`conversation-reply-avatar${participant.isAgent ? " agent" : ""}`}
              key={participant.id}
            >
              {participant.image ? (
                <img alt="" src={participant.image} />
              ) : participant.isAgent ? (
                <Bot size={12} />
              ) : (
                participant.name.trim().charAt(0).toUpperCase() || "?"
              )}
            </span>
          ))}
        </span>
      ) : (
        <MessageSquare aria-hidden="true" size={14} />
      )}
      <strong>{countLabel}</strong>
      {lastReplyLabel ? (
        <>
          <span aria-hidden="true" className="conversation-reply-separator">
            ·
          </span>
          <small>{lastReplyLabel}</small>
        </>
      ) : null}
    </>
  );
}

export function ConversationReplySummary({
  ariaLabel,
  countLabel,
  lastReplyLabel = null,
  onClick,
  participants,
}: ConversationReplySummaryProps) {
  const participantLabel = participants
    .slice(0, 3)
    .map((participant) => participant.name)
    .join(", ");
  const label = ariaLabel ??
    [countLabel, lastReplyLabel, participantLabel].filter(Boolean).join(" · ");
  if (onClick) {
    return (
      <button
        aria-label={label}
        className="conversation-reply-summary"
        onClick={onClick}
        type="button"
      >
        <SummaryContents
          countLabel={countLabel}
          lastReplyLabel={lastReplyLabel}
          participants={participants}
        />
      </button>
    );
  }
  return (
    <div
      aria-label={label}
      className="conversation-reply-summary"
      role="group"
    >
      <SummaryContents
        countLabel={countLabel}
        lastReplyLabel={lastReplyLabel}
        participants={participants}
      />
    </div>
  );
}
