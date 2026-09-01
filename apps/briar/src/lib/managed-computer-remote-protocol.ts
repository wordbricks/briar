import * as Schema from "effect/Schema";

export const managedComputerRemoteHeartbeatRequest =
  "briar.remote-agent.heartbeat.v1";
export const managedComputerRemoteHeartbeatResponse =
  "briar.remote-agent.heartbeat-ack.v1";

export const managedComputerRemoteHeartbeatIntervalMs = 20_000;
export const managedComputerRemoteHeartbeatTimeoutMs = 60_000;

const ManagedComputerRemoteSessionId = Schema.String.check(Schema.isUUID());

export const ManagedComputerRemoteDisplayErrorCode = Schema.Literals([
  "input_backpressure",
  "screen_backpressure",
  "display_closed",
  "display_connect_failed",
]);

const ManagedComputerRemoteControllerReadyFrame = Schema.Struct({
  type: Schema.Literal("controller_ready"),
  sessionId: ManagedComputerRemoteSessionId,
});
const ManagedComputerRemoteControllerEndedFrame = Schema.Struct({
  type: Schema.Literal("controller_ended"),
  sessionId: ManagedComputerRemoteSessionId,
});
const ManagedComputerRemoteDisplayErrorFrame = Schema.Struct({
  type: Schema.Literal("display_error"),
  sessionId: ManagedComputerRemoteSessionId,
  code: ManagedComputerRemoteDisplayErrorCode,
});

/**
 * The JSON control plane shared by the Worker relay and the remote display
 * agent. RFB frames remain binary and heartbeat frames remain plain strings.
 */
export const ManagedComputerRemoteControlFrame = Schema.Union([
  ManagedComputerRemoteControllerReadyFrame,
  ManagedComputerRemoteControllerEndedFrame,
  ManagedComputerRemoteDisplayErrorFrame,
]);
export const ManagedComputerRemoteRelayControlFrame = Schema.Union([
  ManagedComputerRemoteControllerReadyFrame,
  ManagedComputerRemoteControllerEndedFrame,
]);
export const ManagedComputerRemoteAgentControlFrame =
  ManagedComputerRemoteDisplayErrorFrame;

export type ManagedComputerRemoteControlFrame =
  typeof ManagedComputerRemoteControlFrame.Type;
export type ManagedComputerRemoteRelayControlFrame =
  typeof ManagedComputerRemoteRelayControlFrame.Type;
export type ManagedComputerRemoteAgentControlFrame =
  typeof ManagedComputerRemoteAgentControlFrame.Type;
export type ManagedComputerRemoteDisplayErrorCode =
  typeof ManagedComputerRemoteDisplayErrorCode.Type;

const strictControlFrameOptions = {
  errors: "all",
  onExcessProperty: "error",
} as const;
const ManagedComputerRemoteRelayControlFrameJson = Schema.fromJsonString(
  ManagedComputerRemoteRelayControlFrame,
);
const ManagedComputerRemoteAgentControlFrameJson = Schema.fromJsonString(
  ManagedComputerRemoteAgentControlFrame,
);

export const decodeManagedComputerRemoteRelayControlFrame =
  Schema.decodeUnknownSync(
    ManagedComputerRemoteRelayControlFrameJson,
    strictControlFrameOptions,
  );
export const encodeManagedComputerRemoteRelayControlFrame = Schema.encodeSync(
  ManagedComputerRemoteRelayControlFrameJson,
  strictControlFrameOptions,
);

export const decodeManagedComputerRemoteAgentControlFrame =
  Schema.decodeUnknownSync(
    ManagedComputerRemoteAgentControlFrameJson,
    strictControlFrameOptions,
  );
export const encodeManagedComputerRemoteAgentControlFrame = Schema.encodeSync(
  ManagedComputerRemoteAgentControlFrameJson,
  strictControlFrameOptions,
);
