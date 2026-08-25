import { describe, expect, it } from "vitest";

import {
  createRemoteDesktopPasteController,
  isRemoteDesktopPasteShortcut,
  remoteDesktopClipboardSyncDelayMs,
  remoteDesktopPasteGapMs,
  sendRemoteDesktopPasteShortcut,
  stageRemoteDesktopPaste,
  type RemoteDesktopPasteTarget,
} from "./remote-desktop-paste";

function createTarget(calls: string[]): RemoteDesktopPasteTarget {
  return {
    blur: () => calls.push("blur"),
    clipboardPasteFrom: (text) => calls.push(`clipboard:${text}`),
    focus: () => calls.push("focus"),
    sendKey: (keysym, code, down) =>
      calls.push(`key:${keysym}:${code}:${down}`),
  };
}

function createWaitQueue() {
  const waits: Array<{
    milliseconds: number;
    resolve: () => void;
  }> = [];
  return {
    resolveNext() {
      const next = waits.shift();
      if (!next) throw new Error("No queued wait to resolve");
      next.resolve();
    },
    wait(milliseconds: number) {
      return new Promise<void>((resolve) => {
        waits.push({ milliseconds, resolve });
      });
    },
    waits,
  };
}

describe("remote desktop paste", () => {
  it("recognizes standard macOS and Windows/Linux paste shortcuts", () => {
    expect(isRemoteDesktopPasteShortcut({
      altKey: false,
      ctrlKey: false,
      key: "v",
      metaKey: true,
    })).toBe(true);
    expect(isRemoteDesktopPasteShortcut({
      altKey: false,
      ctrlKey: true,
      key: "V",
      metaKey: false,
    })).toBe(true);
    expect(isRemoteDesktopPasteShortcut({
      altKey: true,
      ctrlKey: true,
      key: "v",
      metaKey: false,
    })).toBe(false);
    expect(isRemoteDesktopPasteShortcut({
      altKey: false,
      ctrlKey: true,
      key: "c",
      metaKey: false,
    })).toBe(false);
  });

  it("releases local modifiers before preserving exact clipboard text", () => {
    const calls: string[] = [];
    const target = createTarget(calls);

    expect(stageRemoteDesktopPaste(target, "한글\nsecond line")).toBe(true);
    expect(calls).toEqual([
      "blur",
      "clipboard:한글\nsecond line",
      "focus",
    ]);
    expect(stageRemoteDesktopPaste(target, "")).toBe(false);
  });

  it("sends the Linux plain-text paste shortcut with balanced key events", () => {
    const calls: string[] = [];
    sendRemoteDesktopPasteShortcut(createTarget(calls));

    expect(calls).toEqual([
      "key:65505:ShiftLeft:true",
      "key:65379:Insert:true",
      "key:65379:Insert:false",
      "key:65505:ShiftLeft:false",
      "focus",
    ]);
  });

  it("serializes consecutive pastes so their clipboard contents cannot cross", async () => {
    const calls: string[] = [];
    const target = createTarget(calls);
    const waits = createWaitQueue();
    const controller = createRemoteDesktopPasteController({
      getTarget: () => target,
      wait: waits.wait,
    });

    expect(controller.enqueue("first")).toBe(true);
    expect(controller.enqueue("두 번째")).toBe(true);
    expect(calls).toEqual(["blur", "clipboard:first", "focus"]);
    expect(waits.waits.map(({ milliseconds }) => milliseconds)).toEqual([
      remoteDesktopClipboardSyncDelayMs,
    ]);

    waits.resolveNext();
    await Promise.resolve();
    expect(calls).toContain("key:65379:Insert:true");
    expect(waits.waits.map(({ milliseconds }) => milliseconds)).toEqual([
      remoteDesktopPasteGapMs,
    ]);

    waits.resolveNext();
    await Promise.resolve();
    expect(calls.slice(-3)).toEqual([
      "blur",
      "clipboard:두 번째",
      "focus",
    ]);
    expect(waits.waits.map(({ milliseconds }) => milliseconds)).toEqual([
      remoteDesktopClipboardSyncDelayMs,
    ]);
  });

  it("cancels a queued paste when the remote connection is reset", async () => {
    const calls: string[] = [];
    const target = createTarget(calls);
    const waits = createWaitQueue();
    const controller = createRemoteDesktopPasteController({
      getTarget: () => target,
      wait: waits.wait,
    });

    controller.enqueue("do not send after reset");
    controller.reset();
    waits.resolveNext();
    await Promise.resolve();

    expect(calls).toEqual([
      "blur",
      "clipboard:do not send after reset",
      "focus",
    ]);
    expect(controller.enqueue("")).toBe(false);
  });
});
