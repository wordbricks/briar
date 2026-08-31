import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const tokens = readFileSync(resolve("src", "styles", "tokens.css"), "utf8");

function themeTokens(selector: ":root" | ".dark") {
  const start = tokens.indexOf(`${selector} {`);
  const end = selector === ":root" ? tokens.indexOf("\n.dark {") : tokens.length;
  const block = tokens.slice(start, end === -1 ? tokens.length : end);
  return new Map(
    [...block.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/giu)].map(
      ([, name, value]) => [name, value] as const,
    ),
  );
}

function rawThemeToken(selector: ":root" | ".dark", name: string) {
  const start = tokens.indexOf(`${selector} {`);
  const end = selector === ":root" ? tokens.indexOf("\n.dark {") : tokens.length;
  const block = tokens.slice(start, end === -1 ? tokens.length : end);
  return block.match(new RegExp(`--${name}:\\s*([^;]+);`, "u"))?.[1].trim() ?? "";
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
      .match(/.{2}/gu)!
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
    /rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)/u,
  )!;
  const foreground = match.slice(1, 4).map(Number);
  const background = backdrop
    .slice(1)
    .match(/.{2}/gu)!
    .map((channel) => Number.parseInt(channel, 16));
  const alpha = Number(match[4]);

  return `#${foreground
    .map((channel, index) =>
      Math.round(channel * alpha + background[index] * (1 - alpha))
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;
}

describe("sidebar contrast", () => {
  it("keeps text, focus, and strong boundaries above the contrast contract", () => {
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

      expect(contrastRatio(values.get("sidebar-focus")!, fallback))
        .toBeGreaterThanOrEqual(3);
      expect(contrastRatio(values.get("sidebar-border-strong")!, fallback))
        .toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps normal text readable over extreme translucent backdrops", () => {
    for (const [selector, backdrop] of [
      [":root", "#000000"],
      [".dark", "#ffffff"],
    ] as const) {
      const foreground = themeTokens(selector).get("sidebar-foreground")!;
      const surface = compositeRgba(rawThemeToken(selector, "sidebar"), backdrop);

      expect(contrastRatio(foreground, surface), `${selector} over ${backdrop}`)
        .toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps warning and update affordances readable", () => {
    for (const selector of [":root", ".dark"] as const) {
      const values = themeTokens(selector);
      expect(contrastRatio(
        values.get("sidebar-warning-foreground")!,
        values.get("sidebar-warning-background")!,
      )).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(
        values.get("sidebar-update-foreground")!,
        values.get("sidebar-update-background")!,
      )).toBeGreaterThanOrEqual(4.5);
    }
  });
});
