import { Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";

import { useI18n } from "../i18n";
import type { ChannelSummary } from "../lib/channels-contract";
import {
  directMessageDisplayName,
  directMessageParticipants,
  sortDirectMessages,
} from "../lib/direct-messages";
import { DirectMessageAvatar, formatConversationTime } from "./DirectMessages";
import { Spinner } from "./ui/spinner";

/*
  The sidebar's DMs half: the conversation list that used to sit beside the
  timeline inside the DM page. With the list here the page keeps its whole
  width for the conversation. It is a sidebar list, so it draws with the
  sidebar's tokens rather than the page's.
*/

export function SidebarDirectMessages({
  activeChannelId,
  composing,
  currentUserId,
  directMessages,
  loading = false,
  onCompose,
  onOpen,
}: {
  activeChannelId: string | null;
  /** A new conversation is being composed: no row is current, the New row is. */
  composing: boolean;
  currentUserId: string | null;
  directMessages: readonly ChannelSummary[];
  /** The catalog has not arrived yet, so an empty list is not "none". */
  loading?: boolean;
  onCompose: () => void;
  onOpen: (channelId: string) => void;
}) {
  const { localeTag, t } = useI18n();
  const [search, setSearch] = useState("");
  const sorted = useMemo(
    () => sortDirectMessages(directMessages),
    [directMessages],
  );
  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return sorted;
    return sorted.filter((channel) =>
      directMessageDisplayName(channel, currentUserId)
        .toLocaleLowerCase()
        .includes(query),
    );
  }, [currentUserId, search, sorted]);

  return (
    <section
      aria-label={t("dm.conversations")}
      className="sidebar-dms"
      data-testid="sidebar-dms"
    >
      <div className="sidebar-dm-toolbar">
        <label className="sidebar-dm-search">
          <Search aria-hidden="true" size={14} strokeWidth={1.8} />
          <input
            aria-label={t("dm.search")}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("dm.search")}
            type="search"
            value={search}
          />
        </label>
        <button
          aria-label={t("dm.new")}
          className="sidebar-dm-compose"
          onClick={onCompose}
          title={t("dm.new")}
          type="button"
        >
          <Plus aria-hidden="true" size={16} strokeWidth={1.8} />
        </button>
      </div>
      <div className="sidebar-dm-list">
        <button
          aria-current={composing ? "page" : undefined}
          className={`sidebar-dm-new${composing ? " active" : ""}`}
          onClick={onCompose}
          type="button"
        >
          <span className="sidebar-dm-new-icon">
            <Plus aria-hidden="true" size={15} strokeWidth={1.8} />
          </span>
          <span>{t("dm.new")}</span>
        </button>
        {visible.map((channel) => {
          const name = directMessageDisplayName(channel, currentUserId);
          const participants = directMessageParticipants(channel, currentUserId);
          const isCurrent = !composing && channel.id === activeChannelId;
          return (
            <button
              aria-current={isCurrent ? "page" : undefined}
              className={`sidebar-dm-row${isCurrent ? " active" : ""}`}
              key={channel.id}
              onClick={() => onOpen(channel.id)}
              type="button"
            >
              <DirectMessageAvatar label={name} participants={participants} />
              <span className="sidebar-dm-copy">
                <strong>{name}</strong>
                <small>{channel.lastMessagePreview ?? t("dm.noMessages")}</small>
              </span>
              <span className="sidebar-dm-meta">
                <time dateTime={channel.lastMessageAt ?? channel.createdAt}>
                  {formatConversationTime(
                    channel.lastMessageAt ?? channel.createdAt,
                    localeTag,
                  )}
                </time>
                {channel.hasUnread ? (
                  <i aria-label={t("dm.unread")} className="sidebar-unread-dot" />
                ) : null}
              </span>
            </button>
          );
        })}
        {visible.length === 0 ? (
          loading && sorted.length === 0 ? (
            <div
              aria-busy="true"
              className="sidebar-dm-empty"
              role="status"
            >
              <Spinner aria-hidden="true" className="size-4" />
            </div>
          ) : (
            <p className="sidebar-dm-empty">
              {search.trim() ? t("dm.noResults") : t("dm.empty")}
            </p>
          )
        ) : null}
      </div>
    </section>
  );
}
