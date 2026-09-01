import {
  OrganizationNotificationSchema,
  ProjectAgentSessionsChangedSchema,
} from "@briar/contracts/gen/briar/realtime/v1/realtime_pb";
import { create, toBinary } from "@bufbuild/protobuf";
import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import {
  decodeRealtimeNotificationBinary,
} from "./realtime-protocol";

describe("realtime protocol", () => {
  it("decodes a generated protobuf oneof frame", () => {
    const message = create(OrganizationNotificationSchema, {
      notification: {
        case: "projectAgentSessionsChanged",
        value: create(ProjectAgentSessionsChangedSchema, {
          projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
          version: 4n,
        }),
      },
    });

    expect(Option.getOrUndefined(decodeRealtimeNotificationBinary(
      toBinary(OrganizationNotificationSchema, message),
    ))).toEqual({
      topic: "project-session",
      projectId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      version: 4,
    });
    expect(Option.isNone(decodeRealtimeNotificationBinary(new Uint8Array())))
      .toBe(true);
  });

});
