/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { describe, expect, it, vi } from "vitest";
import { FirstRunTutorial } from "./FirstRunTutorial";

function buttonWithText(label: string) {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes(label),
  );
}

function mountTutorial() {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  return createReactTestRoot({ attachToDocument: true });
}

describe("FirstRunTutorial", () => {
  it("starts the developer setup from the purpose choice", async () => {
    const { cleanup, container, root } = mountTutorial();
    const onDeveloperSelect = vi.fn();
    await renderReactTestRoot(
      root,
      <FirstRunTutorial
        onCollaboratorComplete={() => undefined}
        onDeveloperSelect={onDeveloperSelect}
        open
      />,
    );

    expect(document.body.textContent).toContain(
      "Briar를 어떻게 사용하고 싶으세요?",
    );
    await act(async () => buttonWithText("개발 환경 설정")?.click());
    expect(onDeveloperSelect).toHaveBeenCalledOnce();

    await cleanup();
  });

  it("shows a placeholder demo for collaborators", async () => {
    const { cleanup, container, root } = mountTutorial();
    const onCollaboratorComplete = vi.fn();
    await renderReactTestRoot(
      root,
      <FirstRunTutorial
        onCollaboratorComplete={onCollaboratorComplete}
        onDeveloperSelect={() => undefined}
        open
      />,
    );

    await act(async () => buttonWithText("간단한 데모 보기")?.click());
    expect(document.body.textContent).toContain(
      "팀의 작업을 검토하는 흐름을 살펴보세요",
    );
    expect(document.querySelectorAll("ol li")).toHaveLength(3);

    await act(async () => buttonWithText("Briar 시작하기")?.click());
    expect(onCollaboratorComplete).toHaveBeenCalledOnce();

    await cleanup();
  });
});
