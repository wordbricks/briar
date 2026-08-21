import { Bell } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useI18n } from "../i18n";
import type { ChannelMember, ChannelThreadSubscriber } from "../lib/channels-contract";

export function ChannelThreadSubscribeControls({
  currentUserId,
  members,
  pending,
  subscribers,
  onToggle,
}: {
  currentUserId?: string | null;
  members: ChannelMember[];
  pending: boolean;
  subscribers: ChannelThreadSubscriber[];
  onToggle: (subscribed: boolean) => void;
}) {
  const { t } = useI18n();
  const subscriberMembers = subscribers.flatMap((subscriber) => {
    const member = members.find((candidate) => candidate.userId === subscriber.userId);
    return member ? [member] : [];
  });
  const isSubscribed = Boolean(
    currentUserId &&
      subscribers.some((subscriber) => subscriber.userId === currentUserId),
  );

  return (
    <div className="channel-thread-subscribe">
      {subscriberMembers.length > 0 ? (
        <div
          aria-label={t("run.subscribers", { count: subscriberMembers.length })}
          className="issue-subscriber-avatars"
          title={subscriberMembers.map((member) => member.name).join(", ")}
        >
          {subscriberMembers.slice(0, 4).map((member) => (
            <span className="issue-subscriber-avatar" key={member.userId}>
              {member.image ? (
                <img alt="" src={member.image} />
              ) : (
                member.name.trim().charAt(0).toUpperCase() || "?"
              )}
            </span>
          ))}
          {subscriberMembers.length > 4 ? (
            <span className="issue-subscriber-overflow">
              +{subscriberMembers.length - 4}
            </span>
          ) : null}
        </div>
      ) : null}
      {currentUserId ? (
        <button
          aria-pressed={isSubscribed}
          className={`issue-subscribe-button${isSubscribed ? " active" : ""}`}
          disabled={pending}
          onClick={() => onToggle(!isSubscribed)}
          title={isSubscribed ? t("run.unsubscribe") : t("run.subscribe")}
          type="button"
        >
          {pending ? (
            <Spinner aria-hidden="true" size={13} />
          ) : (
            <Bell aria-hidden="true" size={13} />
          )}
          {isSubscribed ? t("run.subscribed") : t("run.subscribe")}
        </button>
      ) : null}
    </div>
  );
}
