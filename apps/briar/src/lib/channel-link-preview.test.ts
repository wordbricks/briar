import { describe, expect, it } from "vitest";
import {
  channelMessageLinkPreviewUrl,
  firstHttpUrl,
} from "./channel-link-preview";

describe("channel link preview URL extraction", () => {
  it("finds the first HTTP(S) link and removes chat punctuation", () => {
    expect(firstHttpUrl("Read this: https://news.example.com/story)."))
      .toBe("https://news.example.com/story");
    expect(firstHttpUrl("<https://news.example.com/story|Read more>"))
      .toBe("https://news.example.com/story");
  });

  it("falls back to URLs in structured webhook blocks", () => {
    expect(channelMessageLinkPreviewUrl({
      body: "Deployment complete",
      blocks: [{
        type: "section",
        text: { type: "mrkdwn", text: "Open https://status.example.org" },
      }],
    })).toBe("https://status.example.org/");
  });

  it("ignores unsupported and credential-bearing URLs", () => {
    expect(firstHttpUrl("mailto:hello@example.com ftp://files.example.com"))
      .toBeNull();
    expect(firstHttpUrl("https://user:secret@news.example.com"))
      .toBeNull();
  });
});
