import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Copy, EllipsisVertical, Link2, SmilePlus, Trash2 } from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useI18n } from "../i18n";
import { channelBodyWithoutImages } from "./ChannelImages";
import {
  getChannelEmojiPickerPosition,
  type ChannelEmojiPickerPosition,
} from "../lib/channel-emoji-picker-position";
import {
  previewChannelReactionPeople,
  resolveChannelReactionPeople,
  type ChannelReactionPerson,
} from "../lib/channel-reaction-people";
import {
  channelQuickReactionEmojis,
  type ChannelMember,
  type ChannelMessage,
  type ChannelMessageReaction,
} from "../lib/channels-contract";
import {
  copyChannelMessageText,
  copyChannelShareLink,
} from "../lib/issue-links";

type ChannelMessageReactionsProps = {
  message: ChannelMessage;
  currentUserId: string | null;
  members?: readonly ChannelMember[];
  organizationId?: string;
  busy?: boolean;
  /** Compact mobile layout keeps the add control always visible. */
  alwaysShowAdd?: boolean;
  /** When true, renders the hover toolbar with quick reactions. */
  showHoverActions?: boolean;
  onOpenThread?: () => void;
  onDelete?: () => void;
  onToggle: (emoji: string) => void | Promise<void>;
  onReactingChange?: (reacting: boolean) => void;
};

type EmojiMartSelection = {
  native?: string;
  shortcodes?: string;
};

export function ChannelMessageReactions({
  message,
  currentUserId,
  members = [],
  organizationId,
  busy = false,
  alwaysShowAdd = false,
  showHoverActions = false,
  onOpenThread,
  onDelete,
  onToggle,
  onReactingChange,
}: ChannelMessageReactionsProps) {
  const { t } = useI18n();
  const pickerId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerPosition, setPickerPosition] =
    useState<ChannelEmojiPickerPosition | null>(null);
  const pickerAnchorRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const hasReactions = message.reactions.length > 0;

  useEffect(() => {
    onReactingChange?.(pickerOpen || menuOpen);
  }, [onReactingChange, menuOpen, pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !pickerRef.current?.contains(target) &&
        !pickerAnchorRef.current?.contains(target)
      ) {
        setPickerOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [pickerOpen]);

  useLayoutEffect(() => {
    if (!pickerOpen) return;

    const updatePosition = () => {
      const anchor = pickerAnchorRef.current;
      const picker = pickerRef.current;
      if (!anchor?.isConnected || !picker) {
        setPickerOpen(false);
        return;
      }
      const visualViewport = window.visualViewport;
      const nextPosition = getChannelEmojiPickerPosition(
        anchor.getBoundingClientRect(),
        picker.getBoundingClientRect(),
        {
          height: visualViewport?.height ?? window.innerHeight,
          left: visualViewport?.offsetLeft ?? 0,
          top: visualViewport?.offsetTop ?? 0,
          width: visualViewport?.width ?? window.innerWidth,
        },
      );
      setPickerPosition((current) =>
        current &&
        current.left === nextPosition.left &&
        current.top === nextPosition.top &&
        current.placement === nextPosition.placement
          ? current
          : nextPosition,
      );
    };

    updatePosition();
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(updatePosition);
    if (pickerRef.current) resizeObserver?.observe(pickerRef.current);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    window.visualViewport?.addEventListener("resize", updatePosition);
    window.visualViewport?.addEventListener("scroll", updatePosition);
    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      window.visualViewport?.removeEventListener("resize", updatePosition);
      window.visualViewport?.removeEventListener("scroll", updatePosition);
    };
  }, [pickerOpen]);

  const handleToggle = (emoji: string) => {
    if (busy || !emoji) return;
    void onToggle(emoji);
  };

  const handlePickerSelect = (selection: EmojiMartSelection) => {
    const emoji = selection.native?.trim();
    if (!emoji) return;
    setPickerOpen(false);
    handleToggle(emoji);
  };

  const openPicker = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    pickerAnchorRef.current = event.currentTarget;
    setPickerPosition(null);
    setPickerOpen((open) => !open);
  };

  const picker =
    pickerOpen && typeof document !== "undefined"
      ? createPortal(
          <div
            className="channel-emoji-picker"
            data-placement={pickerPosition?.placement}
            id={pickerId}
            onClick={(event) => event.stopPropagation()}
            ref={pickerRef}
            style={{
              left: pickerPosition?.left ?? 0,
              top: pickerPosition?.top ?? 0,
              visibility: pickerPosition ? "visible" : "hidden",
            }}
          >
            <Picker
              data={data}
              dynamicWidth
              emojiSize={20}
              emojiButtonSize={32}
              maxFrequentRows={2}
              navPosition="bottom"
              onEmojiSelect={handlePickerSelect}
              previewPosition="none"
              skinTonePosition="search"
              theme="auto"
            />
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      {showHoverActions ? (
        <ChannelMessageHoverActions
          busy={busy}
          menuOpen={menuOpen}
          message={message}
          onMenuOpenChange={setMenuOpen}
          onOpenPicker={openPicker}
          onOpenThread={onOpenThread}
          onDelete={onDelete}
          onToggle={handleToggle}
          organizationId={organizationId}
          pickerId={pickerId}
          pickerOpen={pickerOpen}
        />
      ) : null}
      <div
        className={`channel-message-reactions${hasReactions ? " has-reactions" : ""}${alwaysShowAdd ? " always-show-add" : ""}`}
      >
        {hasReactions && !message.deletedAt ? (
          <TooltipProvider delayDuration={200}>
            <div className="channel-reaction-chips" role="list">
              {message.reactions.map((reaction) => (
                <ReactionChip
                  key={reaction.emoji}
                  busy={busy}
                  currentUserId={currentUserId}
                  members={members}
                  onToggle={() => handleToggle(reaction.emoji)}
                  reaction={reaction}
                />
              ))}
              <button
                aria-controls={pickerId}
                aria-expanded={pickerOpen}
                aria-label={t("channel.react")}
                className="channel-reaction-add"
                disabled={busy}
                onClick={openPicker}
                title={t("channel.react")}
                type="button"
              >
                <SmilePlus aria-hidden="true" size={14} />
                <span>{t("channel.react")}</span>
              </button>
            </div>
          </TooltipProvider>
        ) : alwaysShowAdd ? (
          <button
            aria-controls={pickerId}
            aria-expanded={pickerOpen}
            aria-label={t("channel.react")}
            className="channel-reaction-add standalone"
            disabled={busy}
            onClick={openPicker}
            title={t("channel.react")}
            type="button"
          >
            <SmilePlus aria-hidden="true" size={14} />
          </button>
        ) : null}
      </div>
      {picker}
    </>
  );
}

function ChannelMessageHoverActions({
  busy = false,
  menuOpen,
  message,
  onMenuOpenChange,
  onOpenPicker,
  onOpenThread,
  onDelete,
  onToggle,
  organizationId,
  pickerId,
  pickerOpen,
}: {
  busy?: boolean;
  menuOpen: boolean;
  message: ChannelMessage;
  onMenuOpenChange: (open: boolean) => void;
  onOpenPicker: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onOpenThread?: () => void;
  onDelete?: () => void;
  onToggle: (emoji: string) => void;
  organizationId?: string;
  pickerId: string;
  pickerOpen: boolean;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const canCopyLink = Boolean(organizationId) && !message.optimistic;

  const stop = (event: ReactMouseEvent) => {
    event.stopPropagation();
  };

  const copyLink = () => {
    if (!organizationId) return;
    void copyChannelShareLink({
      organizationId,
      channelId: message.channelId,
      messageId: message.id,
      rootMessageId: message.parentMessageId ?? message.id,
    })
      .then(() => toast(t("channel.linkCopied"), { tone: "success" }))
      .catch(() => toast(t("channel.copyFailed"), { tone: "error" }));
  };

  const copyMessage = () => {
    void copyChannelMessageText(channelMessageCopyText(message))
      .then(() => toast(t("channel.messageCopied"), { tone: "success" }))
      .catch(() => toast(t("channel.copyFailed"), { tone: "error" }));
  };

  return (
    <div
      aria-label={t("channel.messageActions")}
      className="channel-message-actions"
      onClick={stop}
      role="toolbar"
    >
      {message.deletedAt ? null : channelQuickReactionEmojis.map((emoji) => (
        <button
          aria-label={t("channel.reactWith", { emoji })}
          className="channel-quick-reaction"
          disabled={busy}
          key={emoji}
          onClick={() => onToggle(emoji)}
          title={emoji}
          type="button"
        >
          <span aria-hidden="true">{emoji}</span>
        </button>
      ))}
      {message.deletedAt ? null : (
        <>
          <span aria-hidden="true" className="channel-message-actions-divider" />
          <button
            aria-controls={pickerId}
            aria-expanded={pickerOpen}
            aria-label={t("channel.react")}
            className="channel-quick-reaction open-picker"
            disabled={busy}
            onClick={onOpenPicker}
            title={t("channel.react")}
            type="button"
          >
            <SmilePlus aria-hidden="true" size={16} />
          </button>
        </>
      )}
      {onOpenThread ? (
        <button
          aria-label={t("channel.replyInThread")}
          className="channel-quick-reaction open-thread"
          disabled={busy}
          onClick={onOpenThread}
          title={t("channel.replyInThread")}
          type="button"
        >
          <span aria-hidden="true">↩</span>
        </button>
      ) : null}
      <DropdownMenu.Root onOpenChange={onMenuOpenChange} open={menuOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label={t("channel.moreActions")}
            className="channel-quick-reaction open-more"
            disabled={busy}
            title={t("channel.moreActions")}
            type="button"
          >
            <EllipsisVertical aria-hidden="true" size={16} />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            className="run-page-actions-menu"
            sideOffset={6}
          >
            <DropdownMenu.Item
              className="run-page-actions-item"
              disabled={!canCopyLink}
              onSelect={copyLink}
            >
              <Link2 size={14} />
              {t("channel.copyLink")}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              className="run-page-actions-item"
              disabled={Boolean(message.deletedAt)}
              onSelect={copyMessage}
            >
              <Copy size={14} />
              {t("channel.copyMessage")}
            </DropdownMenu.Item>
            {onDelete ? (
              <DropdownMenu.Item
                className="run-page-actions-item danger"
                onSelect={onDelete}
              >
                <Trash2 size={14} />
                {t("channel.deleteMessage")}
              </DropdownMenu.Item>
            ) : null}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function channelMessageCopyText(message: ChannelMessage): string {
  return channelBodyWithoutImages(message.body) || message.body.trim();
}

function reactionPersonLabel(
  person: ChannelReactionPerson,
  t: ReturnType<typeof useI18n>["t"],
) {
  if (person.name && person.isCurrentUser) {
    return `${person.name} (${t("channel.you")})`;
  }
  if (person.name) return person.name;
  if (person.isCurrentUser) return t("channel.you");
  return t("channel.reactionUnknown");
}

function ReactionPersonAvatar({
  name,
  image,
}: {
  name: string;
  image: string | null;
}) {
  if (image) {
    return <img alt="" src={image} />;
  }
  return <span>{name.trim().charAt(0).toUpperCase() || "?"}</span>;
}

function ReactionChip({
  busy,
  currentUserId,
  members,
  onToggle,
  reaction,
}: {
  busy: boolean;
  currentUserId: string | null;
  members: readonly ChannelMember[];
  onToggle: () => void;
  reaction: ChannelMessageReaction;
}) {
  const { t } = useI18n();
  const mine = Boolean(
    currentUserId && reaction.userIds.includes(currentUserId),
  );
  const people = resolveChannelReactionPeople({
    currentUserId,
    members,
    reactionPeople: reaction.people,
    userIds: reaction.userIds,
  });
  const { visible, hiddenCount } = previewChannelReactionPeople(people);
  const names = people.map((person) => reactionPersonLabel(person, t));
  const label = names.length > 0
    ? t("channel.reactionPeopleLabel", {
        emoji: reaction.emoji,
        count: reaction.count,
        names: names.join(", "),
      })
    : t("channel.reactionCount", {
        emoji: reaction.emoji,
        count: reaction.count,
      });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          aria-label={label}
          aria-pressed={mine}
          className={`channel-reaction-chip${mine ? " is-mine" : ""}`}
          disabled={busy}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          role="listitem"
          type="button"
        >
          <span aria-hidden="true">{reaction.emoji}</span>
          <span>{reaction.count}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent
        className="channel-reaction-people-tooltip"
        side="top"
        sideOffset={6}
      >
        <div className="channel-reaction-people-heading">
          {t("channel.reactionPeople", { emoji: reaction.emoji })}
        </div>
        <ul className="channel-reaction-people">
          {visible.map((person) => {
            const name = reactionPersonLabel(person, t);
            return (
              <li className="channel-reaction-person" key={person.userId}>
                <span
                  aria-hidden="true"
                  className="channel-reaction-person-avatar"
                >
                  <ReactionPersonAvatar
                    image={person.image}
                    name={person.name ??
                      (person.isCurrentUser ? t("channel.you") : "?")}
                  />
                </span>
                <span className="channel-reaction-person-name">{name}</span>
              </li>
            );
          })}
        </ul>
        {hiddenCount > 0 ? (
          <div className="channel-reaction-people-more">
            {t("channel.reactionPeopleMore", { count: hiddenCount })}
          </div>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
