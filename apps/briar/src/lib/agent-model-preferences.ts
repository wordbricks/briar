import { agentProviders, type AgentProvider } from "./agent-provider";

export type AgentProviderModelPreference = {
  defaultModel: string | null;
  favoriteModels: string[];
};

export type AgentProviderModelPreferences = Record<
  AgentProvider,
  AgentProviderModelPreference
>;

export const agentModelPreferencesStorageKey =
  "briar.settings.agent-model-preferences.v1";
export const agentModelPreferencesChangedEvent =
  "briar:agent-model-preferences-changed";

export function defaultAgentProviderModelPreferences(): AgentProviderModelPreferences {
  return {
    codex: { defaultModel: null, favoriteModels: [] },
    claude: { defaultModel: null, favoriteModels: [] },
    cursor: { defaultModel: null, favoriteModels: [] },
    grok: { defaultModel: null, favoriteModels: [] },
    agy: { defaultModel: null, favoriteModels: [] },
    opencode: { defaultModel: null, favoriteModels: [] },
    openrouter: { defaultModel: null, favoriteModels: [] },
  };
}

function normalizeModelId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 500
    ? normalized
    : null;
}

function normalizePreference(value: unknown): AgentProviderModelPreference {
  const object = value && typeof value === "object"
    ? value as Record<string, unknown>
    : {};
  const favorites = Array.isArray(object.favoriteModels)
    ? object.favoriteModels
    : [];

  return {
    defaultModel: normalizeModelId(object.defaultModel),
    favoriteModels: Array.from(
      new Set(favorites.map(normalizeModelId).filter((model) => model !== null)),
    ).slice(0, 100),
  };
}

export function readAgentProviderModelPreferences(): AgentProviderModelPreferences {
  const defaults = defaultAgentProviderModelPreferences();
  if (typeof window === "undefined") return defaults;

  try {
    const stored = window.localStorage.getItem(agentModelPreferencesStorageKey);
    if (!stored) return defaults;
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== "object") return defaults;
    const object = parsed as Record<string, unknown>;
    return Object.fromEntries(
      agentProviders.map((provider) => [
        provider,
        normalizePreference(object[provider]),
      ]),
    ) as AgentProviderModelPreferences;
  } catch {
    return defaults;
  }
}

export function writeAgentProviderModelPreference(
  provider: AgentProvider,
  preference: AgentProviderModelPreference,
): AgentProviderModelPreferences {
  const preferences = {
    ...readAgentProviderModelPreferences(),
    [provider]: normalizePreference(preference),
  };

  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        agentModelPreferencesStorageKey,
        JSON.stringify(preferences),
      );
    } catch {
      // Keep the updated preference available to the current view.
    }
    window.dispatchEvent(new Event(agentModelPreferencesChangedEvent));
  }

  return preferences;
}
