import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildSlackCreateIssueModal,
  callSlackApi,
  decryptSlackToken,
  downloadSlackIssueAttachments,
  encryptSlackToken,
  parseSlackCreateIssueSubmission,
  parseSlackIssueInstruction,
  slackCreateIssueBlocks,
  SlackCreateIssueValidationError,
  verifySlackRequest,
} from "./slack";

describe("Slack integration", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

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

  it("includes Slack response validation messages in API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          ok: false,
          error: "invalid_arguments",
          response_metadata: {
            messages: ["invalid view.blocks[3].element.filetypes"],
          },
        }),
      ),
    );

    await expect(callSlackApi("views.open", "xoxb-test", {})).rejects.toThrow(
      "invalid view.blocks[3].element.filetypes",
    );
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

  it("flags Slack mention titles that exceed the language-aware limit", () => {
    const longHangul = "가".repeat(101);
    expect(parseSlackIssueInstruction(`<@U123ABC> ${longHangul}`)).toEqual({
      title: longHangul,
      description: null,
      priority: null,
      status: "queued",
      titleTooLong: true,
    });
  });

  it("parses a /create modal submission", () => {
    expect(
      parseSlackCreateIssueSubmission({
        type: "view_submission",
        team: { id: "T123" },
        user: { id: "U123" },
        view: {
          id: "V123",
          private_metadata: JSON.stringify({
            responseUrl:
              "https://hooks.slack.com/commands/T123/B123/response-token",
            channelId: "C123",
          }),
          state: {
            values: {
              [slackCreateIssueBlocks.project]: {
                project: {
                  selected_option: { value: "project-2" },
                },
              },
              [slackCreateIssueBlocks.title]: {
                title: { value: "  Login is broken  " },
              },
              [slackCreateIssueBlocks.description]: {
                description: { value: "Safari OAuth" },
              },
              [slackCreateIssueBlocks.attachments]: {
                attachments: {
                  files: [{ id: "F123" }, { id: "F456" }],
                },
              },
            },
          },
        },
      }),
    ).toEqual({
      teamId: "T123",
      userId: "U123",
      viewId: "V123",
      projectId: "project-2",
      title: "Login is broken",
      description: "Safari OAuth",
      fileIds: ["F123", "F456"],
      source: "command",
      responseUrl:
        "https://hooks.slack.com/commands/T123/B123/response-token",
      channelId: "C123",
    });
  });

  it("parses a global shortcut modal submission without command context", () => {
    const modal = buildSlackCreateIssueModal({
      projects: [{ id: "project-1", name: "First" }],
      defaultProjectId: "project-1",
      responseUrl: null,
      channelId: null,
    });

    expect(
      parseSlackCreateIssueSubmission({
        type: "view_submission",
        team: { id: "T123" },
        user: { id: "U123" },
        view: {
          id: "V123",
          private_metadata: modal.private_metadata,
          state: {
            values: {
              [slackCreateIssueBlocks.project]: {
                project: {
                  selected_option: { value: "project-1" },
                },
              },
              [slackCreateIssueBlocks.title]: {
                title: { value: "Create from shortcut" },
              },
            },
          },
        },
      }),
    ).toMatchObject({
      teamId: "T123",
      userId: "U123",
      source: "shortcut",
      responseUrl: null,
      channelId: null,
    });
  });

  it("returns a block-level validation error for an empty modal title", () => {
    expect(() =>
      parseSlackCreateIssueSubmission({
        team: { id: "T123" },
        user: { id: "U123" },
        view: {
          id: "V123",
          private_metadata: "{}",
          state: {
            values: {
              [slackCreateIssueBlocks.project]: {
                project: { selected_option: { value: "project-1" } },
              },
              [slackCreateIssueBlocks.title]: {
                title: { value: " " },
              },
            },
          },
        },
      }),
    ).toThrow(
      expect.objectContaining({
        constructor: SlackCreateIssueValidationError,
        blockId: slackCreateIssueBlocks.title,
      }),
    );
  });

  it("returns guidance when a modal title exceeds the language-aware limit", () => {
    const longHangul = "가".repeat(101);
    expect(() =>
      parseSlackCreateIssueSubmission({
        team: { id: "T123" },
        user: { id: "U123" },
        view: {
          id: "V123",
          private_metadata: "{}",
          state: {
            values: {
              [slackCreateIssueBlocks.project]: {
                project: { selected_option: { value: "project-1" } },
              },
              [slackCreateIssueBlocks.title]: {
                title: { value: longHangul },
              },
            },
          },
        },
      }),
    ).toThrow(
      expect.objectContaining({
        constructor: SlackCreateIssueValidationError,
        blockId: slackCreateIssueBlocks.title,
        message: expect.stringContaining("100자"),
      }),
    );
  });

  it("downloads modal attachments with the bot token", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          file: {
            id: "F123",
            name: "screen.png",
            mimetype: "image/png",
            size: 3,
            url_private_download:
              "https://files.slack.com/files-pri/T123-F123/screen.png",
          },
        }),
      )
      .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
    vi.stubGlobal("fetch", fetchMock);

    const files = await downloadSlackIssueAttachments("xoxb-token", ["F123"]);

    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({
      name: "screen.png",
      type: "image/png",
      size: 3,
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://files.slack.com/files-pri/T123-F123/screen.png",
      { headers: { authorization: "Bearer xoxb-token" } },
    );
  });
});
