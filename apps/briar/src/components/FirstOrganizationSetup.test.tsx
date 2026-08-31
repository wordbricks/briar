/** @vitest-environment jsdom */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { FirstOrganizationSetup } from "./FirstOrganizationSetup";

const token = `briar_invite_${"b".repeat(64)}`;
const user = {
  id: "user-1",
  name: "New User",
  email: "new@example.com",
};

function buttonWithText(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes(label),
  );
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("FirstOrganizationSetup", () => {
  it("asks whether to create or join before showing organization fields", async () => {
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <FirstOrganizationSetup
        onCheckHandle={async () => true}
        onCreate={async () => undefined}
        onJoin={() => undefined}
        onLogout={() => undefined}
        user={user}
      />,
    );

    expect(container.textContent).toContain("새 조직 만들기");
    expect(container.textContent).toContain("기존 조직 참여하기");
    expect(container.querySelector('input[autocomplete="organization"]')).toBeNull();

    await act(async () => buttonWithText(container, "새 조직 만들기")?.click());
    expect(container.textContent).toContain("조직 이름");

    await cleanup();
  });

  it("shows the signed-in email and checks a pasted invitation link", async () => {
    const onJoin = vi.fn();
    const { cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    });
    await renderReactTestRoot(
      root,
      <FirstOrganizationSetup
        onCheckHandle={async () => true}
        onCreate={async () => undefined}
        onJoin={onJoin}
        onLogout={() => undefined}
        user={user}
      />,
    );

    await act(async () =>
      buttonWithText(container, "기존 조직 참여하기")?.click(),
    );
    expect(container.textContent).toContain(user.email);
    expect(container.textContent).toContain("7일 동안 유효하며 한 번만");

    const input = container.querySelector<HTMLInputElement>("input");
    await act(async () =>
      setInputValue(
        input!,
        `https://briar.wordbricks.ai/app/invitations/${token}`,
      ),
    );
    await act(async () => container.querySelector("form")?.requestSubmit());

    expect(onJoin).toHaveBeenCalledWith(token);
    await cleanup();
  });
});
