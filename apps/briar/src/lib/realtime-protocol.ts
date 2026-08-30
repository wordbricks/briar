import {
  type OrganizationNotification,
  OrganizationNotificationSchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { fromBinary } from "@bufbuild/protobuf";
import * as Option from "effect/Option";

/**
 * UI-facing projection of the generated protobuf oneof. The protobuf message
 * remains the wire contract; this union only converts uint64 revisions to the
 * number-based cursors used by the app's existing stores.
 */
export type RealtimeNotification =
  | { readonly topic: "ready" }
  | { readonly topic: "channels"; readonly cursor: number }
  | { readonly topic: "inbox"; readonly version: number }
  | {
      readonly topic: "project";
      readonly projectId: string;
      readonly cursor: number;
    }
  | {
      readonly topic: "project-session";
      readonly projectId: string;
      readonly version: number;
    };

const decodeOrganizationNotification = Option.liftThrowable(
  (bytes: Uint8Array) => fromBinary(OrganizationNotificationSchema, bytes),
);

const safeRevision = (revision: bigint) =>
  revision <= BigInt(Number.MAX_SAFE_INTEGER)
    ? Option.some(Number(revision))
    : Option.none<number>();

const impossibleNotification = (notification: never): never => {
  throw new Error(`Unhandled realtime notification: ${String(notification)}`);
};

const toRealtimeNotification = (
  message: OrganizationNotification,
): Option.Option<RealtimeNotification> => {
  const notification = message.notification;
  switch (notification.case) {
    case "ready":
      return Option.some({ topic: "ready" });
    case "channelsChanged":
      return Option.map(safeRevision(notification.value.cursor), (cursor) => ({
        topic: "channels" as const,
        cursor,
      }));
    case "inboxChanged":
      return Option.map(safeRevision(notification.value.version), (version) => ({
        topic: "inbox" as const,
        version,
      }));
    case "projectChanged":
      if (notification.value.projectId.length === 0) return Option.none();
      return Option.map(safeRevision(notification.value.cursor), (cursor) => ({
        topic: "project" as const,
        projectId: notification.value.projectId,
        cursor,
      }));
    case "projectAgentSessionsChanged":
      if (notification.value.projectId.length === 0) return Option.none();
      return Option.map(safeRevision(notification.value.version), (version) => ({
        topic: "project-session" as const,
        projectId: notification.value.projectId,
        version,
      }));
    case undefined:
      return Option.none();
  }
  return impossibleNotification(notification);
};

export const decodeRealtimeNotificationBinary = (bytes: Uint8Array) =>
  Option.flatMap(decodeOrganizationNotification(bytes), toRealtimeNotification);
