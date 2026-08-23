import { useEffect, useState } from "react";

import {
  agentModelPreferencesChangedEvent,
  agentModelPreferencesStorageKey,
  readAgentProviderModelPreferences,
} from "../lib/agent-model-preferences";

export function useAgentProviderModelPreferences() {
  const [preferences, setPreferences] = useState(
    readAgentProviderModelPreferences,
  );

  useEffect(() => {
    const refresh = () => setPreferences(readAgentProviderModelPreferences());
    const refreshFromStorage = (event: StorageEvent) => {
      if (event.key === agentModelPreferencesStorageKey) refresh();
    };

    window.addEventListener(agentModelPreferencesChangedEvent, refresh);
    window.addEventListener("storage", refreshFromStorage);
    return () => {
      window.removeEventListener(agentModelPreferencesChangedEvent, refresh);
      window.removeEventListener("storage", refreshFromStorage);
    };
  }, []);

  return preferences;
}
