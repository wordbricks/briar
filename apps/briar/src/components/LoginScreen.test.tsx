/** @vitest-environment jsdom */

import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { LoginActions } from "./LoginScreen";

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("LoginActions", () => {
  let cleanup: () => Promise<void>;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    ({ cleanup, container, root } = createReactTestRoot({
      attachToDocument: true,
    }));
  });

  afterEach(async () => {
    await cleanup();
    vi.clearAllMocks();
  });

  it("keeps browser email OTP in one login surface", async () => {
    const onLogin = vi.fn();
    const onSendEmailCode = vi.fn().mockResolvedValue(undefined);
    const onVerifyEmailCode = vi.fn().mockResolvedValue(undefined);
    await renderReactTestRoot(
      root,
      <LoginActions
        loading={false}
        onLogin={onLogin}
        onSendEmailCode={onSendEmailCode}
        onVerifyEmailCode={onVerifyEmailCode}
        webMode
      />,
    );

    const email = container.querySelector<HTMLInputElement>("#login-email")!;
    await act(async () => {
      setInputValue(email, "Person@Example.com");
    });
    await act(async () => {
      email.form?.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onSendEmailCode).toHaveBeenCalledWith("person@example.com");
    expect(onLogin).not.toHaveBeenCalledWith("email");
    const code = container.querySelector<HTMLInputElement>("#login-email-code")!;
    expect(code).not.toBeNull();

    await act(async () => {
      setInputValue(code, "12a3456");
    });
    await act(async () => {
      code.form?.dispatchEvent(new Event("submit", {
        bubbles: true,
        cancelable: true,
      }));
    });

    expect(onVerifyEmailCode).toHaveBeenCalledWith(
      "person@example.com",
      "123456",
    );
  });
});
