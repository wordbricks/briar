/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChannelTypingState } from "./ChannelTypingState";

describe("ChannelTypingState", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows live activity when available and keeps the generic fallback", () => {
    act(() => {
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
    expect(container.textContent).toContain("Honey · 테스트 실행 중");
    expect(container.textContent).toContain("Eve님이 답변을 작성하고 있습니다…");
  });
});
