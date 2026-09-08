import { Gauge, Mountain, Sprout } from "lucide-react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import type { IssueDifficulty } from "@/lib/issue-difficulty";

const difficultyIcons = {
  easy: Sprout,
  normal: Gauge,
  hard: Mountain,
} as const;

export function IssueDifficultyIcon({
  className = "",
  difficulty,
  size = 13,
}: {
  className?: string;
  difficulty: IssueDifficulty | null;
  size?: number;
}) {
  const { t } = useI18n();
  if (!difficulty) return null;
  const Icon = difficultyIcons[difficulty];
  const difficultyLabel = t(
    `issue.difficulty.${difficulty}` as MessageKey,
  );
  const label = t("issue.difficultyLabel", { difficulty: difficultyLabel });
  return (
    <span
      aria-label={label}
      className={`issue-difficulty-icon ${difficulty}${className ? ` ${className}` : ""}`}
      data-difficulty={difficulty}
      role="img"
      title={label}
    >
      <Icon aria-hidden="true" size={size} strokeWidth={2} />
    </span>
  );
}
