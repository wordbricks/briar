import type RFB from "@novnc/novnc";

export const remoteDesktopClipboardSyncDelayMs = 500;
export const remoteDesktopPasteGapMs = 50;

const shiftLeftKeysym = 0xffe1;
const insertKeysym = 0xff63;

export type RemoteDesktopPasteTarget = Pick<
  RFB,
  "blur" | "clipboardPasteFrom" | "focus" | "sendKey"
>;

export function isRemoteDesktopPasteShortcut(
  event: Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey">,
) {
  return !event.altKey &&
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === "v";
}

export function stageRemoteDesktopPaste(
  target: RemoteDesktopPasteTarget,
  text: string,
) {
  if (!text) return false;

  // noVNC may already have forwarded the local Control or Command key before
  // the browser emits `paste`. Blurring releases those remote modifiers before
  // synchronizing the clipboard, then focus is restored for ordinary typing.
  target.blur();
  target.clipboardPasteFrom(text);
  target.focus();
  return true;
}

export function sendRemoteDesktopPasteShortcut(
  target: RemoteDesktopPasteTarget,
) {
  // Shift+Insert pastes the clipboard in VTE terminals and GTK text fields,
  // giving terminal applications real paste semantics such as bracketed paste.
  target.sendKey(shiftLeftKeysym, "ShiftLeft", true);
  target.sendKey(insertKeysym, "Insert", true);
  target.sendKey(insertKeysym, "Insert", false);
  target.sendKey(shiftLeftKeysym, "ShiftLeft", false);
  target.focus();
}

type CreateRemoteDesktopPasteControllerOptions = {
  getTarget: () => RemoteDesktopPasteTarget | null;
  wait?: (milliseconds: number) => Promise<void>;
};

export function createRemoteDesktopPasteController({
  getTarget,
  wait = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds)),
}: CreateRemoteDesktopPasteControllerOptions) {
  let generation = 0;
  let processing = false;
  let queue: string[] = [];

  const processQueue = async (expectedGeneration: number) => {
    while (generation === expectedGeneration) {
      const text = queue.shift();
      if (text === undefined) break;

      const target = getTarget();
      if (!target || !stageRemoteDesktopPaste(target, text)) break;

      await wait(remoteDesktopClipboardSyncDelayMs);
      if (
        generation !== expectedGeneration ||
        getTarget() !== target
      ) {
        break;
      }

      sendRemoteDesktopPasteShortcut(target);
      await wait(remoteDesktopPasteGapMs);
    }

    if (generation === expectedGeneration) {
      processing = false;
    }
  };

  return {
    enqueue(text: string) {
      if (!text || !getTarget()) return false;
      queue.push(text);
      if (!processing) {
        processing = true;
        void processQueue(generation);
      }
      return true;
    },
    reset() {
      generation += 1;
      processing = false;
      queue = [];
    },
  };
}
