/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MentionTarget } from "../lib/channel-mentions";
import { ChannelMentionMenu } from "./ChannelMentionMenu";

const suggestions: MentionTarget[] = [
  {
    type: "user",
    id: "user-1",
    handle: "sam",
    label: "Sam",
    detail: "Member",
    image: null,
  },
  {
    type: "agent",
    id: "agent-1",
    handle: "honey",
    label: "Honey",
    detail: "Writing partner",
    image: "https://example.com/honey.png",
  },
  {
    type: "agent",
    id: "agent-2",
    handle: "builder",
    label: "Builder",
    detail: "Project agent",
    image: null,
  },
  {
    type: "user",
    id: "user-2",
    handle: "alex",
    label: "Alex",
    detail: "Reviewer",
    image: "https://example.com/alex.png",
  },
];

describe("ChannelMentionMenu", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it.each([
    ["desktop", "channel-mention-menu"],
    ["companion", "companion-channel-mention-menu"],
  ] as const)(
    "owns the %s listbox selection, hover, and pick behavior",
    async (variant, className) => {
      const onActiveSuggestionIndexChange = vi.fn();
      const onPickSuggestion = vi.fn();

      await act(async () => {
        root.render(
          <ChannelMentionMenu
            activeSuggestionIndex={1}
            ariaLabel="Mention candidates"
            id="mention-list"
            onActiveSuggestionIndexChange={onActiveSuggestionIndexChange}
            onPickSuggestion={onPickSuggestion}
            suggestions={suggestions}
            variant={variant}
          />,
        );
      });

      const listbox = container.querySelector<HTMLElement>("[role='listbox']")!;
      const options = Array.from(
        listbox.querySelectorAll<HTMLButtonElement>("[role='option']"),
      );

      expect(listbox.id).toBe("mention-list");
      expect(listbox.getAttribute("aria-label")).toBe("Mention candidates");
      expect(listbox.className).toBe(className);
      expect(options.map((option) => option.id)).toEqual([
        "mention-list-option-0",
        "mention-list-option-1",
        "mention-list-option-2",
        "mention-list-option-3",
      ]);
      expect(options.map((option) => option.getAttribute("aria-selected"))).toEqual([
        "false",
        "true",
        "false",
        "false",
      ]);
      expect(options[1]?.className).toBe("active");

      await act(async () => {
        options[0]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      });
      expect(onActiveSuggestionIndexChange).toHaveBeenCalledWith(0);

      await act(async () => options[2]?.click());
      expect(onPickSuggestion).toHaveBeenCalledWith(suggestions[2]);
    },
  );

  it("keeps the desktop handle-first target display", async () => {
    await act(async () => {
      root.render(
        <ChannelMentionMenu
          activeSuggestionIndex={0}
          ariaLabel="Mention candidates"
          id="desktop-mentions"
          onActiveSuggestionIndexChange={vi.fn()}
          onPickSuggestion={vi.fn()}
          suggestions={suggestions}
          variant="desktop"
        />,
      );
    });

    const options = container.querySelectorAll<HTMLButtonElement>("[role='option']");
    expect(options[0]?.querySelector(".channel-mention-avatar")?.textContent).toBe(
      "S",
    );
    expect(options[0]?.querySelector("strong")?.textContent).toBe("@sam");
    expect(options[0]?.querySelector("span:last-child")?.textContent).toBe(
      "Member",
    );
    expect(options[1]?.querySelector("img")?.getAttribute("src")).toBe(
      suggestions[1]?.image,
    );
    expect(
      options[2]?.querySelector(".channel-mention-avatar.agent svg"),
    ).not.toBeNull();
    expect(options[3]?.querySelector("img")?.getAttribute("src")).toBe(
      suggestions[3]?.image,
    );
  });

  it("keeps the companion label-first target display", async () => {
    await act(async () => {
      root.render(
        <ChannelMentionMenu
          activeSuggestionIndex={0}
          ariaLabel="Mention candidates"
          id="companion-mentions"
          onActiveSuggestionIndexChange={vi.fn()}
          onPickSuggestion={vi.fn()}
          suggestions={suggestions}
          variant="companion"
        />,
      );
    });

    const options = container.querySelectorAll<HTMLButtonElement>("[role='option']");
    expect(options[0]?.querySelector("strong")?.textContent).toBe("Sam");
    expect(options[0]?.querySelector("small")?.textContent).toBe("@sam");
    expect(options[0]?.querySelector("em")?.textContent).toBe("Member");
    expect(options[1]?.querySelector("img")?.getAttribute("src")).toBe(
      suggestions[1]?.image,
    );
    expect(
      options[2]?.querySelector(".companion-channel-mention-avatar.agent svg"),
    ).not.toBeNull();
    expect(options[3]?.querySelector("img")?.getAttribute("src")).toBe(
      suggestions[3]?.image,
    );
  });
});
