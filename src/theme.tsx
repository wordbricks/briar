import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const themePreferences = ["system", "light", "dark"] as const;
export type ThemePreference = (typeof themePreferences)[number];
export type ResolvedTheme = Exclude<ThemePreference, "system">;
export const defaultThemePreference: ThemePreference = "light";

export const themeStorageKey = "briar.theme.v1";
const darkMediaQuery = "(prefers-color-scheme: dark)";

function isThemePreference(value: unknown): value is ThemePreference {
  return (
    typeof value === "string" &&
    themePreferences.includes(value as ThemePreference)
  );
}

export function loadThemePreference(): ThemePreference {
  if (typeof window === "undefined") return defaultThemePreference;
  try {
    const stored = window.localStorage.getItem(themeStorageKey);
    return isThemePreference(stored) ? stored : defaultThemePreference;
  } catch {
    return defaultThemePreference;
  }
}

export function resolveTheme(theme: ThemePreference): ResolvedTheme {
  if (theme !== "system") return theme;
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(darkMediaQuery).matches
    ? "dark"
    : "light";
}

export function applyTheme(theme: ThemePreference): ResolvedTheme {
  const resolvedTheme = resolveTheme(theme);
  if (typeof document === "undefined") return resolvedTheme;

  const root = document.documentElement;
  root.classList.toggle("dark", resolvedTheme === "dark");
  root.dataset.theme = theme;
  root.style.colorScheme = resolvedTheme;

  const themeColor = resolvedTheme === "dark" ? "#121214" : "#f7f7f3";
  document
    .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    ?.setAttribute("content", themeColor);

  return resolvedTheme;
}

export function initializeTheme() {
  return applyTheme(loadThemePreference());
}

async function applyNativeTheme(theme: ThemePreference) {
  if (
    typeof window === "undefined" ||
    !("__TAURI_INTERNALS__" in window)
  ) {
    return;
  }
  try {
    const { setTheme } = await import("@tauri-apps/api/app");
    await setTheme(theme === "system" ? null : theme);
  } catch {
    // CSS still applies when the host platform cannot update native chrome.
  }
}

type ThemeContextValue = {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
  theme: ThemePreference;
};

const ThemeContext = createContext<ThemeContextValue>({
  resolvedTheme: "light",
  setTheme: () => undefined,
  theme: defaultThemePreference,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemePreference>(loadThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(theme),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(themeStorageKey, theme);
    } catch {
      // The selected theme remains active for the current session.
    }
    setResolvedTheme(applyTheme(theme));
    void applyNativeTheme(theme);

    if (theme !== "system" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia(darkMediaQuery);
    const handleSystemThemeChange = () =>
      setResolvedTheme(applyTheme("system"));
    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () =>
      mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [theme]);

  const value = useMemo(
    () => ({ resolvedTheme, setTheme, theme }),
    [resolvedTheme, theme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
