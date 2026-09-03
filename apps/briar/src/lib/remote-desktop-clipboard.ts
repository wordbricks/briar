import type RFB from "@novnc/novnc";

import { isDesktopTauri } from "./platform";

export type RemoteDesktopClipboardState = "empty" | "copying" | "copied" | "blocked";

export async function writeLocalClipboardText(text: string): Promise<void> {
  if (isDesktopTauri()) {
    const clipboard = await import("@tauri-apps/plugin-clipboard-manager");
    await clipboard.writeText(text);
    return;
  }
  await navigator.clipboard.writeText(text);
}

type ClipboardTarget = Pick<RFB, "addEventListener" | "removeEventListener" | "viewOnly">;
type ClipboardUpdate = { text: string; revision: number; target: ClipboardTarget };
type ClipboardOptions = {
  onStateChange: (state: RemoteDesktopClipboardState) => void;
  writeText?: (text: string) => Promise<void>;
};

export function createRemoteDesktopClipboardController({
  onStateChange,
  writeText = writeLocalClipboardText,
}: ClipboardOptions) {
  let target: ClipboardTarget | null = null;
  let latest: ClipboardUpdate | null = null;
  let pending: ClipboardUpdate | null = null;
  let revision = 0;
  let writing = false;

  const flush = async () => {
    if (writing) return;
    writing = true;
    while (pending) {
      const update = pending;
      pending = null;
      if (update.target !== target || target.viewOnly) {
        if (update.revision === revision) {
          latest = null;
          onStateChange("empty");
        }
        continue;
      }
      try {
        await writeText(update.text);
        if (update.revision === revision) onStateChange("copied");
      } catch {
        if (update.revision === revision) onStateChange("blocked");
      }
    }
    writing = false;
  };

  const copyToLocal = () => {
    if (!latest || !target || target.viewOnly) return;
    pending = latest;
    onStateChange("copying");
    // Start the write synchronously so a retry click keeps browser activation.
    void flush();
  };

  const receiveClipboard = (event: Event) => {
    if (!target || target.viewOnly) return;
    const text: unknown = (event as CustomEvent<{ text?: unknown }>).detail?.text;
    if (typeof text !== "string") return;
    if (text.length === 0) {
      latest = null;
      pending = null;
      revision += 1;
      onStateChange("empty");
      return;
    }
    latest = { text, revision: ++revision, target };
    copyToLocal();
  };

  const reset = () => {
    target?.removeEventListener("clipboard", receiveClipboard);
    target?.removeEventListener("disconnect", reset);
    target = null;
    latest = null;
    pending = null;
    revision += 1;
    onStateChange("empty");
  };

  return {
    bind(next: ClipboardTarget) {
      reset();
      target = next;
      next.addEventListener("clipboard", receiveClipboard);
      next.addEventListener("disconnect", reset);
    },
    copyToLocal,
    reset,
  };
}
