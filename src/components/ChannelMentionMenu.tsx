import { Bot } from "lucide-react";
import type { MentionTarget } from "../lib/channel-mentions";

type ChannelMentionMenuProps = {
  activeSuggestionIndex: number;
  ariaLabel: string;
  id: string;
  onActiveSuggestionIndexChange: (index: number) => void;
  onPickSuggestion: (target: MentionTarget) => void;
  suggestions: readonly MentionTarget[];
  variant: "desktop" | "companion";
};

const mentionInitial = (target: MentionTarget) =>
  target.label.trim().charAt(0).toUpperCase() || "?";

export function ChannelMentionMenu({
  activeSuggestionIndex,
  ariaLabel,
  id,
  onActiveSuggestionIndexChange,
  onPickSuggestion,
  suggestions,
  variant,
}: ChannelMentionMenuProps) {
  const isCompanion = variant === "companion";

  return (
    <ul
      aria-label={ariaLabel}
      className={
        isCompanion
          ? "companion-channel-mention-menu"
          : "channel-mention-menu"
      }
      id={id}
      role="listbox"
    >
      {suggestions.map((target, index) => (
        <li key={`${target.type}:${target.id}`}>
          <button
            aria-selected={index === activeSuggestionIndex}
            className={index === activeSuggestionIndex ? "active" : undefined}
            id={`${id}-option-${index}`}
            onClick={() => onPickSuggestion(target)}
            onMouseEnter={() => onActiveSuggestionIndexChange(index)}
            role="option"
            type="button"
          >
            {isCompanion ? (
              <>
                {target.image ? (
                  <img alt="" src={target.image} />
                ) : (
                  <span
                    className={`companion-channel-mention-avatar ${target.type}`}
                  >
                    {target.type === "agent" ? (
                      <Bot size={16} />
                    ) : (
                      mentionInitial(target)
                    )}
                  </span>
                )}
                <span className="companion-channel-mention-copy">
                  <strong>{target.label}</strong>
                  <small>@{target.handle}</small>
                </span>
                <em>{target.detail}</em>
              </>
            ) : (
              <>
                {target.image ? (
                  <img alt="" src={target.image} />
                ) : (
                  <span
                    className={`channel-mention-avatar ${target.type}`}
                  >
                    {target.type === "agent" ? (
                      <Bot size={15} />
                    ) : (
                      mentionInitial(target)
                    )}
                  </span>
                )}
                <strong>@{target.handle}</strong>
                <span>{target.detail}</span>
              </>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
