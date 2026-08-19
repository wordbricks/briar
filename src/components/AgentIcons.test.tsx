/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";

import antigravityIconUrl from "../assets/antigravity.png";
import grokIconUrl from "../assets/grok.png";
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
    expect(image?.getAttribute("width")).toBe("18");
    expect(image?.getAttribute("height")).toBe("18");
    expect(image?.getAttribute("aria-hidden")).toBe("true");

    act(() => root.unmount());
  });
});
