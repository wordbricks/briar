import * as Option from "effect/Option";
import { describe, expect, it } from "vitest";
import {
  decodeChannelActivityPublishTokenPayloadJson,
  decodeChannelActivitySocketTicketPayloadJson,
  decodeIssueActivityPublishTokenPayloadJson,
  decodeIssueActivitySocketTicketPayloadJson,
} from "./channel-activity-ticket-payload";

const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const channelId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const replyJobId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const agentId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const triggerMessageId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const parentMessageId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";

const channelPublishPayload = {
  purpose: "publish",
  organizationId,
  channelId,
  replyJobId,
  agentId,
  triggerMessageId,
  parentMessageId,
  attempt: 1,
  workerId: "worker-a",
  deviceId: "device-a",
  expiresAt: 1,
  nonce: "nonce-a",
} as const;

const channelSocketPayload = {
  purpose: "subscribe",
  organizationId,
  channelId,
  userId: "user-a",
  expiresAt: 1,
  authorizationExpiresAt: 2,
  nonce: "nonce-a",
} as const;

const issuePublishPayload = {
  purpose: "publish-issue",
  organizationId,
  projectId,
  runId,
  replyJobId,
  triggerMessageId,
  parentMessageId,
  attempt: 1,
  workerId: "worker-a",
  deviceId: "device-a",
  expiresAt: 1,
  nonce: "nonce-a",
} as const;

const issueSocketPayload = {
  purpose: "subscribe-issue",
  organizationId,
  projectId,
  runId,
  userId: "user-a",
  expiresAt: 1,
  authorizationExpiresAt: 2,
  nonce: "nonce-a",
} as const;

const decodeJson = <A>(
  decoder: (input: unknown) => Option.Option<A>,
  payload: unknown,
) => decoder(JSON.stringify(payload));

describe("channel activity ticket payload schemas", () => {
  it("decodes all four signed payload variants", () => {
    expect(
      Option.getOrNull(
        decodeJson(
          decodeChannelActivityPublishTokenPayloadJson,
          channelPublishPayload,
        ),
      ),
    ).toEqual(channelPublishPayload);
    expect(
      Option.getOrNull(
        decodeJson(
          decodeChannelActivitySocketTicketPayloadJson,
          channelSocketPayload,
        ),
      ),
    ).toEqual(channelSocketPayload);
    expect(
      Option.getOrNull(
        decodeJson(
          decodeIssueActivityPublishTokenPayloadJson,
          issuePublishPayload,
        ),
      ),
    ).toEqual(issuePublishPayload);
    expect(
      Option.getOrNull(
        decodeJson(
          decodeIssueActivitySocketTicketPayloadJson,
          issueSocketPayload,
        ),
      ),
    ).toEqual(issueSocketPayload);
  });

  it("preserves additional signed claims", () => {
    const payload = { ...channelPublishPayload, futureClaim: "supported" };
    const decoded = Option.getOrNull(
      decodeJson(decodeChannelActivityPublishTokenPayloadJson, payload),
    );

    expect(decoded).toEqual(payload);
    expect(Object.keys(decoded ?? {})).toEqual(Object.keys(payload));
  });

  it("keeps the existing UUID version and casing semantics", () => {
    const acceptedIds = [
      "AAAAAAAA-AAAA-1AAA-8AAA-AAAAAAAAAAAA",
      "aaaaaaaa-aaaa-5aaa-baaa-aaaaaaaaaaaa",
    ];
    const rejectedIds = [
      "aaaaaaaa-aaaa-6aaa-8aaa-aaaaaaaaaaaa",
      "00000000-0000-0000-0000-000000000000",
      "not-a-uuid",
    ];

    for (const value of acceptedIds) {
      expect(
        Option.isSome(
          decodeJson(decodeChannelActivityPublishTokenPayloadJson, {
            ...channelPublishPayload,
            organizationId: value,
          }),
        ),
      ).toBe(true);
    }
    for (const value of rejectedIds) {
      expect(
        Option.isNone(
          decodeJson(decodeChannelActivityPublishTokenPayloadJson, {
            ...channelPublishPayload,
            organizationId: value,
          }),
        ),
      ).toBe(true);
    }
  });

  it("requires every UUID claim to match the existing UUID format", () => {
    for (const field of [
      "organizationId",
      "channelId",
      "replyJobId",
      "agentId",
      "triggerMessageId",
      "parentMessageId",
    ] as const) {
      expect(
        Option.isNone(
          decodeJson(decodeChannelActivityPublishTokenPayloadJson, {
            ...channelPublishPayload,
            [field]: "invalid",
          }),
        ),
      ).toBe(true);
    }

    for (const field of [
      "organizationId",
      "projectId",
      "runId",
      "replyJobId",
      "triggerMessageId",
      "parentMessageId",
    ] as const) {
      expect(
        Option.isNone(
          decodeJson(decodeIssueActivityPublishTokenPayloadJson, {
            ...issuePublishPayload,
            [field]: "invalid",
          }),
        ),
      ).toBe(true);
    }
  });

  it("accepts only positive safe-integer attempts", () => {
    for (const attempt of [1, Number.MAX_SAFE_INTEGER]) {
      expect(
        Option.isSome(
          decodeJson(decodeChannelActivityPublishTokenPayloadJson, {
            ...channelPublishPayload,
            attempt,
          }),
        ),
      ).toBe(true);
    }
    for (const attempt of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(
        Option.isNone(
          decodeJson(decodeChannelActivityPublishTokenPayloadJson, {
            ...channelPublishPayload,
            attempt,
          }),
        ),
      ).toBe(true);
    }
  });

  it("preserves worker, device, user, and nonce length boundaries", () => {
    for (const [field, maximum] of [
      ["workerId", 64],
      ["deviceId", 200],
      ["nonce", 100],
    ] as const) {
      expect(
        Option.isSome(
          decodeJson(decodeChannelActivityPublishTokenPayloadJson, {
            ...channelPublishPayload,
            [field]: "x".repeat(maximum),
          }),
        ),
      ).toBe(true);
      for (const value of ["", "x".repeat(maximum + 1)]) {
        expect(
          Option.isNone(
            decodeJson(decodeChannelActivityPublishTokenPayloadJson, {
              ...channelPublishPayload,
              [field]: value,
            }),
          ),
        ).toBe(true);
      }
    }

    expect(
      Option.isSome(
        decodeJson(decodeChannelActivitySocketTicketPayloadJson, {
          ...channelSocketPayload,
          userId: "x".repeat(200),
        }),
      ),
    ).toBe(true);
    for (const userId of ["", "x".repeat(201)]) {
      expect(
        Option.isNone(
          decodeJson(decodeChannelActivitySocketTicketPayloadJson, {
            ...channelSocketPayload,
            userId,
          }),
        ),
      ).toBe(true);
    }
  });

  it("validates timestamps as safe integers without applying time policy", () => {
    for (const expiresAt of [
      Number.MIN_SAFE_INTEGER,
      0,
      Number.MAX_SAFE_INTEGER,
    ]) {
      expect(
        Option.isSome(
          decodeJson(decodeChannelActivityPublishTokenPayloadJson, {
            ...channelPublishPayload,
            expiresAt,
          }),
        ),
      ).toBe(true);
    }
    for (const expiresAt of [1.5, Number.MAX_SAFE_INTEGER + 1, "1"]) {
      expect(
        Option.isNone(
          decodeJson(decodeChannelActivityPublishTokenPayloadJson, {
            ...channelPublishPayload,
            expiresAt,
          }),
        ),
      ).toBe(true);
    }

    expect(
      Option.isNone(
        decodeJson(decodeIssueActivitySocketTicketPayloadJson, {
          ...issueSocketPayload,
          authorizationExpiresAt: 1.5,
        }),
      ),
    ).toBe(true);
  });

  it("rejects wrong variants, missing claims, and malformed JSON", () => {
    expect(
      Option.isNone(
        decodeJson(
          decodeChannelActivityPublishTokenPayloadJson,
          issuePublishPayload,
        ),
      ),
    ).toBe(true);
    const { nonce: _nonce, ...missingNonce } = channelPublishPayload;
    expect(
      Option.isNone(
        decodeJson(
          decodeChannelActivityPublishTokenPayloadJson,
          missingNonce,
        ),
      ),
    ).toBe(true);
    for (const input of ["not json", "null", "[]", '"payload"']) {
      expect(
        Option.isNone(decodeChannelActivityPublishTokenPayloadJson(input)),
      ).toBe(true);
    }
  });
});
