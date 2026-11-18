import { describe, expect, it, vi } from "vitest";
import { dmAcknowledgementOwed, startDmAcknowledgement } from "./dm-acknowledgement";

describe("early DM acknowledgement", () => {
  const snapshot = {
    channel: { kind: "dm" },
    messages: [
      { id: "1", author: { type: "agent" }, body: "Want to play?" },
      { id: "2", author: { type: "user" }, body: "yes!" },
    ],
  };

  it("owes a reaction only on a person's own message in a direct message", () => {
    expect(dmAcknowledgementOwed(snapshot, "2")).toBe(true);
    expect(dmAcknowledgementOwed(snapshot, "1")).toBe(false);
    expect(dmAcknowledgementOwed(snapshot, "3")).toBe(false);
    expect(dmAcknowledgementOwed({ ...snapshot, channel: { kind: "channel" } }, "2"))
      .toBe(false);
    expect(dmAcknowledgementOwed({ channel: { kind: "dm" } }, "2")).toBe(false);
  });

  /*
    The contextual emoji is the server's, chosen at receipt. All this Worker
    owes is the placeholder that covers a server selection which failed, and it
    publishes exactly once — never a second, "refined" reaction.
  */
  it("publishes the placeholder once and nothing else", async () => {
    const published: string[] = [];
    const publish = vi.fn(async (emoji: string, _signal: AbortSignal) => {
      published.push(emoji);
    });
    const seen: string[] = [];
    const stop = startDmAcknowledgement({
      publish,
      signal: new AbortController().signal,
      onPlaceholderPublished: () => seen.push("published"),
    });
    await vi.waitFor(() => expect(seen).toEqual(["published"]));
    expect(published).toEqual(["👀"]);
    stop();
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("contains a publication failure instead of throwing it at the reply", async () => {
    const errors: unknown[] = [];
    const failing = vi.fn(async () => { throw new Error("offline"); });
    const stop = startDmAcknowledgement({
      publish: failing,
      signal: new AbortController().signal,
      onError: (error) => errors.push(error),
    });
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(failing).toHaveBeenCalledTimes(1);
    stop();
  });

  it("aborts a publication still in flight when the reply stops", async () => {
    let publishSignal!: AbortSignal;
    const publish = vi.fn((_emoji: string, signal: AbortSignal) => {
      publishSignal = signal;
      return new Promise<void>(() => {});
    });
    const stop = startDmAcknowledgement({
      publish,
      signal: new AbortController().signal,
    });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publishSignal.aborted).toBe(false);
    stop();
    expect(publishSignal.aborted).toBe(true);
  });
});
