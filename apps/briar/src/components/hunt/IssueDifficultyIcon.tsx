import { Gauge, Mountain, Sprout } from "lucide-react";
import { useI18n } from "@/i18n";
import type { MessageKey } from "@/i18n/messages";
import type { IssueDifficulty } from "@/lib/issue-difficulty";
import { cn } from "@/lib/utils";

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
  difficulty: IssueDifficulty;
  size?: number;
}) {
  const { t } = useI18n();
  const Icon = difficultyIcons[difficulty];
  const difficultyLabel = t(
    `issue.difficulty.${difficulty}` as MessageKey,
  );
  const label = t("issue.difficultyLabel", { difficulty: difficultyLabel });
  return (
    <span
      aria-label={label}
      className={cn("issue-difficulty-icon inline-flex items-center justify-center gap-1 text-muted-foreground [&>svg]:block [&>svg]:shrink-0", difficulty === "easy" && "text-[#318267]", difficulty === "normal" && "text-[#5d63a6]", difficulty === "hard" && "text-[#b45162]", className)}
      data-difficulty={difficulty}
      role="img"
      title={label}
    >
      <Icon aria-hidden="true" size={size} strokeWidth={2} />
    </span>
  );
}
