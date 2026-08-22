import type { NormalizedAgentEvent } from "../src-agent/normalized-agent-event";
import { naturalLanguageFromAgentMessage } from "../src/lib/auto-hunt-agent";
import {
  CHANNEL_AGENT_ACTIVITY_HEADLINE_MAX_LENGTH,
  type ChannelAgentActivityDescriptor,
  type ChannelAgentActivityPublishInput,
} from "../src/lib/channel-agent-activity";

export type ChannelActivityCredential = {
  token: string;
  expiresAt: string;
};

type ChannelActivityPublisherOptions = {
  credential: ChannelActivityCredential | null;
  send: (
    credential: ChannelActivityCredential,
    input: ChannelAgentActivityPublishInput,
  ) => Promise<void>;
  onError?: (error: unknown) => void;
  now?: () => number;
  minIntervalMs?: number;
  heartbeatIntervalMs?: number;
};

export const CHANNEL_ACTIVITY_MIN_INTERVAL_MS = 750;
export const CHANNEL_ACTIVITY_HEARTBEAT_INTERVAL_MS = 10_000;

const defaultHeadline: Record<ChannelAgentActivityDescriptor["kind"], string> = {
  message: "Working on a reply",
  command: "Running a command",
  fileChange: "Updating files",
  webSearch: "Searching the web",
  tool: "Using a tool",
};

const sensitiveAssignment = /\b((?:[A-Z][A-Z0-9_]*_)?(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY))\s*=\s*(?:"[^"]*"|'[^']*'|\S+)/giu;
const bearerCredential = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu;
const commonSecret = /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,})\b/gu;

export function safeChannelActivityHeadline(
  kind: ChannelAgentActivityDescriptor["kind"],
  title: string,
) {
  const sanitized = title
    .replace(sensitiveAssignment, "$1=[redacted]")
    .replace(bearerCredential, "Bearer [redacted]")
    .replace(commonSecret, "[redacted]")
    .replace(/\s+/gu, " ")
    .trim();
  if (!sanitized) return defaultHeadline[kind];
  if (sanitized.length <= CHANNEL_AGENT_ACTIVITY_HEADLINE_MAX_LENGTH) {
    return sanitized;
  }
  return sanitized
    .slice(0, CHANNEL_AGENT_ACTIVITY_HEADLINE_MAX_LENGTH)
    .replace(/[\uD800-\uDBFF]$/u, "");
}

function normalizedEventFromPayload(payload: unknown): NormalizedAgentEvent | null {
  if (!payload || typeof payload !== "object") return null;
  const event = Reflect.get(payload, "event");
  if (!event || typeof event !== "object") return null;
  const type = Reflect.get(event, "type");
  if (type === "messageStarted" || type === "messageCompleted") {
    const id = Reflect.get(event, "id");
    const phase = Reflect.get(event, "phase");
    const text = Reflect.get(event, "text");
    if (
      typeof id !== "string" || phase !== "commentary" ||
      typeof text !== "string" || !text.trim()
    ) return null;
  } else if (type === "activityStarted") {
    const id = Reflect.get(event, "id");
    const kind = Reflect.get(event, "kind");
    const title = Reflect.get(event, "title");
    if (
      typeof id !== "string" || typeof title !== "string" ||
      (kind !== "command" && kind !== "fileChange" &&
        kind !== "webSearch" && kind !== "tool")
    ) return null;
  } else if (type === "activityCompleted") {
    if (typeof Reflect.get(event, "id") !== "string") return null;
  } else if (type !== "turnCompleted") {
    return null;
  }
  return event as NormalizedAgentEvent;
}

/**
 * Projects noisy provider output into one latest activity snapshot. Publishing
 * never backpressures provider stdout: while one request is in flight, newer
 * state replaces older pending state.
 */
export class ChannelActivityPublisher {
  private readonly active = new Map<string, ChannelAgentActivityDescriptor>();
  private commentary: ChannelAgentActivityDescriptor | null = null;
  private readonly now: () => number;
  private readonly minIntervalMs: number;
  private readonly heartbeatIntervalMs: number;
  private credential: ChannelActivityCredential | null;
  private pending: ChannelAgentActivityDescriptor | null | undefined;
  private sequence = 0;
  private lastSentAt = Number.NEGATIVE_INFINITY;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;
  private stopped = false;

  constructor(private readonly options: ChannelActivityPublisherOptions) {
    this.credential = options.credential;
    this.now = options.now ?? Date.now;
    this.minIntervalMs = options.minIntervalMs ?? CHANNEL_ACTIVITY_MIN_INTERVAL_MS;
    this.heartbeatIntervalMs =
      options.heartbeatIntervalMs ?? CHANNEL_ACTIVITY_HEARTBEAT_INTERVAL_MS;
  }

  updateCredential(credential: ChannelActivityCredential | null) {
    this.credential = credential;
    if (credential && this.pending !== undefined && !this.stopped) {
      this.queue(this.pending);
    }
  }

  observePayload(payload: unknown) {
    if (this.stopped) return;
    const event = normalizedEventFromPayload(payload);
    if (!event) return;
    if (event.type === "messageStarted" || event.type === "messageCompleted") {
      this.commentary = {
        id: event.id,
        kind: "message",
        headline: safeChannelActivityHeadline(
          "message",
          naturalLanguageFromAgentMessage(event.text),
        ),
      };
    } else if (event.type === "activityStarted") {
      this.active.delete(event.id);
      this.active.set(event.id, {
        id: event.id,
        kind: event.kind,
        headline: safeChannelActivityHeadline(event.kind, event.title),
      });
    } else if (event.type === "activityCompleted") {
      this.active.delete(event.id);
    } else {
      this.active.clear();
      this.commentary = null;
    }
    this.queue(this.latest());
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.timer = null;
    this.heartbeat = null;
    this.pending = undefined;
    this.active.clear();
    this.commentary = null;
  }

  private latest() {
    return [...this.active.values()].at(-1) ?? this.commentary;
  }

  private queue(activity: ChannelAgentActivityDescriptor | null) {
    this.pending = activity;
    if (!this.credential) return;
    this.scheduleHeartbeat(activity);
    if (this.inFlight || this.timer) return;
    const delay = Math.max(0, this.minIntervalMs - (this.now() - this.lastSentAt));
    if (delay === 0) {
      this.dispatch();
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.dispatch();
    }, delay);
    this.timer.unref?.();
  }

  private scheduleHeartbeat(activity: ChannelAgentActivityDescriptor | null) {
    if (this.heartbeat) clearTimeout(this.heartbeat);
    this.heartbeat = null;
    if (!activity || this.stopped) return;
    this.heartbeat = setTimeout(() => {
      this.heartbeat = null;
      if (!this.stopped) this.queue(this.latest());
    }, this.heartbeatIntervalMs);
    this.heartbeat.unref?.();
  }

  private dispatch() {
    if (this.inFlight || this.pending === undefined || this.stopped) return;
    const credential = this.credential;
    if (!credential || Date.parse(credential.expiresAt) <= this.now()) return;
    const activity = this.pending;
    this.pending = undefined;
    this.inFlight = true;
    this.lastSentAt = this.now();
    const input: ChannelAgentActivityPublishInput = {
      sequence: ++this.sequence,
      activity,
    };
    void Promise.resolve()
      .then(() => this.options.send(credential, input))
      .catch((error) => {
        try {
          this.options.onError?.(error);
        } catch {
          // Activity telemetry must never fail the claimed reply.
        }
      })
      .finally(() => {
        this.inFlight = false;
        if (this.pending !== undefined) this.queue(this.pending);
      });
  }
}
