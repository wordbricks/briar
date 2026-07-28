import { Bot } from "lucide-react";
import { useEffect, useState } from "react";

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
  const [spriteSheetObjectUrl, setSpriteSheetObjectUrl] = useState<
    string | null
  >(null);
  const codexPet = agent.codexPet;
  const shouldAnimate = Boolean(
    isRunning && token && codexPet?.spriteSheetUrl,
  );

  useEffect(() => {
    if (!shouldAnimate || !token) {
      setSpriteSheetObjectUrl(null);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setSpriteSheetObjectUrl(null);
    void loadProjectAgentSpriteSheet(token, agent.projectId, agent.id)
      .then((spriteSheet) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(spriteSheet);
        setSpriteSheetObjectUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSpriteSheetObjectUrl(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [
    agent.id,
    agent.projectId,
    codexPet?.spriteSheetUrl,
    shouldAnimate,
    token,
  ]);

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
