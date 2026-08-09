export type PersistedWidthOptions = {
  storageKey: string;
  min: number;
  max: number;
};

export type PersistedWidth = {
  clamp: (value: number) => number;
  load: () => number | null;
  save: (width: number) => void;
};

export function createPersistedWidth(
  options: PersistedWidthOptions,
): PersistedWidth {
  const clamp = (value: number): number =>
    Math.min(options.max, Math.max(options.min, Math.round(value)));

  const load = (): number | null => {
    if (typeof window === "undefined") return null;
    try {
      const stored = window.localStorage.getItem(options.storageKey);
      if (stored === null) return null;
      const parsed = Number(stored);
      return Number.isFinite(parsed) ? clamp(parsed) : null;
    } catch {
      return null;
    }
  };

  const save = (width: number): void => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(options.storageKey, String(clamp(width)));
    } catch {
      // Keep the current session width when storage is unavailable.
    }
  };

  return { clamp, load, save };
}
