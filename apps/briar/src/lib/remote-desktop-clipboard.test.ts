/** @vitest-environment jsdom */

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRemoteDesktopClipboardController,
  writeLocalClipboardText,
} from "./remote-desktop-clipboard";

class RemoteClipboard extends EventTarget {
  viewOnly = false;

  copy(text: string) {
    this.dispatchEvent(new CustomEvent("clipboard", { detail: { text } }));
  }
}

function createWriter() {
  const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue();
  const onStateChange = vi.fn();
  const controller = createRemoteDesktopClipboardController({ writeText, onStateChange });
  const remote = new RemoteClipboard();
  controller.bind(remote);
  return { controller, remote, writeText, onStateChange };
}

afterEach(() => {
  clearMocks();
  vi.unstubAllGlobals();
  delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
});

describe("remote desktop clipboard", () => {
  it("automatically copies Unicode and multiline text without changing it", async () => {
    const { remote, writeText, onStateChange } = createWriter();
    remote.copy("  한글 🐈\nsecond line\t ");
    expect(writeText).toHaveBeenCalledWith("  한글 🐈\nsecond line\t ");
    await Promise.resolve();
    expect(onStateChange).toHaveBeenLastCalledWith("copied");
  });

  it("keeps blocked text for a synchronous write on a retry click", async () => {
    const { controller, remote, writeText, onStateChange } = createWriter();
    writeText.mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"));
    remote.copy("retry this");
    await Promise.resolve();
    expect(onStateChange).toHaveBeenLastCalledWith("blocked");
    controller.copyToLocal();
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(writeText).toHaveBeenLastCalledWith("retry this");
    await Promise.resolve();
    expect(onStateChange).toHaveBeenLastCalledWith("copied");
  });

  it("finishes older writes before writing the latest copied text", async () => {
    const { remote, writeText, onStateChange } = createWriter();
    const firstWrite = Promise.withResolvers<void>();
    writeText.mockReturnValueOnce(firstWrite.promise);
    remote.copy("first");
    remote.copy("second");
    remote.copy("latest");
    expect(writeText).toHaveBeenCalledTimes(1);
    firstWrite.resolve();
    await firstWrite.promise;
    await Promise.resolve();
    expect(writeText.mock.calls).toEqual([["first"], ["latest"]]);
    expect(onStateChange).toHaveBeenLastCalledWith("copied");
  });

  it("discards queued copies and old events on disconnect", async () => {
    const { controller, remote, writeText, onStateChange } = createWriter();
    const firstWrite = Promise.withResolvers<void>();
    writeText.mockReturnValueOnce(firstWrite.promise);
    remote.copy("in flight");
    remote.copy("queued");
    remote.dispatchEvent(new Event("disconnect"));
    remote.copy("after disconnect");
    controller.copyToLocal();
    firstWrite.resolve();
    await firstWrite.promise;
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenLastCalledWith("empty");
  });

  it("ignores the old connection after reconnecting during a write", async () => {
    const { controller, remote, writeText, onStateChange } = createWriter();
    const oldWrite = Promise.withResolvers<void>();
    writeText.mockReturnValueOnce(oldWrite.promise);
    remote.copy("old session");
    const next = new RemoteClipboard();
    controller.bind(next);
    remote.copy("stale event");
    next.copy("new session");
    oldWrite.resolve();
    await oldWrite.promise;
    await Promise.resolve();
    expect(writeText.mock.calls).toEqual([["old session"], ["new session"]]);
    expect(onStateChange).toHaveBeenLastCalledWith("copied");
  });

  it("does not copy from a preview or clear the local clipboard", async () => {
    const { controller, remote, writeText, onStateChange } = createWriter();
    remote.viewOnly = true;
    remote.copy("preview");
    expect(writeText).not.toHaveBeenCalled();
    remote.viewOnly = false;
    remote.copy("explicit copy");
    await Promise.resolve();
    remote.copy("");
    controller.copyToLocal();
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenLastCalledWith("empty");
  });

  it("drops a queued copy when the screen returns to preview mode", async () => {
    const { remote, writeText, onStateChange } = createWriter();
    const firstWrite = Promise.withResolvers<void>();
    writeText.mockReturnValueOnce(firstWrite.promise);
    remote.copy("first");
    remote.copy("queued");
    remote.viewOnly = true;
    firstWrite.resolve();
    await firstWrite.promise;
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(onStateChange).toHaveBeenLastCalledWith("empty");
    remote.viewOnly = false;
    remote.copy("expanded again");
    await Promise.resolve();
    expect(writeText).toHaveBeenLastCalledWith("expanded again");
    expect(onStateChange).toHaveBeenLastCalledWith("copied");
  });
});

describe("local clipboard writer", () => {
  it("uses the browser clipboard on the web", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { userAgent: "Macintosh", clipboard: { writeText } });
    await writeLocalClipboardText("web text");
    expect(writeText).toHaveBeenCalledWith("web text");
  });

  it("uses the native clipboard in the desktop app", async () => {
    const invoke = vi.fn().mockResolvedValue(undefined);
    mockIPC(invoke);
    vi.stubGlobal("navigator", { userAgent: "Macintosh" });
    await writeLocalClipboardText("native text");
    expect(invoke).toHaveBeenCalledWith("plugin:clipboard-manager|write_text", {
      text: "native text",
    });
  });

  it("reports an unavailable browser clipboard as a failed write", async () => {
    vi.stubGlobal("navigator", { userAgent: "Macintosh" });
    await expect(writeLocalClipboardText("text")).rejects.toThrow();
  });
});
