"use client";

import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

type ThemeToggleProps = {
  label: string;
  darkLabel: string;
  lightLabel: string;
};

function currentTheme(): Theme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

function subscribe(onStoreChange: () => void) {
  window.addEventListener("briar-theme-change", onStoreChange);
  return () => window.removeEventListener("briar-theme-change", onStoreChange);
}

export function ThemeToggle({
  label,
  darkLabel,
  lightLabel,
}: ThemeToggleProps) {
  const theme = useSyncExternalStore(subscribe, currentTheme, () => "dark");

  function changeTheme() {
    const nextTheme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    localStorage.setItem("briar-theme", nextTheme);
    window.dispatchEvent(new Event("briar-theme-change"));
  }

  const isLight = theme === "light";
  const nextThemeLabel = isLight ? darkLabel : lightLabel;

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`${label}: ${nextThemeLabel}`}
      title={nextThemeLabel}
      onClick={changeTheme}
    >
      <span className="theme-toggle-track" aria-hidden="true">
        <i className="theme-icon theme-icon-sun">☼</i>
        <i className="theme-icon theme-icon-moon">◐</i>
        <b />
      </span>
    </button>
  );
}
