/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../i18n";
import type {
  ChannelAgentSummary,
  ChannelMember,
} from "../lib/channels-contract";
import type { MentionTarget } from "../lib/channel-mentions";
import { useChannelComposer } from "./useChannelComposer";

type OnSend = (
  body: string,
  mentions: MentionTarget[],
  attachments: File[],
  attachmentReferences: string[],
) => void;

const agents: ChannelAgentSummary[] = [
  {
    agentId: "project-agent",
    handle: "builder",
    name: "Builder",
    avatar: null,
    provider: "codex",
    model: null,
    effort: null,
    skills: [],
    projectId: "project-1",
    projectName: "Briar",
    responsibility: "Build",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
  {
    agentId: "organization-agent",
    handle: "helper",
    name: "Helper",
    avatar: null,
    provider: "claude",
    model: null,
    effort: null,
    skills: [],
    projectId: null,
    projectName: null,
    responsibility: "Help",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

const members: ChannelMember[] = [
  {
    userId: "user-1",
    name: "Jay",
    email: "jay@example.com",
    image: null,
    role: "member",
    createdAt: "2026-08-01T00:00:00.000Z",
  },
];

function Harness({
  onInvite,
  onSend,
  submitOnEnter = false,
}: {
  onInvite?: () => void;
  onSend: OnSend;
  submitOnEnter?: boolean;
}) {
  const composer = useChannelComposer<HTMLInputElement>({
    agents,
    busy: false,
    currentUserId: "user-1",
    members,
    onInvite,
    onSend,
    submitOnEnter,
  });
  return (
    <form
      className={composer.dragging ? "dragging" : ""}
      onDragEnter={composer.handleDragEnter}
      onDragLeave={composer.handleDragLeave}
      onDragOver={composer.handleDragOver}
      onDrop={composer.handleDrop}
      onSubmit={composer.handleSubmit}
    >
      <input
        data-testid="composer"
        onChange={composer.handleChange}
        onClick={composer.handleCaret}
        onKeyDown={composer.handleKeyDown}
        onKeyUp={composer.handleCaret}
        onPaste={composer.handlePaste}
        ref={composer.inputRef}
        value={composer.body}
      />
      <input
        data-testid="files"
        multiple
        onChange={composer.handleFileChange}
        ref={composer.attachmentInputRef}
        type="file"
      />
      <ul>
        {composer.suggestions.map((suggestion, index) => (
          <li key={`${suggestion.type}:${suggestion.id}`}>
            <button
              aria-selected={index === composer.activeSuggestionIndex}
              onClick={() => composer.pickSuggestion(suggestion)}
              type="button"
            >
              {suggestion.label} · {suggestion.detail}
            </button>
          </li>
        ))}
      </ul>
      <output data-testid="images">{composer.images.length}</output>
      <output data-testid="error">{composer.attachmentError}</output>
      <button type="submit">Send</button>
    </form>
  );
}

async function typeInto(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
    ?.call(input, value);
  input.selectionStart = value.length;
  input.selectionEnd = value.length;
  await act(async () => input.dispatchEvent(new Event("input", { bubbles: true })));
}

async function renderHarness(props: React.ComponentProps<typeof Harness>) {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => root.render(
    <I18nProvider>
      <Harness {...props} />
    </I18nProvider>,
  ));
  return { container, root };
}

describe("useChannelComposer", () => {
  beforeEach(() => {
    window.localStorage.setItem("briar.locale.v1", "en");
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("localizes candidates and picks the active mention with the keyboard", async () => {
    const onSend = vi.fn<OnSend>();
    const { container, root } = await renderHarness({ onSend });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="composer"]',
    )!;
    await typeInto(input, "@");

    expect(container.textContent).toContain("Builder · Project agent");
    expect(container.textContent).toContain("Helper · Organization agent");
    expect(container.textContent).toContain("Jay · You · jay@example.com");

    await act(async () => input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "ArrowDown" }),
    ));
    await act(async () => input.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    ));
    expect(input.value).toBe("@helper ");

    await act(async () => container.querySelector("form")?.requestSubmit());
    expect(onSend).toHaveBeenCalledWith(
      "@helper",
      [expect.objectContaining({ id: "organization-agent", type: "agent" })],
      [],
      [],
    );

    await act(async () => root.unmount());
  });

  it("handles the desktop invite command from Enter without sending it", async () => {
    const onInvite = vi.fn();
    const onSend = vi.fn<OnSend>();
    const { container, root } = await renderHarness({
      onInvite,
      onSend,
      submitOnEnter: true,
    });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="composer"]',
    )!;
    await typeInto(input, "/invite");

    await act(async () => input.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    ));

    expect(onInvite).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
    expect(input.value).toBe("");
    await act(async () => root.unmount());
  });

  it("adds a pasted image and submits its multipart references", async () => {
    const onSend = vi.fn<OnSend>();
    const { container, root } = await renderHarness({ onSend });
    const input = container.querySelector<HTMLInputElement>(
      '[data-testid="composer"]',
    )!;
    const image = new File(["image"], "pasted.png", { type: "image/png" });
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: {
        files: [image],
        items: [{ kind: "file", getAsFile: () => image }],
        types: ["Files"],
      },
    });

    await act(async () => input.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(container.querySelector('[data-testid="images"]')?.textContent).toBe(
      "1",
    );

    await act(async () => container.querySelector("form")?.requestSubmit());
    expect(onSend).toHaveBeenCalledWith(
      expect.stringContaining("briar-attachment://"),
      [],
      [image],
      [expect.any(String)],
    );
    await act(async () => root.unmount());
  });

  it("shows a localized error and leaves drag mode after a non-image drop", async () => {
    const { container, root } = await renderHarness({
      onSend: vi.fn<OnSend>(),
    });
    const form = container.querySelector("form")!;
    const file = new File(["notes"], "notes.txt", { type: "text/plain" });
    const dataTransfer = {
      files: [file],
      items: [{ kind: "file", getAsFile: () => file }],
      types: ["Files"],
      dropEffect: "none",
    };
    const dragEnter = new Event("dragenter", { bubbles: true, cancelable: true });
    Object.defineProperty(dragEnter, "dataTransfer", { value: dataTransfer });
    await act(async () => form.dispatchEvent(dragEnter));
    expect(form.className).toBe("dragging");

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
    await act(async () => form.dispatchEvent(drop));

    expect(drop.defaultPrevented).toBe(true);
    expect(form.className).toBe("");
    expect(container.querySelector('[data-testid="error"]')?.textContent).toBe(
      "Only image files can be attached.",
    );
    await act(async () => root.unmount());
  });
});
