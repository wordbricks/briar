import { describe, expect, it } from "vitest";
import {
  decryptSlackToken,
  encryptSlackToken,
  parseSlackIssueInstruction,
  verifySlackRequest,
} from "./slack";

describe("Slack integration", () => {
  it("verifies Slack signatures and rejects stale requests", async () => {
    // Slack's published verification test vector, split so scanners do not
    // mistake the public fixture for a live credential.
    const signingSecret = ["8f742231b10e8888", "abcd99yyyzzz85a5"].join("");
    const timestamp = "1531420618";
    const body =
      "token=xyzz0WbapA4vBCDEFasx0q6G&team_id=T1DC2JH3J&team_domain=testteamnow&channel_id=G8PSS9T3V&channel_name=foobar&user_id=U2CERLKJA&user_name=roadrunner&command=%2Fwebhook-collect&text=&response_url=https%3A%2F%2Fhooks.slack.com%2Fcommands%2FT1DC2JH3J%2F397700885554%2F96rGlfmibIGlgcZRskXaIFfN&trigger_id=398738663015.47445629121.803a0bc887a14d10d2c447fce8b6703c";
    const headers = new Headers({
      "x-slack-request-timestamp": timestamp,
      "x-slack-signature":
        "v0=a2114d57b48eac39b9ad189dd8316235a7b4a8d21a10bd27519666489c69b503",
    });

    expect(
      await verifySlackRequest(
        body,
        headers,
        signingSecret,
        Number(timestamp) * 1000,
      ),
    ).toBe(true);
    expect(
      await verifySlackRequest(
        `${body}tampered`,
        headers,
        signingSecret,
        Number(timestamp) * 1000,
      ),
    ).toBe(false);
    expect(
      await verifySlackRequest(
        body,
        headers,
        signingSecret,
        Number(timestamp) * 1000 + 301_000,
      ),
    ).toBe(false);
  });

  it("encrypts installed bot tokens with a unique AES-GCM nonce", async () => {
    const secret = "a dedicated encryption secret";
    const first = await encryptSlackToken("xoxb-secret-token", secret);
    const second = await encryptSlackToken("xoxb-secret-token", secret);

    expect(first.encryptedToken).not.toBe("xoxb-secret-token");
    expect(first.iv).not.toBe(second.iv);
    expect(
      await decryptSlackToken(first.encryptedToken, first.iv, secret),
    ).toBe("xoxb-secret-token");
    await expect(
      decryptSlackToken(first.encryptedToken, first.iv, "wrong secret"),
    ).rejects.toThrow();
  });

  it("parses a mention into title, description, placement, and priority", () => {
    expect(
      parseSlackIssueInstruction(
        "<@U123ABC> 이슈 생성: 로그인 버튼이 동작하지 않아요 --priority high --backlog\nSafari OAuth 이후 재현됩니다.",
      ),
    ).toEqual({
      title: "로그인 버튼이 동작하지 않아요",
      description: "Safari OAuth 이후 재현됩니다.",
      priority: 2,
      status: "backlog",
    });
    expect(
      parseSlackIssueInstruction(
        "<@U123ABC> create Checkout is blank --priority=P1",
      ),
    ).toEqual({
      title: "Checkout is blank",
      description: null,
      priority: 1,
      status: "queued",
    });
    expect(parseSlackIssueInstruction("<@U123ABC> 도움말")).toBeNull();
  });
});
