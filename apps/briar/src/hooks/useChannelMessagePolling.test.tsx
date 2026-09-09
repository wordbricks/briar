/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../lib/api";
import { testChannelMessage } from "../test/channel-conversation";
import { createReactTestRoot } from "../test/react";
import { channelRootMessagesAtom } from "../state/channel-conversation/atoms";
import { writeChannelTimeline } from "../state/channel-conversation/write";
import { createTestRegistry, type AtomRegistry } from "../state/registry";
import { useChannelMessagePolling } from "./useChannelMessagePolling";

/*
  The timer that stands in for the delta loop.

  An Agent-to-Agent conversation is outside the catalog, so nothing pushes its
  messages while it is open. This asks for them instead — and stops asking the
  moment the window is hidden or the view goes away, which is what keeps a
  forgotten window from polling forever.
*/

function Poller({
  channelId = "agent-dm-1",
  enabled = true,
}: {
  channelId?: string | null;
  enabled?: boolean;
}) {
  useChannelMessagePolling({
    channelId,
    enabled,
    intervalMs: 1_000,
    workspaceId: "org-1",
    token: "token",
  });
  return null;
}

const renderPoller = async (
  registry: AtomRegistry,
  props: { channelId?: string | null; enabled?: boolean } = {},
) => {
  const view = createReactTestRoot();
  await view.render(
    <RegistryContext.Provider value={registry}>
      <Poller {...props} />
    </RegistryContext.Provider>,
  );
  return view;
};

let hidden = false;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  hidden = false;
  vi.useFakeTimers();
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useChannelMessagePolling", () => {
  it("merges the pages it asks for into the open conversation", async () => {
    const list = vi.spyOn(api, "listChannelMessages").mockResolvedValue({
      messages: [
        testChannelMessage("message-1", {
          channelId: "agent-dm-1",
          body: "Checked. Nothing new.",
        }),
      ],
      nextCursor: null,
    });
    const registry = createTestRegistry();
    // The timeline is already on screen when the timer starts, the way the
    // view loads it before opening the conversation.
    writeChannelTimeline(registry, "agent-dm-1", []);
    const view = await renderPoller(registry);

    expect(list).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(list).toHaveBeenCalledWith(
      "token",
      "org-1",
      "agent-dm-1",
      undefined,
      { limit: 50 },
    );
    expect(
      registry.get(channelRootMessagesAtom("agent-dm-1")).map((message) =>
        message.body
      ),
    ).toEqual(["Checked. Nothing new."]);

    await view.cleanup();
  });

  it("stops while the window is hidden and with the view", async () => {
    const list = vi.spyOn(api, "listChannelMessages").mockResolvedValue({
      messages: [],
      nextCursor: null,
    });
    const view = await renderPoller(createTestRegistry());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(list).toHaveBeenCalledTimes(1);

    hidden = true;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(list).toHaveBeenCalledTimes(1);

    hidden = false;
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(list).toHaveBeenCalledTimes(2);

    await view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(list).toHaveBeenCalledTimes(2);

    await view.cleanup();
  });

  it("asks for nothing while it is not wanted", async () => {
    const list = vi.spyOn(api, "listChannelMessages").mockResolvedValue({
      messages: [],
      nextCursor: null,
    });
    const view = await renderPoller(createTestRegistry(), { enabled: false });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(list).not.toHaveBeenCalled();
    await view.cleanup();
  });
});
