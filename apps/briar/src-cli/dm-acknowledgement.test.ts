import { afterEach, describe, expect, it, vi } from "vitest";
import { acknowledgementEmoji, dmAcknowledgementPrompt, startDmAcknowledgement } from "./dm-acknowledgement";

afterEach(() => vi.useRealTimers());

describe("early DM acknowledgement", () => {
  it("uses recent text and the trigger but excludes private and instruction metadata", () => {
    const snapshot = {
      channel: { kind: "dm" }, memory: "private",
      messages: [{ id: "1", author: { type: "agent" }, body: "Want to play?" },
        { id: "2", author: { type: "user" }, body: "yes!", secret: "hidden" }],
    };
    const prompt = dmAcknowledgementPrompt(snapshot, "2")!;
    expect(prompt).toContain("Want to play?");
    expect(prompt).toContain('"trigger":true');
    expect(prompt).not.toContain("hidden");
    expect(prompt).not.toContain("private");
    expect(dmAcknowledgementPrompt(snapshot, "1")).toBeNull();
    expect(dmAcknowledgementPrompt({ ...snapshot, channel: { kind: "channel" } }, "2")).toBeNull();
  });

  it.each([0, 9, 10, 19])("preserves trigger %i and conversation order in a 20-message snapshot", (triggerIndex) => {
    const messages = Array.from({ length: 20 }, (_, index) => ({
      id: String(index), author: { type: "user" }, body: `message ${index}`,
    }));
    const prompt = dmAcknowledgementPrompt({ channel: { kind: "dm" }, messages }, String(triggerIndex))!;
    const context = JSON.parse(prompt.split("\n\n").at(-1)!);
    const selected = messages.filter((_, index) => index === triggerIndex || index >= 10);
    expect(context).toEqual(selected.map((message) => ({
      trigger: message.id === String(triggerIndex), author: "user", body: message.body,
    })));
    expect(context.filter((message: { trigger: boolean }) => message.trigger)).toHaveLength(1);
    expect(context.length).toBeLessThanOrEqual(11);
  });

  it("publishes the placeholder first and the selected emoji as its replacement", async () => {
    const publish = vi.fn(async (_emoji: string, _signal: AbortSignal) => {});
    const refined: string[] = [];
    const stop = startDmAcknowledgement({ select: async () => '{"emoji":"🎮"}', publish,
      signal: new AbortController().signal, onRefined: (emoji) => refined.push(emoji) });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    expect(publish.mock.calls.map((call) => call[0])).toEqual(["👀", "🎮"]);
    expect(refined).toEqual(["🎮"]);
    stop();
  });

  it("holds the replacement until the placeholder publication has settled", async () => {
    const published: string[] = [];
    let releasePlaceholder!: () => void;
    const publish = vi.fn((emoji: string) => emoji === "👀"
      ? new Promise<void>((done) => { releasePlaceholder = () => done(); })
      : Promise.resolve(published.push(emoji)).then(() => undefined));
    const stop = startDmAcknowledgement({ select: async () => '{"emoji":"🎮"}', publish,
      signal: new AbortController().signal });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    // The selection is already done; the replacement waits for the slow one.
    await Promise.resolve();
    expect(published).toEqual([]);
    releasePlaceholder();
    await vi.waitFor(() => expect(published).toEqual(["🎮"]));
    stop();
  });

  it("leaves the placeholder in place on timeout and ignores late success", async () => {
    vi.useFakeTimers();
    let resolve!: (value: string) => void;
    const publish = vi.fn(async (_emoji: string, _signal: AbortSignal) => {});
    const stop = startDmAcknowledgement({
      select: () => new Promise((done) => { resolve = done; }), publish,
      signal: new AbortController().signal, timeoutMs: 50,
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(publish.mock.calls[0]?.[0]).toBe("👀");
    await vi.advanceTimersByTimeAsync(50);
    resolve('{"emoji":"🎉"}');
    await vi.advanceTimersByTimeAsync(1);
    expect(publish).toHaveBeenCalledTimes(1);
    stop();
  });

  it("publishes nothing beyond the placeholder when selection fails", async () => {
    const publish = vi.fn(async (_emoji: string, _signal: AbortSignal) => {});
    const stop = startDmAcknowledgement({ select: async () => { throw new Error("model"); },
      publish, signal: new AbortController().signal });
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0]?.[0]).toBe("👀");
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
    stop();
  });

  it("contains publication errors and drops a result that arrives after shutdown", async () => {
    const errors: unknown[] = [];
    const failing = vi.fn(async () => { throw new Error("offline"); });
    const stop = startDmAcknowledgement({ select: async () => '{"emoji":"🎉"}',
      publish: failing, signal: new AbortController().signal,
      onError: (error) => errors.push(error) });
    // The placeholder and its replacement both fail; neither escapes.
    await vi.waitFor(() => expect(errors).toHaveLength(2));
    expect(failing).toHaveBeenCalledTimes(2);
    stop();
    let selected!: (value: string) => void;
    const cancelled = vi.fn(async () => {});
    const cancel = startDmAcknowledgement({
      select: () => new Promise((done) => { selected = done; }),
      publish: cancelled, signal: new AbortController().signal });
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledTimes(1));
    cancel();
    selected('{"emoji":"🎉"}');
    await Promise.resolve();
    await Promise.resolve();
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it.each([null, "invalid", '{"emoji":"🎉🙏"}', '{"emoji":" 🎮 "}'])("uses fallback for %s", (value) => {
    expect(acknowledgementEmoji(value)).toBe("👀");
  });
});
