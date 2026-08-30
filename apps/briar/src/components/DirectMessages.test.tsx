/** @vitest-environment jsdom */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import * as api from "../lib/api";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { DirectMessages } from "./DirectMessages";

describe("DirectMessages", () => {
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.setItem("briar.locale.v1", "en");
    vi.spyOn(api, "listDirectMessageRecipients").mockResolvedValue({
      members: [{
        userId: "user-1",
        name: "Sam",
        email: "sam@example.com",
        image: null,
        role: "owner",
        createdAt: "2026-08-01T00:00:00.000Z",
        projectIds: [],
      }],
      agents: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the current user as a self-DM recipient", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    await renderReactTestRoot(
      root,
      <I18nProvider>
        <DirectMessages
          activeChannelId={null}
          channels={[]}
          currentUserId="user-1"
          onChannelSelect={() => undefined}
          onChannelsChange={() => undefined}
          organizationId="org-1"
          token="token"
        />
      </I18nProvider>,
    );
    let selfCandidate: HTMLButtonElement | undefined;
    await vi.waitFor(() => {
      selfCandidate = [...container.querySelectorAll("button")].find(
        (button) => button.textContent?.includes("Send to yourself"),
      );
      expect(selfCandidate).not.toBeUndefined();
    });
    expect(selfCandidate?.textContent).toContain("Personal notes conversation");

    await act(async () => selfCandidate?.click());
    expect(
      container.querySelector<HTMLButtonElement>(".dm-start-button")?.textContent,
    ).toContain("Send to yourself");
    expect(
      container.querySelector<HTMLButtonElement>(".dm-start-button")?.disabled,
    ).toBe(false);

    await cleanup();
  });
});
