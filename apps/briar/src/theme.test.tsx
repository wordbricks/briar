/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "./test/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  initializeTheme,
  loadThemePreference,
  ThemeProvider,
  themeStorageKey,
  useTheme,
} from "./theme";

function installMatchMedia(matches: boolean) {
  let listener: (() => void) | null = null;
  const mediaQuery = {
    matches,
    media: "(prefers-color-scheme: dark)",
    onchange: null,
    addEventListener: vi.fn((_event: string, nextListener: () => void) => {
      listener = nextListener;
    }),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal("matchMedia", vi.fn(() => mediaQuery));
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: globalThis.matchMedia,
  });
  return {
    mediaQuery,
    setMatches(nextMatches: boolean) {
      mediaQuery.matches = nextMatches;
      listener?.();
    },
  };
}

describe("theme", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.style.removeProperty("color-scheme");
  });

  it("initializes the stored theme before React renders", () => {
    installMatchMedia(false);
    window.localStorage.setItem(themeStorageKey, "dark");

    expect(initializeTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("defaults first-time users to light regardless of the system theme", () => {
    installMatchMedia(true);

    expect(loadThemePreference()).toBe("light");
    expect(initializeTheme()).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("tracks system changes and persists an explicit selection", async () => {
    const systemTheme = installMatchMedia(false);
    window.localStorage.setItem(themeStorageKey, "system");
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });

    function ThemeControl() {
      const { resolvedTheme, setTheme, theme } = useTheme();
      return (
        <button onClick={() => setTheme("light")} type="button">
          {theme}:{resolvedTheme}
        </button>
      );
    }

    await renderReactTestRoot(
      root,
      <ThemeProvider>
        <ThemeControl />
      </ThemeProvider>,
    );
    expect(container.textContent).toBe("system:light");

    await act(async () => systemTheme.setMatches(true));
    expect(container.textContent).toBe("system:dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    await act(async () =>
      container.querySelector<HTMLButtonElement>("button")?.click(),
    );
    expect(container.textContent).toBe("light:light");
    expect(window.localStorage.getItem(themeStorageKey)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await cleanup();
  });

  it("falls back to light when system theme detection is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(applyTheme("system")).toBe("light");
  });
});
