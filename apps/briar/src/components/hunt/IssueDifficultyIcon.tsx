import { Gauge, Mountain, MountainSnow, Sprout } from "lucide-react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import type { IssueDifficulty } from "@/lib/issue-difficulty";

// The series climbs: a seedling, a dial, a peak, and then the same peak with
// its summit under snow — one step past `hard` while staying the same shape,
// so the two read as neighbours rather than as unrelated glyphs.
const difficultyIcons = {
  easy: Sprout,
  normal: Gauge,
  hard: Mountain,
  expert: MountainSnow,
} as const satisfies Record<IssueDifficulty, unknown>;

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
