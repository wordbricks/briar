/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import antigravityIconUrl from "../assets/antigravity.png";
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

  it("uses the bundled OpenRouter artwork for the openrouter provider", () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    act(() =>
      root.render(<AgentProviderIcon provider="openrouter" size={22} />),
    );

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(openrouterIconUrl);
    expect(image?.getAttribute("width")).toBe("22");
    expect(image?.getAttribute("height")).toBe("22");
    expect(image?.getAttribute("aria-hidden")).toBe("true");

    act(() => root.unmount());
  });
});
