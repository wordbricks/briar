import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

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
