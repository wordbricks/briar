/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import antigravityIconUrl from "../assets/antigravity.png";
import grokIconUrl from "../assets/grok.png";
import opencodeIconUrl from "../assets/opencode.png";
import openrouterIconUrl from "../assets/openrouter.png";
import { AgentProviderIcon } from "./AgentIcons";

describe("AgentProviderIcon", () => {
  it("uses the bundled Antigravity artwork for the agy provider", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<AgentProviderIcon provider="agy" size={22} />));

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(antigravityIconUrl);
    expect(image?.getAttribute("width")).toBe("22");
    expect(image?.getAttribute("height")).toBe("22");
    expect(image?.getAttribute("aria-hidden")).toBe("true");

    act(() => root.unmount());
  });

  it("uses the updated Grok logo artwork for the grok provider", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<AgentProviderIcon provider="grok" size={18} />));

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(grokIconUrl);
    expect(image?.classList.contains("provider-artwork-white")).toBe(true);
    expect(image?.getAttribute("width")).toBe("18");
    expect(image?.getAttribute("height")).toBe("18");
    expect(image?.getAttribute("aria-hidden")).toBe("true");

    act(() => root.unmount());
  });

  it("uses the bundled OpenRouter artwork for the openrouter provider", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(<AgentProviderIcon provider="openrouter" size={22} />),
    );

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(openrouterIconUrl);
    expect(image?.classList.contains("provider-artwork-white")).toBe(true);
    expect(image?.getAttribute("width")).toBe("22");
    expect(image?.getAttribute("height")).toBe("22");
    expect(image?.getAttribute("aria-hidden")).toBe("true");

    act(() => root.unmount());
  });

  it("restores the existing SVG artwork for the codex provider", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<AgentProviderIcon provider="codex" size={20} />));

    const icon = container.querySelector("svg");
    expect(icon?.classList.contains("provider-artwork-codex")).toBe(true);
    expect(icon?.getAttribute("fill")).toBe("currentColor");
    expect(icon?.getAttribute("width")).toBe("20");
    expect(icon?.getAttribute("height")).toBe("20");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");

    act(() => root.unmount());
  });

  it("keeps the OpenCode SVG in light mode and provides dark artwork", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() => root.render(<AgentProviderIcon provider="opencode" size={19} />));

    const lightIcon = container.querySelector("svg");
    const image = container.querySelector("img");
    expect(lightIcon?.classList.contains("provider-artwork-light")).toBe(true);
    expect(image?.getAttribute("src")).toBe(opencodeIconUrl);
    expect(image?.classList.contains("provider-artwork-dark")).toBe(true);
    expect(image?.getAttribute("width")).toBe("19");
    expect(image?.getAttribute("height")).toBe("19");
    expect(image?.getAttribute("aria-hidden")).toBe("true");

    act(() => root.unmount());
  });
});
