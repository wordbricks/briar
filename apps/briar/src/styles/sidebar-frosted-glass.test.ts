import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const styles = readFileSync(resolve("src", "styles.css"), "utf8");
const darkStyles = readFileSync(resolve("src", "styles", "dark.css"), "utf8");
const tokens = readFileSync(resolve("src", "styles", "tokens.css"), "utf8");
const appSource = readFileSync(resolve("src", "App.tsx"), "utf8");
const mainSource = readFileSync(resolve("src", "main.tsx"), "utf8");
const macosConfig = JSON.parse(
  readFileSync(resolve("src-tauri", "tauri.macos.conf.json"), "utf8"),
) as {
  app: {
    windows: Array<{
      backgroundColor?: string;
      titleBarStyle?: string;
      trafficLightPosition?: { x: number; y: number };
      transparent?: boolean;
      windowEffects?: { effects: string[]; state?: string };
    }>;
  };
};

function themeTokens(selector: ":root" | ".dark") {
  const start = tokens.indexOf(`${selector} {`);
  const end = selector === ":root" ? tokens.indexOf("\n.dark {") : tokens.length;
  const block = tokens.slice(start, end === -1 ? tokens.length : end);
  return new Map(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map(
      ([, name, value]) => [name, value] as const,
    ),
  );
}

function rawThemeToken(selector: ":root" | ".dark", name: string) {
  const start = tokens.indexOf(`${selector} {`);
  const end = selector === ":root" ? tokens.indexOf("\n.dark {") : tokens.length;
  const block = tokens.slice(start, end === -1 ? tokens.length : end);
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1].trim() ?? "";
}

function channelLuminance(channel: number) {
  const normalized = channel / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function contrastRatio(first: string, second: string) {
  const toLuminance = (value: string) => {
    const channels = value
      .slice(1)
      .match(/.{2}/g)!
      .map((channel) => Number.parseInt(channel, 16));
    return (
      0.2126 * channelLuminance(channels[0]) +
      0.7152 * channelLuminance(channels[1]) +
      0.0722 * channelLuminance(channels[2])
    );
  };

  const luminances = [toLuminance(first), toLuminance(second)].sort(
    (a, b) => b - a,
  );
  return (luminances[0] + 0.05) / (luminances[1] + 0.05);
}

function compositeRgba(surface: string, backdrop: string) {
  const match = surface.match(
    /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/,
  )!;
  const foreground = match.slice(1, 4).map(Number);
  const background = backdrop
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16));
  const alpha = Number(match[4]);

  return `#${foreground
    .map((channel, index) =>
      Math.round(channel * alpha + background[index] * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function styleRule(selector: string) {
  const normalizedSelector = selector.replace(/\s*\{$/, "");
  const escapedSelector = normalizedSelector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    styles.match(new RegExp(`(?:^|})\\s*${escapedSelector}\\s*\\{([^{}]*)\\}`))?.[1] ??
    ""
  );
}

describe("sidebar frosted glass styles", () => {
  it("defines translucent and opaque surfaces for both themes", () => {
    expect(tokens.match(/--sidebar: rgba\([^;]+\);/g)).toHaveLength(2);
    expect(tokens.match(/--sidebar-fallback: #[0-9a-f]+;/gi)).toHaveLength(2);
    expect(tokens.match(/--sidebar-glass-highlight: rgba\([^;]+\);/g)).toHaveLength(
      2,
    );
    expect(tokens.match(/--sidebar-border-strong: #[0-9a-f]+;/gi)).toHaveLength(
      2,
    );
  });

  it("uses the opaque fallback unless backdrop blur is supported", () => {
    expect(styles).toContain("background:var(--sidebar-fallback)");
    expect(styles).toContain(
      "@supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px)))",
    );
    expect(styles).toContain("var(--sidebar-glass-highlight)");
    expect(styles).toContain("backdrop-filter:blur(24px) saturate(155%)");
    expect(styles).toContain("-webkit-backdrop-filter:blur(24px) saturate(155%)");
  });

  it("leaves the native macOS material unobstructed by a second web tint", () => {
    const macOSSidebarRule = styles.match(
      /\.macos-vibrant-window \.sidebar \{[^}]+\}/,
    )?.[0];

    expect(macOSSidebarRule).toBe(
      ".macos-vibrant-window .sidebar {\n  background:transparent;\n  box-shadow:none;\n  backdrop-filter:none;\n  -webkit-backdrop-filter:none;\n}",
    );
    expect(styles).toContain(
      "@media (prefers-reduced-transparency: reduce) { .macos-vibrant-window .sidebar { background:var(--sidebar-fallback); } }",
    );
    expect(styles).toContain(
      "@media (prefers-contrast: more) { .macos-vibrant-window .sidebar { border-right-color:var(--sidebar-border-strong); background:var(--sidebar-fallback); } }",
    );
  });

  it("composes the macOS main window over the native sidebar material", () => {
    const [mainWindow] = macosConfig.app.windows;

    expect(mainWindow).toMatchObject({
      backgroundColor: "#00000000",
      titleBarStyle: "Overlay",
      trafficLightPosition: { x: 16, y: 22 },
      transparent: true,
      windowEffects: {
        effects: ["sidebar"],
        state: "followsWindowActiveState",
      },
    });
    expect(mainSource).toContain(
      'document.documentElement.classList.add("macos-vibrant-window")',
    );
  });

  it("keeps the native material visible only behind the sidebar", () => {
    expect(styles).toContain(
      ".macos-vibrant-window .app-shell { background:transparent; }",
    );
    expect(styles).toContain(
      ".app-content-surface { min-width:0; min-height:0; height:100%; flex:1; display:flex; background:var(--background); }",
    );
    expect(appSource).toContain('<div className="app-content-surface">');
    expect(darkStyles).toContain(".dark .app-content-surface,");
    expect(darkStyles).not.toContain(".dark .desktop-app-frame,");
    expect(darkStyles).not.toContain(".dark .app-shell,");
  });

  it("uses the themed opaque surface for accessibility preferences", () => {
    const reducedTransparency = styles.match(
      /@media \(prefers-reduced-transparency: reduce\) \{[^\n]+\}/,
    )?.[0];
    const increasedContrast = styles.match(
      /@media \(prefers-contrast: more\) \{[^\n]+\}/,
    )?.[0];

    expect(reducedTransparency).toContain(
      ".sidebar { background:var(--sidebar-fallback); }",
    );
    expect(increasedContrast).toContain(
      "background:var(--sidebar-fallback); backdrop-filter:none; -webkit-backdrop-filter:none",
    );
  });

  it("does not bypass feature detection with a dark-mode background override", () => {
    const darkSidebarRule = darkStyles.match(/\.dark \.sidebar \{[^}]+\}/)?.[0];

    expect(darkSidebarRule).toBeDefined();
    expect(darkSidebarRule).not.toContain("background:");
  });

  it("uses semantic sidebar tokens for the user-visible states", () => {
    const tokenizedRules = [
      ".window-navigation-button {",
      ".sidebar-project-window-brand {",
      ".sidebar-brand {",
      ".sidebar-primary-nav a {",
      ".sidebar-channels-toggle {",
      ".sidebar-channel-list button {",
      ".sidebar-project-heading {",
      ".sidebar-project-view {",
      ".sidebar-agent-session {",
      ".sidebar-project-warning {",
      ".user-card strong {",
      ".sidebar-update-trigger {",
    ];

    for (const selector of tokenizedRules) {
      expect(styleRule(selector), selector).toMatch(/var\(--sidebar-/);
    }

    for (const selector of [
      ".window-navigation-button:hover:not(:disabled) {",
      ".sidebar-primary-nav a:hover {",
      ".sidebar-primary-nav a.active {",
      ".sidebar-channel-list button.active {",
      ".sidebar-project-view.active {",
      ".sidebar-project-warning:hover {",
      ".sidebar-update-trigger:hover:not(:disabled) {",
      ".sidebar-organization-menu button:focus-visible {",
      ".sidebar-project-menu button:focus-visible {",
      ".sidebar-channel-context-menu-item:focus-visible {",
      ".language-popover > button:focus-visible {",
    ]) {
      expect(styleRule(selector), selector).toMatch(/var\(--sidebar-/);
    }
  });

  it("keeps text, focus, and strong boundaries above the sidebar contrast contract", () => {
    for (const selector of [":root", ".dark"] as const) {
      const values = themeTokens(selector);
      const fallback = values.get("sidebar-fallback")!;

      for (const foreground of [
        "sidebar-foreground",
        "sidebar-foreground-strong",
        "sidebar-foreground-secondary",
        "sidebar-foreground-muted",
        "sidebar-foreground-disabled",
        "sidebar-accent-foreground",
      ]) {
        expect(
          contrastRatio(values.get(foreground)!, fallback),
          `${selector} ${foreground}`,
        ).toBeGreaterThanOrEqual(4.5);
      }

      expect(
        contrastRatio(values.get("sidebar-focus")!, fallback),
        `${selector} focus`,
      ).toBeGreaterThanOrEqual(3);
      expect(
        contrastRatio(values.get("sidebar-border-strong")!, fallback),
        `${selector} boundary`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps normal text readable over extreme body backgrounds when translucent", () => {
    for (const [selector, backdrop] of [
      [":root", "#000000"],
      [".dark", "#ffffff"],
    ] as const) {
      const foreground = themeTokens(selector).get("sidebar-foreground")!;
      const surface = compositeRgba(
        rawThemeToken(selector, "sidebar"),
        backdrop,
      );

      expect(
        contrastRatio(foreground, surface),
        `${selector} over ${backdrop}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps warning and update affordances theme-safe", () => {
    for (const selector of [":root", ".dark"] as const) {
      const values = themeTokens(selector);
      expect(
        contrastRatio(
          values.get("sidebar-warning-foreground")!,
          values.get("sidebar-warning-background")!,
        ),
        `${selector} warning`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(
          values.get("sidebar-update-foreground")!,
          values.get("sidebar-update-background")!,
        ),
        `${selector} update`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps dark compatibility overrides semantic and feature-detection safe", () => {
    const sidebarCompatibility = darkStyles.slice(
      darkStyles.indexOf(".dark .sidebar {"),
      darkStyles.indexOf(".dark .app-toast {"),
    );

    expect(sidebarCompatibility).toContain("var(--sidebar-");
    expect(sidebarCompatibility).not.toMatch(/#[0-9a-f]{3,8}|rgba?\(/i);
    expect(darkStyles.match(/\.dark \.sidebar \{[^}]+\}/)?.[0]).not.toContain(
      "background:",
    );
  });
});
