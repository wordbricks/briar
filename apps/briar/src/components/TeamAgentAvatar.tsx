import { Bot } from "lucide-react";
import { useMemo } from "react";

import { useObjectUrl } from "../hooks/useObjectUrl";
import { loadTeamAgentSpriteSheet } from "../lib/api";
import type { ProjectAgent } from "../types";
import { cn } from "../lib/utils";

export function TeamAgentAvatar({
  agent,
  isRunning,
  token,
}: {
  agent: ProjectAgent;
  isRunning: boolean;
  token: string | null;
}) {
  const codexPet = agent.codexPet;
  const shouldAnimate = Boolean(isRunning && token && codexPet?.spriteSheetUrl);
  const spriteSheetLoader = useMemo(() => {
    if (!shouldAnimate || !token) return null;
    return () => loadTeamAgentSpriteSheet(token, agent.teamId, agent.id);
  }, [
    agent.id,
    agent.teamId,
    codexPet?.spriteSheetUrl,
    shouldAnimate,
    token,
  ]);
  const { source: spriteSheetObjectUrl } = useObjectUrl(spriteSheetLoader);

  return (
    <span
      className={cn(
        "project-agent-avatar grid size-[46px] place-items-center overflow-hidden rounded-xl border border-border bg-muted text-muted-foreground [&>img]:block [&>img]:size-full [&>img]:object-cover",
        agent.provider === "claude" &&
          "bg-orange-50 text-[#9b664b] dark:bg-orange-950/30",
        agent.provider === "grok" &&
          "bg-emerald-50 text-[#39776f] dark:bg-emerald-950/30",
      )}
    >
      {spriteSheetObjectUrl && codexPet ? (
        <span
          aria-hidden="true"
          className={cn(
            "project-agent-codex-pet-sprite block h-[46px] w-[42px] bg-[length:800%_900%] bg-no-repeat [background-position-y:87.5%] motion-safe:animate-[project-agent-codex-pet-running_820ms_linear_infinite]",
            codexPet.spriteVersion === 2 &&
              "bg-[length:800%_1100%] [background-position-y:70%]",
          )}
          data-animation="running"
          style={{ backgroundImage: `url(${spriteSheetObjectUrl})` }}
        />
      ) : agent.avatar ? (
        <img alt="" src={agent.avatar} />
      ) : (
        <Bot size={19} />
      )}
    </span>
  );
}
