/** @vitest-environment jsdom */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../i18n";
import { AccountDeletionSettings } from "./AccountDeletionSettings";

describe("AccountDeletionSettings", () => {
  beforeEach(() => {
    window.localStorage.setItem("briar.locale.v1", "en");
    (
      globalThis as typeof globalThis & {
        IS_REACT_ACT_ENVIRONMENT: boolean;
      }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  it("requires the signed-in email before permanently deleting", async () => {
    const onDelete = vi.fn(async () => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider>
          <AccountDeletionSettings
            onDelete={onDelete}
            user={{ id: "user-1", name: "Jay", email: "jay@example.com" }}
          />
        </I18nProvider>,
      );
    });

    await act(async () => findButton("Delete account")?.click());
    const confirmButton = findButton("Delete permanently");
    const confirmation = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Confirm account email"]',
    );
    expect(confirmButton?.disabled).toBe(true);

    await act(async () => setInputValue(confirmation!, "JAY@example.com"));
    expect(confirmButton?.disabled).toBe(false);
    await act(async () => confirmButton?.click());

    expect(onDelete).toHaveBeenCalledWith("JAY@example.com");
    await act(async () => root.unmount());
    container.remove();
  });

  it("explains when shared organization resources block deletion", async () => {
    const onDelete = vi.fn(async () => {
      throw new Error(
        "Account deletion is blocked by shared organization resources",
      );
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <I18nProvider>
          <AccountDeletionSettings
            onDelete={onDelete}
            user={{ id: "user-1", name: "Jay", email: "jay@example.com" }}
          />
        </I18nProvider>,
      );
    });

    await act(async () => findButton("Delete account")?.click());
    const confirmation = document.body.querySelector<HTMLInputElement>(
      'input[aria-label="Confirm account email"]',
    );
    await act(async () => setInputValue(confirmation!, "jay@example.com"));
    await act(async () => findButton("Delete permanently")?.click());

    expect(document.body.textContent).toContain(
      "You still own an organization, project, Worker, or Slack connection",
    );
    await act(async () => root.unmount());
    container.remove();
  });
});

function findButton(label: string) {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label);
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}
