import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import {
  decodeRealtimeNotificationJson,
  decodeWebSocketTicket,
} from "./realtime-protocol";

describe("realtime protocol", () => {
  it("decodes each notification variant", () => {
    const encoded = [
      '{"topic":"ready"}',
      '{"topic":"channels","cursor":1}',
      '{"topic":"inbox","version":2}',
      '{"topic":"project","projectId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","cursor":3}',
      '{"topic":"project-session","projectId":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","version":4}',
    ];

    expect(
      encoded.map((value) => decodeRealtimeNotificationJson(value)).every(
        Option.isSome,
      ),
    )
      .toBe(true);
  });

  it.each([
    "not-json",
    '{"topic":"channels","cursor":-1}',
    '{"topic":"channels","cursor":9007199254740992}',
    '{"topic":"inbox","version":1.5}',
    '{"topic":"project","projectId":"not a project id","cursor":1}',
  ])("rejects an invalid notification: %s", (encoded) => {
    expect(Option.isNone(decodeRealtimeNotificationJson(encoded))).toBe(true);
  });

  it("canonicalizes notifications while tolerating future fields", () => {
    expect(
      Option.getOrUndefined(
        decodeRealtimeNotificationJson(
          '{"topic":"ready","unexpected":true}',
        ),
      ),
    ).toEqual({ topic: "ready" });
  });

  it("validates WebSocket ticket payloads", () => {
    expect(
      Option.getOrUndefined(decodeWebSocketTicket({
        url: "wss://api.test/realtime?ticket=signed",
        expiresAt: "2026-08-20T00:00:00.000Z",
      })),
    ).toEqual({
      url: "wss://api.test/realtime?ticket=signed",
    });
    expect(Option.isNone(decodeWebSocketTicket({ url: "https://api.test" })))
      .toBe(true);
  });
});
