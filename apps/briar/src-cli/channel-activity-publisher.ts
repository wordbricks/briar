import type { RunnerToParent } from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import {
  AgentActivityKind,
  type NormalizedAgentEvent,
} from "@briar/contracts/gen/briar/types/v1/agent_event_pb";
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

const defaultHeadline = {
  message: "Working on a reply",
  command: "Running a command",
  fileChange: "Updating files",
  webSearch: "Searching the web",
  tool: "Using a tool",
} satisfies Record<ChannelAgentActivityDescriptor["kind"], string>;

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

function normalizedEventFromPayload(
  payload: RunnerToParent,
): NormalizedAgentEvent | null {
  return payload.payload.case === "event"
    ? payload.payload.value.normalized ?? null
    : null;
}

function channelActivityKind(
  kind: AgentActivityKind,
): ChannelAgentActivityDescriptor["kind"] | null {
  switch (kind) {
    case AgentActivityKind.COMMAND:
      return "command";
    case AgentActivityKind.FILE_CHANGE:
      return "fileChange";
    case AgentActivityKind.WEB_SEARCH:
      return "webSearch";
    case AgentActivityKind.TOOL:
      return "tool";
    default:
      return null;
  }
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

  observePayload(payload: RunnerToParent) {
    if (this.stopped) return;
    const event = normalizedEventFromPayload(payload);
    if (!event) return;
    const normalized = event.event;
    if (
      normalized.case === "messageStarted" ||
      normalized.case === "messageCompleted"
    ) {
      if (
        normalized.value.phase !== "commentary" ||
        !normalized.value.text.trim()
      ) return;
      this.commentary = {
        id: normalized.value.id,
        kind: "message",
        headline: safeChannelActivityHeadline(
          "message",
          naturalLanguageFromAgentMessage(normalized.value.text),
        ),
      };
    } else if (normalized.case === "activityStarted") {
      const kind = channelActivityKind(normalized.value.kind);
      if (!kind) return;
      this.active.delete(normalized.value.id);
      this.active.set(normalized.value.id, {
        id: normalized.value.id,
        kind,
        headline: safeChannelActivityHeadline(kind, normalized.value.title),
      });
    } else if (normalized.case === "activityCompleted") {
      this.active.delete(normalized.value.id);
    } else if (normalized.case === "turnCompleted") {
      this.active.clear();
      this.commentary = null;
    } else {
      return;
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
