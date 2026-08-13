import { useEffect, useState } from "react";

import {
  defaultAgentProviderModelCatalog,
  loadAgentProviderModels,
  type AgentProviderModelCatalog,
} from "../lib/project-llm";

export function useAgentProviderModels(
  enabled = true,
): AgentProviderModelCatalog {
  const [providerModels, setProviderModels] =
    useState<AgentProviderModelCatalog>(defaultAgentProviderModelCatalog);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void loadAgentProviderModels()
      .then((models) => {
        if (!cancelled) setProviderModels(models);
      })
      .catch(() => {
        if (!cancelled) setProviderModels(defaultAgentProviderModelCatalog);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return providerModels;
}
