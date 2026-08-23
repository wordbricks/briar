import { Bot } from "lucide-react";
import { useMemo } from "react";

import { useObjectUrl } from "../hooks/useObjectUrl";
import { loadProjectAgentSpriteSheet } from "../lib/api";
import type { ProjectAgent } from "../types";

export function ProjectAgentAvatar({
  agent,
  isRunning,
  token,
}: {
  agent: ProjectAgent;
  isRunning: boolean;
  token: string | null;
}) {
  const codexPet = agent.codexPet;
  const shouldAnimate = Boolean(
    isRunning && token && codexPet?.spriteSheetUrl,
  );
  const spriteSheetLoader = useMemo(() => {
    if (!shouldAnimate || !token) return null;
    return () => loadProjectAgentSpriteSheet(token, agent.projectId, agent.id);
  }, [
    agent.id,
    agent.projectId,
    codexPet?.spriteSheetUrl,
    shouldAnimate,
    token,
  ]);
  const { source: spriteSheetObjectUrl } = useObjectUrl(spriteSheetLoader);

  return (
    <span className={`project-agent-avatar ${agent.provider}`}>
      {spriteSheetObjectUrl && codexPet ? (
        <span
          aria-hidden="true"
          className={`project-agent-codex-pet-sprite version-${codexPet.spriteVersion}`}
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
