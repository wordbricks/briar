/**
 * One line per channel reply, for the question the Worker log could not answer:
 * where did the two minutes go?
 *
 * `channel reply setup:` (#1835) already accounts for the claim → first
 * provider turn stretch. This carries the same numbers — literally the same
 * record, so the two lines can never disagree — plus what the reply spends
 * before the claim, in each provider round, and after the last one.
 *
 * Every duration is milliseconds. A stretch this reply never had is absent
 * rather than zero: a plain DM has no `firstTurnBoot` when its provider never
 * accepted a thread, and a snapshot without message timestamps has no
 * `triggerToClaim`.
 */

export type ChannelReplyTimelineOutcome =
  /** The server accepted the answer. */
  | "completed"
  /** The failure report made the job claimable again. */
  | "requeued"
  /** The failure report ended the job. */
  | "failed"
  /** A steer was acknowledged; the same work id is claimed again. */
  | "steered"
  /** A planned Worker update took the claim mid-reply. */
  | "handed_off";

/** What ended one provider round. `failed` is a round that threw. */
export type ChannelReplyTurnResult =
  | "reply"
  | "memory"
  | "repository"
  | "context"
  | "repair"
  | "failed";

/** The account `channel reply setup:` prints, kept so both lines share it. */
export type ChannelReplySetupAccount = {
  /** Claim → the first provider turn is running. */
  totalMs: number;
  /** `turn.started` → the provider accepted this turn's thread. */
  bootMs: number | null;
  steerFolded: boolean;
  memoryBrief: "loaded" | "unavailable" | null;
  prewarm: string;
};

export type ChannelReplyTimelineClock = {
  /** Monotonic milliseconds; only differences are ever read. */
  elapsed: () => number;
  /** Wall-clock milliseconds, for the gap to the message the person sent. */
  wall: () => number;
};

const defaultClock: ChannelReplyTimelineClock = {
  elapsed: () => performance.now(),
  wall: () => Date.now(),
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;

/**
 * When the person sent the message this reply answers, from the claim's own
 * untrusted snapshot. Absent, unparseable or non-string means the reply says
 * nothing about the wait instead of inventing one.
 */
export function channelReplyTriggerCreatedAt(
  snapshot: unknown,
  triggerMessageId: string,
): number | null {
  const messages = record(snapshot)?.messages;
  if (!Array.isArray(messages)) return null;
  const trigger = messages
    .map(record)
    .find((message) => message?.id === triggerMessageId);
  const createdAt = trigger?.createdAt;
  if (typeof createdAt !== "string") return null;
  const parsed = Date.parse(createdAt);
  return Number.isNaN(parsed) ? null : parsed;
}

type TurnRecord = {
  round: number;
  startedAt: number;
  ms: number | null;
  result: ChannelReplyTurnResult | null;
};

/*
  Only the Worker command can tell a steer from a failure: it asks the server
  after the reply has stopped its provider and finished its cleanup. A caller
  that will answer that question says so first, and the line then waits for the
  verdict instead of guessing. Nothing else defers: a reply run directly — a
  test, or any caller that does not register — prints from its own `finally`.
*/
const deferredWorkIds = new Set<string>();
const awaitingOutcome = new Map<string, ChannelReplyTimeline>();

export function deferChannelReplyTimelineOutcome(workId: string): void {
  deferredWorkIds.add(workId);
}

/**
 * Print the deferred line. `null` keeps the outcome the reply itself recorded,
 * which is what every path but a steer wants; a caller that registered must
 * call this exactly once, from a `finally`, so no reply loses its line.
 */
export function settleChannelReplyTimelineOutcome(
  workId: string,
  outcome: ChannelReplyTimelineOutcome | null,
): void {
  deferredWorkIds.delete(workId);
  const timeline = awaitingOutcome.get(workId);
  awaitingOutcome.delete(workId);
  timeline?.settle(outcome);
}

export class ChannelReplyTimeline {
  private readonly clock: ChannelReplyTimelineClock;
  private readonly log: (line: string) => void;
  private readonly workId: string;
  private acknowledgement = "none";
  /** Monotonic origin: the claim, as this Worker received it. */
  readonly claimedAt: number;
  private readonly triggerToClaimMs: number | null;
  private acknowledgedAt: number | null = null;
  private setup: ChannelReplySetupAccount | null = null;
  private workspace: string | null = null;
  private readonly turns: TurnRecord[] = [];
  private lastTurnEndedAt: number | null = null;
  private completedAt: number | null = null;
  private completionOutcome: ChannelReplyTimelineOutcome | null = null;
  private finishedAt: number | null = null;
  private fallbackOutcome: ChannelReplyTimelineOutcome = "failed";
  private printed = false;

  constructor(input: {
    workId: string;
    /** The claim snapshot's trigger message time, in wall-clock milliseconds. */
    triggerCreatedAt: number | null;
    clock?: ChannelReplyTimelineClock;
    log?: (line: string) => void;
  }) {
    this.clock = input.clock ?? defaultClock;
    this.workId = input.workId;
    this.log = input.log ?? ((line) => console.log(line));
    this.claimedAt = this.clock.elapsed();
    const waited = input.triggerCreatedAt === null
      ? null
      : this.clock.wall() - input.triggerCreatedAt;
    // A negative wait is clock skew between the server and this Worker, not a
    // measurement: say nothing rather than something impossible.
    this.triggerToClaimMs = waited !== null && waited >= 0 ? waited : null;
  }

  /** Whether this claim reacts at all, and how: none, existing, placeholder. */
  recordAcknowledgementMode(mode: string): void {
    this.acknowledgement = mode;
  }

  /** The placeholder reaction reached the server. */
  recordAcknowledgementPublished(): void {
    this.acknowledgedAt ??= this.clock.elapsed();
  }

  /** The setup account, kept so `channel reply setup:` prints these numbers. */
  recordSetup(account: ChannelReplySetupAccount): ChannelReplySetupAccount {
    this.setup ??= account;
    return this.setup;
  }

  recordWorkspace(workspace: string): void {
    this.workspace = workspace;
  }

  startTurn(): void {
    this.turns.push({
      round: this.turns.length + 1,
      startedAt: this.clock.elapsed(),
      ms: null,
      result: null,
    });
  }

  /** What the round the provider just returned from turned out to be. */
  endTurn(result: ChannelReplyTurnResult): void {
    const turn = this.turns.at(-1);
    if (!turn || turn.result !== null) return;
    this.lastTurnEndedAt = this.clock.elapsed();
    turn.ms = this.lastTurnEndedAt - turn.startedAt;
    turn.result = result;
  }

  /** The completion RPC returned; `post` is the stretch since the last round. */
  recordCompletion(disposition: "completed" | "requeued" | "failed"): void {
    this.completedAt ??= this.clock.elapsed();
    this.completionOutcome ??= disposition;
  }

  /**
   * The reply ended. Prints unless a caller registered to answer the steer
   * question first, in which case `settle` prints the same frozen record.
   */
  finish(outcome: ChannelReplyTimelineOutcome): void {
    if (this.finishedAt !== null) return;
    this.finishedAt = this.clock.elapsed();
    this.fallbackOutcome = outcome;
    // A round still open when the reply ended is the round that broke it.
    const open = this.turns.at(-1);
    if (open && open.result === null) {
      this.lastTurnEndedAt = this.finishedAt;
      open.ms = this.finishedAt - open.startedAt;
      open.result = "failed";
    }
    if (deferredWorkIds.has(this.workId)) {
      awaitingOutcome.set(this.workId, this);
      return;
    }
    this.print(outcome);
  }

  /** Called by the registered caller; `null` keeps the reply's own outcome. */
  settle(outcome: ChannelReplyTimelineOutcome | null): void {
    if (this.finishedAt === null) return;
    this.print(outcome === null ? this.fallbackOutcome : outcome);
  }

  /** What the reply recorded for itself, when nothing refines it. */
  outcomeWhenCompleted(): ChannelReplyTimelineOutcome {
    return this.completionOutcome === null ? "completed" : this.completionOutcome;
  }

  private print(outcome: ChannelReplyTimelineOutcome): void {
    if (this.printed || this.finishedAt === null) return;
    this.printed = true;
    const setup = this.setup;
    // Settle, publish and complete: what the reply owed after its last round.
    const post = this.completedAt !== null && this.lastTurnEndedAt !== null
      ? this.completedAt - this.lastTurnEndedAt
      : null;
    const triggerToReply = this.triggerToClaimMs !== null && this.completedAt !== null
      ? this.triggerToClaimMs + (this.completedAt - this.claimedAt)
      : null;
    this.log(`channel reply timeline: ${JSON.stringify({
      workId: this.workId,
      ...optional("triggerToClaim", this.triggerToClaimMs),
      ...optional(
        "claimToAck",
        this.acknowledgedAt === null ? null : this.acknowledgedAt - this.claimedAt,
      ),
      ...optional("setup", setup === null ? null : setup.totalMs),
      ...optional("firstTurnBoot", setup === null ? null : setup.bootMs),
      turns: this.turns.flatMap((turn) =>
        turn.ms === null || turn.result === null ? [] : [{
          round: turn.round,
          ms: Math.round(turn.ms),
          result: turn.result,
        }]
      ),
      ...optional("post", post),
      total: Math.round(this.finishedAt - this.claimedAt),
      ...optional("triggerToReply", triggerToReply),
      outcome,
      ...(setup === null ? {} : {
        steerFolded: setup.steerFolded,
        prewarm: setup.prewarm,
        ...(setup.memoryBrief === null ? {} : { memoryBrief: setup.memoryBrief }),
      }),
      ...(this.workspace === null ? {} : { workspace: this.workspace }),
      acknowledgement: this.acknowledgement,
    })}`);
  }
}

/** Omit what was never measured; never report an unknown stretch as zero. */
const optional = (key: string, value: number | null) =>
  value === null ? {} : { [key]: Math.round(value) };
