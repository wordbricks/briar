/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { AccountProfileSettings } from "./AccountProfileSettings";

describe("AccountProfileSettings", () => {
  it("edits and saves username and nickname", async () => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    window.localStorage.setItem("briar.locale.v1", "en");
    const onSave = vi.fn(async (input) => ({
      id: "user-1",
      email: "jay@example.com",
      ...input,
    }));
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AccountProfileSettings
            onSave={onSave}
            user={{
              id: "user-1",
              username: "jay",
              name: "Jay",
              email: "jay@example.com",
              image: null,
            }}
          />
        </I18nProvider>,
      );
    });

    const username = container.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]',
    );
    const nickname = container.querySelector<HTMLInputElement>(
      'input[autocomplete="name"]',
    );
    expect(username?.value).toBe("jay");
    expect(nickname?.value).toBe("Jay");
    expect(container.querySelector<HTMLInputElement>('input[readonly]')?.value)
      .toBe("jay@example.com");

    await act(async () => {
      setInputValue(username!, "Jay_Dev");
      setInputValue(nickname!, "Jay Kim");
    });
    await act(async () => {
      container
        .querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.click();
    });

    expect(onSave).toHaveBeenCalledWith({
      username: "jay_dev",
      name: "Jay Kim",
      image: null,
    });
    expect(container.textContent).toContain("Saved");

    await act(async () => root.unmount());
    container.remove();
  });

  it("does not submit an invalid username", async () => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const onSave = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <I18nProvider>
          <AccountProfileSettings
            onSave={onSave}
            user={{ id: "user-1", name: "Jay", email: "jay@example.com" }}
          />
        </I18nProvider>,
      );
    });
    const username = container.querySelector<HTMLInputElement>(
      'input[autocomplete="username"]',
    )!;
    await act(async () => setInputValue(username, "no spaces"));

    expect(username.getAttribute("aria-invalid")).toBe("true");
    expect(
      container.querySelector<HTMLButtonElement>('button[type="submit"]')
        ?.disabled,
    ).toBe(true);
    expect(onSave).not.toHaveBeenCalled();

    await act(async () => root.unmount());
    container.remove();
  });
});

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
