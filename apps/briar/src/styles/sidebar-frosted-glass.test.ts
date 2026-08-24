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
});
