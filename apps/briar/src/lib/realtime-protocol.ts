import * as Schema from "effect/Schema";

const Revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

const ProjectId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f-]+$/iu),
);

const ReadyNotification = Schema.Struct({
  topic: Schema.Literal("ready"),
});

const ChannelsNotification = Schema.Struct({
  topic: Schema.Literal("channels"),
  cursor: Revision,
});

const InboxNotification = Schema.Struct({
  topic: Schema.Literal("inbox"),
  version: Revision,
});

const ProjectNotification = Schema.Struct({
  topic: Schema.Literal("project"),
  projectId: ProjectId,
  cursor: Revision,
});

const ProjectSessionNotification = Schema.Struct({
  topic: Schema.Literal("project-session"),
  projectId: ProjectId,
  version: Revision,
});

export const RealtimeNotification = Schema.Union([
  ReadyNotification,
  ChannelsNotification,
  InboxNotification,
  ProjectNotification,
  ProjectSessionNotification,
]);

export type RealtimeNotification = typeof RealtimeNotification.Type;

const RealtimeNotificationJson = Schema.fromJsonString(RealtimeNotification);

export const decodeRealtimeNotificationJson = Schema.decodeUnknownOption(
  RealtimeNotificationJson,
);

const WebSocketUrl = Schema.String.check(
  Schema.isPattern(/^wss?:\/\//u),
);

const WebSocketTicket = Schema.Struct({
  url: WebSocketUrl,
});

export const decodeWebSocketTicket = Schema.decodeUnknownOption(WebSocketTicket);
