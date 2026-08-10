import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { SmilePlus } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useI18n } from "../i18n";
import {
  channelQuickReactionEmojis,
  type ChannelMessage,
  type ChannelMessageReaction,
} from "../lib/channels-contract";

type ChannelMessageReactionsProps = {
  message: ChannelMessage;
  currentUserId: string | null;
  busy?: boolean;
  /** Compact mobile layout keeps the add control always visible. */
  alwaysShowAdd?: boolean;
  /** When true, renders the hover toolbar with quick reactions. */
  showHoverActions?: boolean;
  onOpenThread?: () => void;
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
  busy = false,
  alwaysShowAdd = false,
  showHoverActions = false,
  onOpenThread,
  onToggle,
  onReactingChange,
}: ChannelMessageReactionsProps) {
  const { t } = useI18n();
  const pickerId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const hasReactions = message.reactions.length > 0;

  useEffect(() => {
    onReactingChange?.(pickerOpen);
  }, [onReactingChange, pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
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

  const openPicker = (event?: ReactMouseEvent) => {
    event?.stopPropagation();
    setPickerOpen((open) => !open);
  };

  return (
    <>
      {showHoverActions ? (
        <ChannelMessageHoverActions
          busy={busy}
          onOpenPicker={() => setPickerOpen(true)}
          onOpenThread={onOpenThread}
          onToggle={handleToggle}
        />
      ) : null}
      <div
        className={`channel-message-reactions${hasReactions ? " has-reactions" : ""}${alwaysShowAdd ? " always-show-add" : ""}`}
      >
        {hasReactions ? (
          <div className="channel-reaction-chips" role="list">
            {message.reactions.map((reaction) => (
              <ReactionChip
                key={reaction.emoji}
                busy={busy}
                currentUserId={currentUserId}
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

        {pickerOpen ? (
          <div
            className="channel-emoji-picker"
            id={pickerId}
            onClick={(event) => event.stopPropagation()}
            ref={pickerRef}
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
          </div>
        ) : null}
      </div>
    </>
  );
}

function ChannelMessageHoverActions({
  busy = false,
  onOpenPicker,
  onOpenThread,
  onToggle,
}: {
  busy?: boolean;
  onOpenPicker: () => void;
  onOpenThread?: () => void;
  onToggle: (emoji: string) => void;
}) {
  const { t } = useI18n();

  const stop = (event: ReactMouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div
      aria-label={t("channel.messageActions")}
      className="channel-message-actions"
      onClick={stop}
      role="toolbar"
    >
      {channelQuickReactionEmojis.map((emoji) => (
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
      <span aria-hidden="true" className="channel-message-actions-divider" />
      <button
        aria-label={t("channel.react")}
        className="channel-quick-reaction open-picker"
        disabled={busy}
        onClick={onOpenPicker}
        title={t("channel.react")}
        type="button"
      >
        <SmilePlus aria-hidden="true" size={16} />
      </button>
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
    </div>
  );
}

function ReactionChip({
  busy,
  currentUserId,
  onToggle,
  reaction,
}: {
  busy: boolean;
  currentUserId: string | null;
  onToggle: () => void;
  reaction: ChannelMessageReaction;
}) {
  const { t } = useI18n();
  const mine = Boolean(
    currentUserId && reaction.userIds.includes(currentUserId),
  );
  return (
    <button
      aria-label={t("channel.reactionCount", {
        emoji: reaction.emoji,
        count: reaction.count,
      })}
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
  );
}
