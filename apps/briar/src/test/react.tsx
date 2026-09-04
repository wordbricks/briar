import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";

export interface ReactTestRoot {
  readonly container: HTMLDivElement;
  readonly root: Root;
  readonly render: (node: ReactNode) => Promise<void>;
  readonly unmount: () => Promise<void>;
  readonly cleanup: () => Promise<void>;
}

export interface ReactTestRootOptions {
  readonly attachToDocument?: boolean;
  readonly container?: HTMLDivElement;
}

export async function renderReactTestRoot(root: Root, node: ReactNode) {
  await act(async () => root.render(node));
}

export function createReactTestRoot({
  attachToDocument = false,
  container = document.createElement("div"),
}: ReactTestRootOptions = {}): ReactTestRoot {
  if (attachToDocument) document.body.append(container);

  const root = createRoot(container);
  let active = true;

  const unmount = async () => {
    if (!active) return;
    try {
      await act(async () => root.unmount());
    } finally {
      active = false;
    }
  };

  return {
    container,
    root,
    async cleanup() {
      try {
        await unmount();
      } finally {
        container.remove();
      }
    },
    async render(node) {
      if (!active) {
        throw new Error("Cannot render after the React test root was unmounted");
      }
      await renderReactTestRoot(root, node);
    },
    unmount,
  };
}

/*
  Waiting for work a render left behind.

  A render can leave three kinds of work: React's own passive effects, a promise
  an effect awaited, and the module a `lazy()` boundary asked for. The first two
  settle within a few `act` turns. The third finishes when the module loader
  does, which is disk- and CPU-bound, so it has no fixed cost in turns.

  That is why counting turns makes a wait whose budget depends on how busy the
  machine is: the same test passes on an idle host and fails on a loaded one.
  `settle` counts wall-clock instead, so a loaded host is slow rather than red.
  It also throws when the deadline passes — the bounded-turn helpers these
  replace returned silently when the condition never held, so the test failed
  further down on an unrelated assertion and said nothing about the real cause.

  Prefer `settleLazy` over either one when the wait is specifically for a
  `lazy()` chunk: it waits for the loader itself instead of guessing.
*/

/** Drains `attempts` macrotask turns, letting effects and their promises run. */
export async function flush(attempts = 6): Promise<void> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

export interface SettleOptions {
  /** Named in the timeout message, so a failure says what never happened. */
  readonly description?: string;
  readonly timeoutMs?: number;
}

/**
 * Waits for every pending dynamic import, then lets React commit what the
 * resolved `lazy()` boundaries render. Deterministic where a turn count is not.
 */
export async function settleLazy(): Promise<void> {
  await act(async () => {
    await vi.dynamicImportSettled();
  });
  await flush(1);
}

/**
 * Settles pending imports and effects until `check` holds. Throws once
 * `timeoutMs` of wall-clock passes, rather than returning and letting a later
 * assertion report the confusion.
 *
 * Each pass waits on the module loader before draining a turn, so a caller
 * waiting on content behind a `lazy()` boundary does not have to know that it
 * is behind one.
 */
export async function settle(
  check: () => boolean,
  { description = "the condition to hold", timeoutMs = 10_000 }: SettleOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (check()) return;
    if (Date.now() >= deadline) {
      throw new Error(
        `Timed out after ${timeoutMs}ms waiting for ${description}.`,
      );
    }
    await settleLazy();
  }
}

/**
 * The text a reader could actually see.
 *
 * `textContent` also reports the pages a keep-alive slot is holding off screen,
 * because keeping a page alive is exactly keeping its DOM. A test that means
 * "this page is gone" wants this instead — a hidden slot is marked `inert`,
 * which is also what stops focus from reaching it.
 */
export function visibleText(container: HTMLElement): string {
  const clone = container.cloneNode(true) as HTMLElement;
  for (const hidden of clone.querySelectorAll("[data-page-slot][inert]")) {
    hidden.remove();
  }
  return clone.textContent ?? "";
}
