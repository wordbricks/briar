/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChannelMember, ChannelMessage } from "../lib/channels-contract";
import { TooltipProvider } from "./ui/tooltip";

vi.mock("@emoji-mart/data", () => ({ default: {} }));
vi.mock("@emoji-mart/react", () => ({
  default: () => null,
}));

const { ChannelMessageReactions } = await import("./ChannelMessageReactions");

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const member = (
  overrides: Partial<ChannelMember> & Pick<ChannelMember, "userId" | "name">,
): ChannelMember => ({
  email: `${overrides.userId}@example.com`,
  image: null,
  role: "member",
  createdAt: "2026-08-01T00:00:00.000Z",
  ...overrides,
});

const message = (userIds: string[]): ChannelMessage => ({
  id: "message-1",
  channelId: "channel-1",
  parentMessageId: null,
  author: {
    type: "user",
    id: "user-jay",
    name: "Jay",
    email: "jay@example.com",
    image: null,
  },
  body: "Hello team",
  mentionedUserIds: [],
  mentionedAgentIds: [],
  attachments: [],
  reactions: [{ emoji: "👍", count: userIds.length, userIds }],
  replyCount: 0,
  lastReplyAt: null,
  document: null,
  proposal: null,
  executionProposal: null,
  createdAt: "2026-08-01T01:00:00.000Z",
});

describe("ChannelMessageReactions", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  const renderChip = async (
    userIds: string[],
    members: ChannelMember[],
    currentUserId: string | null = "user-jay",
  ) => {
    const onToggle = vi.fn();
    await act(async () => {
      root.render(
        <TooltipProvider delayDuration={0}>
          <ChannelMessageReactions
            currentUserId={currentUserId}
            members={members}
            message={message(userIds)}
            onToggle={onToggle}
          />
        </TooltipProvider>,
      );
    });
    return onToggle;
  };

  const openTooltip = async () => {
    const chip = container.querySelector<HTMLButtonElement>(
      ".channel-reaction-chip",
    );
    expect(chip).not.toBeNull();
    await act(async () => {
      chip?.focus();
      chip?.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true }),
      );
    });
    return chip!;
  };


  it("falls back for members who left and still toggles on click", async () => {
    const onToggle = await renderChip(
      ["user-gone"],
      [member({ userId: "user-sam", name: "Sam" })],
    );
    const chip = await openTooltip();
    expect(chip.getAttribute("aria-label")).toContain("알 수 없는 멤버");
    expect(
      document.body.querySelector('[role="tooltip"]')?.textContent,
    ).toContain("알 수 없는 멤버");

    await act(async () => {
      chip.click();
    });
    expect(onToggle).toHaveBeenCalledWith("👍");
  });

  it("offers deletion only when the owning message row grants the action", async () => {
    const onDelete = vi.fn();
    await act(async () => {
      root.render(
        <TooltipProvider delayDuration={0}>
          <ChannelMessageReactions
            currentUserId="user-jay"
            message={message([])}
            onDelete={onDelete}
            onToggle={vi.fn()}
            showHoverActions
          />
        </TooltipProvider>,
      );
    });

    const trigger = container.querySelector<HTMLButtonElement>(
      '[aria-label="더 보기"]',
    );
    expect(trigger).not.toBeNull();
    await act(async () => {
      trigger?.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
      }));
    });
    const deleteItem = Array.from(
      document.body.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ).find((item) => /메시지 삭제|Delete message/u.test(item.textContent ?? ""));
    expect(deleteItem).not.toBeUndefined();
    await act(async () => {
      deleteItem?.click();
    });
    expect(onDelete).toHaveBeenCalledOnce();
  });
});
