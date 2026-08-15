/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelTypingState } from "./ChannelTypingState";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

describe("ChannelTypingState", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it("shows live activity when available and keeps the generic fallback", async () => {
    await act(async () => {
      root.render(
        <ChannelTypingState
          agentNames={["Honey", "Eve"]}
          activityByAgentName={{
            Honey: {
              id: "command-1",
              kind: "command",
              headline: "테스트 실행 중",
            },
          }}
        />,
      );
    });
    const loaders = [
      ...container.querySelectorAll<HTMLElement>("[data-testid='loading-state']"),
    ];
    expect(loaders).toHaveLength(2);
    expect(loaders.every((loader) => loader.dataset.variant === "Drive")).toBe(
      true,
    );
    expect(container.textContent).toContain("Honey · 테스트 실행 중");
    expect(container.textContent).toContain("Eve님이 답변을 작성하고 있습니다…");
    expect(container.textContent).toContain("0.0s");
    expect(container.querySelector(".spin")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    expect(container.textContent).toContain("1.2s");
  });
});
