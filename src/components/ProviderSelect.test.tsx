/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import antigravityIconUrl from "../assets/antigravity.png";
import grokIconUrl from "../assets/grok.png";
import { ProviderSelect } from "./ProviderSelect";

describe("ProviderSelect", () => {
  it("shows the selected provider icon and labels every option with an icon", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const onValueChange = vi.fn();

    await act(async () => {
      root.render(
        <ProviderSelect
          id="provider"
          label="프로바이더"
          onValueChange={onValueChange}
          providers={["codex", "claude", "grok", "agy"]}
          value="claude"
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>("#provider");
    expect(trigger?.className).toContain("select-menu-trigger");
    expect(container.querySelector(".native-select")).not.toBeNull();
    expect(trigger?.querySelector(".select-menu-trigger-leading svg")).not.toBeNull();
    expect(trigger?.textContent).toContain("Claude");

    await act(async () => trigger?.click());
    const listbox = document.querySelector("#provider-listbox");
    expect(listbox?.querySelectorAll(".select-menu-option-leading")).toHaveLength(4);
    expect(
      listbox?.querySelector('[data-value="claude"] .select-menu-option-leading svg'),
    ).not.toBeNull();
    expect(
      listbox
        ?.querySelector('[data-value="grok"] .select-menu-option-leading img')
        ?.getAttribute("src"),
    ).toBe(grokIconUrl);
    expect(
      listbox
        ?.querySelector('[data-value="agy"] .select-menu-option-leading img')
        ?.getAttribute("src"),
    ).toBe(antigravityIconUrl);

    await act(async () => {
      listbox
        ?.querySelector<HTMLButtonElement>('[data-value="codex"]')
        ?.click();
    });
    expect(onValueChange).toHaveBeenCalledWith("codex");

    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps an empty default option icon-free and applies option extras", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <ProviderSelect
          emptyOption={{ label: "에이전트 기본값", value: "" }}
          id="preferred-provider"
          label="선호 프로바이더"
          onValueChange={() => undefined}
          optionExtras={(provider) =>
            provider === "claude"
              ? { description: "비활성", disabled: true }
              : {}
          }
          providers={["codex", "claude"]}
          value=""
        />,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      "#preferred-provider",
    );
    expect(trigger?.querySelector(".select-menu-trigger-leading")).toBeNull();
    expect(trigger?.textContent).toContain("에이전트 기본값");

    await act(async () => trigger?.click());
    const listbox = document.querySelector("#preferred-provider-listbox");
    expect(
      listbox?.querySelector('[data-value=""] .select-menu-option-leading'),
    ).toBeNull();
    expect(
      listbox
        ?.querySelector<HTMLButtonElement>('[data-value="claude"]')
        ?.disabled,
    ).toBe(true);
    expect(listbox?.textContent).toContain("비활성");

    await act(async () => root.unmount());
    container.remove();
  });
});
