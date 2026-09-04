/** @vitest-environment jsdom */

import { RegistryContext } from "@effect/atom-react";
import * as React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChannelMessage } from "../../lib/channels-contract";
import type { ChannelMessageImageCache } from "../../components/ChannelImages";
import { ToastProvider } from "../../components/ui/toast";
import { I18nProvider } from "../../i18n";
import {
  testChannelMember,
  testChannelMessage,
} from "../../test/channel-conversation";
import { createReactTestRoot, renderReactTestRoot } from "../../test/react";
import { activeOrganizationIdAtom } from "../organization/atoms";
import { createTestRegistry, type AtomRegistry } from "../registry";
import { tokenAtom } from "../session/atoms";
import {
  channelConversationBusyAtom,
  channelDecliningProposalIdAtom,
  channelRootMessagesAtom,
} from "./atoms";
import {
  channelConversationWriteApiAtom,
  useChannelConversationActions,
  type BoundChannelConversationActions,
} from "./actions";
import { getChannelConversationLoader } from "./loader";
import {
  writeChannelParticipants,
  writeChannelTimeline,
} from "./write";

/*
  The conversation's writes, exercised where they now live.

  These cases came from `hooks/use-channel-conversation.test.tsx` unchanged in
  what they assert: an optimistic send reconciles with its server message, an
  approval lands only on the surface that started it, a failure is a toast
  rather than a banner. What changed is where they read the answer — the store,
  through `channelRootMessagesAtom`, instead of a `useState` array the hook
  wrote into.
*/

const channelId = "channel-1";

const api = {
  acceptChannelProposal: vi.fn(),
  declineChannelProposal: vi.fn(),
  sendChannelMessage: vi.fn(),
  currentExecutionWorkerDeviceId: vi.fn(async () => null),
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
};

const proposalMessage = (executeAfterCreate = false) =>
  testChannelMessage("proposal", {
    proposal: {
      id: "proposal-1",
      status: "pending",
      projectId: "project-1",
      payload: {
        issue: { title: "Follow-up", description: null, priority: 2 },
        executeAfterCreate,
      },
      resultRunId: null,
      resultItems: [],
    },
  });

let latest: BoundChannelConversationActions | null = null;

function Harness({
  channel = channelId,
  imageCache,
}: {
  channel?: string | null;
  imageCache?: ChannelMessageImageCache | null;
}) {
  latest = useChannelConversationActions(channel, {
    currentUserId: "user-1",
    channelKind: "channel",
    defaultProjectId: null,
    pageSize: 20,
    imageCache,
  });
  return null;
}

const current = () => {
  if (!latest) throw new Error("Harness has not rendered");
  return latest;
};

async function renderHarness(
  props: React.ComponentProps<typeof Harness> = {},
  seed?: (registry: AtomRegistry) => void,
) {
  const { cleanup, root } = createReactTestRoot({ attachToDocument: true });
  const registry = createTestRegistry([
    [tokenAtom, "token"],
    [activeOrganizationIdAtom, "org-1"],
    [channelConversationWriteApiAtom, api],
  ]);
  writeChannelParticipants(registry, channelId, {
    members: [testChannelMember("user-1")],
    agents: [],
  });
  seed?.(registry);
  const wrap = (element: React.ReactElement) => (
    <RegistryContext.Provider value={registry}>
      <I18nProvider>
        <ToastProvider>{element}</ToastProvider>
      </I18nProvider>
    </RegistryContext.Provider>
  );
  await renderReactTestRoot(root, wrap(<Harness {...props} />));
  return {
    cleanup,
    registry,
    render: (element: React.ReactElement) => root.render(wrap(element)),
  };
}

const storedMessages = (registry: AtomRegistry, id = channelId) =>
  registry.get(channelRootMessagesAtom(id));

describe("channel conversation actions", () => {
  let cleanup: (() => Promise<void>) | null = null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    latest = null;
    cleanup = null;
    vi.clearAllMocks();
    api.currentExecutionWorkerDeviceId.mockResolvedValue(null);
  });

  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = null;
    vi.restoreAllMocks();
  });

  it("reconciles an optimistic root message with the server response", async () => {
    const pending = deferred<{
      message: ChannelMessage;
      agentReplies: never[];
    }>();
    api.sendChannelMessage.mockReturnValueOnce(pending.promise);
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness());

    let request!: Promise<void>;
    await act(async () => {
      request = current().send("hello", [], null, [], []);
      await Promise.resolve();
    });
    expect(storedMessages(registry)).toHaveLength(1);
    expect(storedMessages(registry)[0]).toMatchObject({
      body: "hello",
      optimistic: true,
    });
    const optimisticId = storedMessages(registry)[0]!.id;

    await act(async () =>
      pending.resolve({
        message: testChannelMessage(optimisticId, {
          channelId,
          body: "hello",
        }),
        agentReplies: [],
      }),
    );
    await act(async () => request);

    expect(storedMessages(registry)).toHaveLength(1);
    expect(storedMessages(registry)[0]?.id).toBe(optimisticId);
    expect(storedMessages(registry)[0]?.optimistic).not.toBe(true);
  });

  it("toasts a send failure instead of setting a banner error", async () => {
    api.sendChannelMessage.mockRejectedValueOnce(new Error("offline"));
    ({ cleanup } = await renderHarness());

    await act(async () => {
      await current().send("hello", [], null, [], []);
    });

    expect(
      document.body.querySelector('[data-testid="app-toast"]')?.textContent,
    ).toContain("offline");
  });

  it("applies a proposal approval only to the unchanged surface", async () => {
    const item = proposalMessage();
    api.acceptChannelProposal.mockResolvedValueOnce({
      projectId: "project-1",
      resultRunId: "run-1",
      resultItems: undefined,
      executionProposal: null,
    });
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness({}, (target) => {
      writeChannelTimeline(target, channelId, [item]);
      getChannelConversationLoader(target).recordProposalMessages([item]);
    }));

    await act(async () => {
      expect(await current().acceptProposal(item)).toBeNull();
    });

    expect(storedMessages(registry)[0]?.proposal).toMatchObject({
      status: "accepted",
      resultRunId: "run-1",
    });
  });

  it("marks a declined proposal terminal on the unchanged surface", async () => {
    const item = proposalMessage(true);
    api.declineChannelProposal.mockResolvedValueOnce({ outcome: "declined" });
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness({}, (target) => {
      writeChannelTimeline(target, channelId, [item]);
      getChannelConversationLoader(target).recordProposalMessages([item]);
    }));

    await act(async () => current().declineProposal(item));

    expect(api.declineChannelProposal).toHaveBeenCalledWith(
      "token",
      "org-1",
      channelId,
      "proposal-1",
    );
    expect(storedMessages(registry)[0]?.proposal?.status).toBe("declined");
    expect(registry.get(channelDecliningProposalIdAtom(channelId))).toBeNull();
  });

  it("ignores a late proposal success after switching channels", async () => {
    const item = proposalMessage();
    const pending = deferred<{
      projectId: string;
      resultRunId: string;
      resultItems: undefined;
      executionProposal: null;
    }>();
    api.acceptChannelProposal.mockReturnValueOnce(pending.promise);
    let registry!: AtomRegistry;
    let render!: (element: React.ReactElement) => void;
    ({ cleanup, registry, render } = await renderHarness({}, (target) => {
      writeChannelTimeline(target, channelId, [item]);
      getChannelConversationLoader(target).recordProposalMessages([item]);
    }));

    let request!: ReturnType<BoundChannelConversationActions["acceptProposal"]>;
    await act(async () => {
      request = current().acceptProposal(item);
      await Promise.resolve();
    });
    /*
      Switching channels is an invalidation in the view, not just a new render:
      `Channels` calls it from the layout effect that prepares the channel, and
      it is what drops the spinner the answer would otherwise have cleared.
    */
    await act(async () => {
      getChannelConversationLoader(registry).invalidateSurface("channel-b", null);
      render(<Harness channel="channel-b" />);
    });
    await act(async () =>
      pending.resolve({
        projectId: "project-1",
        resultRunId: "late-run",
        resultItems: undefined,
        executionProposal: null,
      }),
    );
    await act(async () => request);

    /*
      The timeline is the store's and it is keyed by channel, so the question
      "was the late answer applied" is asked of channel A rather than of
      whatever the harness happens to be showing.
    */
    expect(storedMessages(registry)[0]?.proposal).toMatchObject({
      status: "pending",
    });
    expect(registry.get(channelConversationBusyAtom(channelId))).toBe(false);
  });

  it("preserves local blob URLs on sent image attachments and seeds the image cache", async () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL");
    const fakeFile = new File(["test-image-data"], "photo.png", {
      type: "image/png",
    });
    const fakeBlobUrl = "blob:http://localhost/sent-photo";
    const createObjectURLOriginal = URL.createObjectURL;
    URL.createObjectURL = vi.fn(() => fakeBlobUrl);
    const imageCache: ChannelMessageImageCache = {
      disposed: false,
      entries: new Map(),
    };
    const pending = deferred<{
      message: ChannelMessage;
      agentReplies: never[];
    }>();
    api.sendChannelMessage.mockReturnValueOnce(pending.promise);
    let registry!: AtomRegistry;
    ({ cleanup, registry } = await renderHarness({ imageCache }));

    let request!: Promise<void>;
    await act(async () => {
      request = current().send("photo upload", [], null, [fakeFile], ["ref-1"]);
      await Promise.resolve();
    });

    expect(storedMessages(registry)).toHaveLength(1);
    expect(storedMessages(registry)[0]?.attachments[0]?.url).toBe(fakeBlobUrl);
    const optimisticId = storedMessages(registry)[0]!.id;
    const serverUrl = `/organizations/org-1/channels/${channelId}/messages/${optimisticId}/attachments/server-upload-1`;

    await act(async () =>
      pending.resolve({
        message: {
          ...testChannelMessage(optimisticId, {
            channelId,
            body: "photo upload",
          }),
          attachments: [
            {
              id: "server-upload-1",
              filename: "photo.png",
              contentType: "image/png",
              byteSize: 15,
              url: serverUrl,
              imageWidth: null,
              imageHeight: null,
            },
          ],
        },
        agentReplies: [],
      }),
    );
    await act(async () => request);

    expect(storedMessages(registry)[0]?.attachments[0]?.url).toBe(fakeBlobUrl);
    expect(
      imageCache.entries.get(`server-upload-1:${serverUrl}`)?.source,
    ).toBe(fakeBlobUrl);
    expect(imageCache.entries.get("server-upload-1")?.source).toBe(fakeBlobUrl);
    expect(revokeSpy).not.toHaveBeenCalledWith(fakeBlobUrl);

    URL.createObjectURL = createObjectURLOriginal;
  });
});
