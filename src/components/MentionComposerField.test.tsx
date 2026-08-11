/** @vitest-environment jsdom */

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { MentionComposerField } from "./MentionComposerField";

function Harness({ onMentionClick }: { onMentionClick: () => void }) {
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  return (
    <MentionComposerField
      body="Ask @member and @typed"
      controlRef={inputRef}
      mentions={[{ key: "user:1", handle: "member", label: "Member One" }]}
      onMentionClick={onMentionClick}
    >
      <textarea ref={inputRef} value="Ask @member and @typed" readOnly />
    </MentionComposerField>
  );
}

describe("MentionComposerField", () => {
  it("renders a connected mention button over a native text control", async () => {
    const container = document.createElement("div");
    const root = createRoot(container);
    const onMentionClick = vi.fn();
    await act(async () => root.render(
      <Harness onMentionClick={onMentionClick} />,
    ));

    const button = container.querySelector<HTMLButtonElement>(
      ".mention-composer-mirror .conversation-mention-button",
    );
    expect(button?.textContent).toBe("@member");
    expect(button?.getAttribute("aria-label")).toBe("Member One");
    expect(container.querySelector("textarea")?.value).toBe(
      "Ask @member and @typed",
    );
    expect(container.querySelectorAll(".conversation-mention-button"))
      .toHaveLength(1);

    await act(async () => button?.click());
    expect(onMentionClick).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
  });
});
