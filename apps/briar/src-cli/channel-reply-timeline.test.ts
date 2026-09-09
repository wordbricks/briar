import { describe, expect, it } from "vitest";
import {
  ChannelReplyTimeline,
  channelReplyTriggerCreatedAt,
  deferChannelReplyTimelineOutcome,
  settleChannelReplyTimelineOutcome,
  type ChannelReplyTimelineClock,
} from "./channel-reply-timeline";

/** A clock the test moves by hand, so every duration below is exact. */
const stoppedClock = () => {
  const state = { elapsed: 0, wall: Date.parse("2026-09-10T02:14:05.000Z") };
  const clock: ChannelReplyTimelineClock = {
    elapsed: () => state.elapsed,
    wall: () => state.wall,
  };
  return {
    clock,
    advance: (milliseconds: number) => {
      state.elapsed += milliseconds;
      state.wall += milliseconds;
    },
  };
};

const timeline = (
  input: { workId?: string; triggerCreatedAt?: number | null } = {},
) => {
  const lines: string[] = [];
  const { clock, advance } = stoppedClock();
  const record = new ChannelReplyTimeline({
    workId: input.workId ?? "work-1",
    triggerCreatedAt: input.triggerCreatedAt === undefined
      ? Date.parse("2026-09-10T02:14:00.000Z")
      : input.triggerCreatedAt,
    clock,
    log: (line) => lines.push(line),
  });
  const printed = () =>
    lines.flatMap((line) =>
      line.startsWith("channel reply timeline: ")
        ? [JSON.parse(line.slice("channel reply timeline: ".length))]
        : []
    );
  return { record, advance, lines, printed };
};

describe("channel reply timeline", () => {
  it("accounts for every stretch of a completed reply", () => {
    const test = timeline();
    test.record.recordAcknowledgementMode("placeholder");
    test.advance(400);
    test.record.recordAcknowledgementPublished();
    test.record.recordWorkspace("none");
    test.advance(2_600);
    test.record.recordSetup({
      totalMs: 3_000,
      bootMs: 1_200,
      steerFolded: true,
      memoryBrief: "loaded",
      prewarm: "used",
    });
    test.record.startTurn();
    test.advance(9_000);
    test.record.endTurn("reply");
    test.advance(700);
    test.record.recordCompletion("completed");
    test.advance(50);
    test.record.finish(test.record.outcomeWhenCompleted());

    expect(test.printed()).toEqual([{
      workId: "work-1",
      // The person sent the message five seconds before the claim.
      triggerToClaim: 5_000,
      claimToAck: 400,
      setup: 3_000,
      firstTurnBoot: 1_200,
      turns: [{ round: 1, ms: 9_000, result: "reply" }],
      post: 700,
      total: 12_750,
      triggerToReply: 17_700,
      outcome: "completed",
      steerFolded: true,
      prewarm: "used",
      memoryBrief: "loaded",
      workspace: "none",
      acknowledgement: "placeholder",
    }]);
  });

  it("omits what it never measured rather than reporting zero", () => {
    const test = timeline({ triggerCreatedAt: null });
    test.advance(120);
    test.record.finish("failed");

    expect(test.printed()).toEqual([{
      workId: "work-1",
      turns: [],
      total: 120,
      outcome: "failed",
      acknowledgement: "none",
    }]);
  });

  it("blames the round that was still open when the reply broke", () => {
    const test = timeline();
    test.record.startTurn();
    test.advance(4_000);
    test.record.endTurn("repair");
    test.record.startTurn();
    test.advance(2_500);
    test.record.finish("failed");

    expect(test.printed()[0]!.turns).toEqual([
      { round: 1, ms: 4_000, result: "repair" },
      { round: 2, ms: 2_500, result: "failed" },
    ]);
  });

  it("prints once, whatever else asks it to", () => {
    const test = timeline();
    test.record.finish("completed");
    test.record.finish("failed");
    test.record.settle("steered");

    expect(test.printed()).toHaveLength(1);
    expect(test.printed()[0]!.outcome).toBe("completed");
  });

  /*
    The Worker command knows a steer only after the reply's cleanup. It says so
    before the reply runs, and the line then carries its verdict instead of the
    failure the reply saw.
  */
  it("waits for a registered caller's verdict", () => {
    const test = timeline({ workId: "deferred-work" });
    deferChannelReplyTimelineOutcome("deferred-work");
    test.advance(90);
    test.record.finish("failed");
    expect(test.printed()).toEqual([]);

    // The total is the reply's own end, not the moment the verdict arrived.
    test.advance(5_000);
    settleChannelReplyTimelineOutcome("deferred-work", "steered");
    expect(test.printed()).toMatchObject([{ outcome: "steered", total: 90 }]);
  });

  it("keeps the reply's own outcome when the verdict adds nothing", () => {
    const test = timeline({ workId: "kept-work" });
    deferChannelReplyTimelineOutcome("kept-work");
    test.record.finish("handed_off");
    settleChannelReplyTimelineOutcome("kept-work", null);

    expect(test.printed()).toMatchObject([{ outcome: "handed_off" }]);
  });

  it("reads the trigger time out of the claim's own snapshot", () => {
    expect(channelReplyTriggerCreatedAt({
      messages: [
        { id: "other", createdAt: "2026-09-10T02:13:00.000Z" },
        { id: "trigger", createdAt: "2026-09-10T02:14:00.000Z" },
      ],
    }, "trigger")).toBe(Date.parse("2026-09-10T02:14:00.000Z"));
    // An untrusted snapshot that says nothing usable measures nothing.
    expect(channelReplyTriggerCreatedAt({ messages: [] }, "trigger")).toBeNull();
    expect(channelReplyTriggerCreatedAt(
      { messages: [{ id: "trigger", createdAt: 17 }] },
      "trigger",
    )).toBeNull();
    expect(channelReplyTriggerCreatedAt(
      { messages: [{ id: "trigger", createdAt: "not a time" }] },
      "trigger",
    )).toBeNull();
    expect(channelReplyTriggerCreatedAt("not a snapshot", "trigger")).toBeNull();
  });

  it("says nothing about a trigger the Worker's clock places in the future", () => {
    const test = timeline({
      triggerCreatedAt: Date.parse("2026-09-10T02:14:30.000Z"),
    });
    test.record.finish("completed");

    expect(test.printed()[0]).not.toHaveProperty("triggerToClaim");
  });
});
