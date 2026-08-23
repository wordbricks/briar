import { Box } from "lucide-react";
import type { ChannelSkillCommandTarget } from "../hooks/useChannelComposer";

type ChannelSkillMenuProps = {
  activeSuggestionIndex: number;
  ariaLabel: string;
  id: string;
  onActiveSuggestionIndexChange: (index: number) => void;
  onPickSuggestion: (target: ChannelSkillCommandTarget) => void;
  skillLabel: string;
  suggestions: readonly ChannelSkillCommandTarget[];
};

export function ChannelSkillMenu({
  activeSuggestionIndex,
  ariaLabel,
  id,
  onActiveSuggestionIndexChange,
  onPickSuggestion,
  skillLabel,
  suggestions,
}: ChannelSkillMenuProps) {
  return (
    <ul
      aria-label={ariaLabel}
      className="channel-skill-menu"
      id={id}
      role="listbox"
    >
      {suggestions.map((target, index) => (
        <li key={`${target.agentId}:${target.skill.id}`}>
          <button
            aria-selected={index === activeSuggestionIndex}
            className={index === activeSuggestionIndex ? "active" : undefined}
            id={`${id}-option-${index}`}
            onClick={() => onPickSuggestion(target)}
            onMouseEnter={() => onActiveSuggestionIndexChange(index)}
            role="option"
            type="button"
          >
            <Box aria-hidden="true" size={18} strokeWidth={1.7} />
            <span>
              <strong>{target.skill.name}</strong>
              <small>{target.skill.description}</small>
            </span>
            <em>{skillLabel}</em>
          </button>
        </li>
      ))}
    </ul>
  );
}
