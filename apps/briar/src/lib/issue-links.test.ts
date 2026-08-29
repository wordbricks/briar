import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  channelShareUrl,
  issueShareUrl,
  parseBriarLink,
  parseChannelLink,
  parseIssueLink,
  parseSessionLink,
  parseWebAppIssuePath,
  sessionShareUrl,
} from "./issue-links";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const organizationId = "44444444-4444-4444-8444-444444444444";
const channelId = "55555555-5555-4555-8555-555555555555";
const messageId = "66666666-6666-4666-8666-666666666666";
const rootMessageId = "77777777-7777-4777-8777-777777777777";
const apiOrigin = "https://briar-api.example";
const androidConfig = JSON.parse(
  readFileSync(
    new URL("../../src-tauri/tauri.android.conf.json", import.meta.url),
    "utf8",
  ),
);
const desktopConfig = JSON.parse(
  readFileSync(
    new URL("../../src-tauri/tauri.conf.json", import.meta.url),
    "utf8",
  ),
);
const desktopCapabilities = JSON.parse(
  readFileSync(
    new URL(
      "../../src-tauri/capabilities/default.json",
      import.meta.url,
    ),
    "utf8",
  ),
);

describe("issue links", () => {
  it("builds a deterministic HTTPS issue share link", () => {
    expect(
      issueShareUrl(projectId, runId, "https://briar-api.example/base"),
    ).toBe(
      `https://briar-api.example/open/issues/${projectId}/${runId}`,
    );
  });

  it("parses only well-formed issue links", () => {
    expect(
      parseIssueLink(
        `https://briar-api.example/open/issues/${projectId}/${runId}`,
        apiOrigin,
      ),
    ).toEqual({ projectId, runId });
    expect(
      parseIssueLink(`briar-companion://issues/${projectId}/${runId}`),
    ).toEqual({ projectId, runId });
    expect(parseIssueLink("briar-companion://auth-complete")).toBeNull();
    expect(parseIssueLink("https://briar-api.example/open/issues/nope/nope", apiOrigin))
      .toBeNull();
    expect(
      parseIssueLink(
        `https://attacker.example/open/issues/${projectId}/${runId}`,
        apiOrigin,
      ),
    ).toBeNull();
  });

  it("parses an issue destination from the web app path", () => {
    expect(
      parseWebAppIssuePath(`/app/open/issues/${projectId}/${runId}`),
    ).toEqual({ projectId, runId });
    expect(
      parseWebAppIssuePath(`/app/open/issues/${projectId}/${runId}/`),
    ).toEqual({ projectId, runId });
    expect(parseWebAppIssuePath("/app/open/issues/nope/nope")).toBeNull();
    expect(
      parseWebAppIssuePath(`/open/issues/${projectId}/${runId}`),
    ).toBeNull();
  });

  it("builds and parses session share and app deep links", () => {
    expect(
      sessionShareUrl(projectId, sessionId, "https://briar-api.example/base"),
    ).toBe(
      `https://briar-api.example/open/sessions/${projectId}/${sessionId}`,
    );
    expect(
      parseSessionLink(
        `https://briar-api.example/open/sessions/${projectId}/${sessionId}`,
        apiOrigin,
      ),
    ).toEqual({ projectId, sessionId });
    expect(
      parseSessionLink(
        `briar-companion://sessions/${projectId}/${sessionId}`,
      ),
    ).toEqual({ projectId, sessionId });
    expect(parseSessionLink("briar-companion://issues/nope/nope")).toBeNull();
    expect(
      parseSessionLink(
        "https://briar-api.example/open/sessions/nope/nope",
        apiOrigin,
      ),
    ).toBeNull();
  });

  it("classifies issue, session, and channel links through one app-link parser", () => {
    expect(
      parseBriarLink(
        `briar-companion://issues/${projectId}/${runId}`,
      ),
    ).toEqual({ kind: "issue", projectId, runId });
    expect(
      parseBriarLink(
        `briar-companion://sessions/${projectId}/${sessionId}`,
      ),
    ).toEqual({ kind: "session", projectId, sessionId });
    expect(
      parseBriarLink(
        `briar-companion://channels/${organizationId}/${channelId}/${messageId}?root=${rootMessageId}`,
      ),
    ).toEqual({
      kind: "channel",
      organizationId,
      channelId,
      messageId,
      rootMessageId,
    });
  });

  it("builds and parses channel share and app deep links", () => {
    expect(
      channelShareUrl(
        { organizationId, channelId },
        "https://briar-api.example/base",
      ),
    ).toBe(
      `https://briar-api.example/open/channels/${organizationId}/${channelId}`,
    );
    expect(
      parseChannelLink(
        `https://briar-api.example/open/channels/${organizationId}/${channelId}`,
        apiOrigin,
      ),
    ).toEqual({
      organizationId,
      channelId,
      messageId: null,
      rootMessageId: null,
    });
    expect(
      parseBriarLink(
        `briar-companion://channels/${organizationId}/${channelId}`,
      ),
    ).toEqual({
      kind: "channel",
      organizationId,
      channelId,
      messageId: null,
      rootMessageId: null,
    });
    expect(
      channelShareUrl(
        { organizationId, channelId, messageId },
        "https://briar-api.example/base",
      ),
    ).toBe(
      `https://briar-api.example/open/channels/${organizationId}/${channelId}/${messageId}`,
    );
    expect(
      channelShareUrl(
        { organizationId, channelId, messageId, rootMessageId },
        "https://briar-api.example/base",
      ),
    ).toBe(
      `https://briar-api.example/open/channels/${organizationId}/${channelId}/${messageId}?root=${rootMessageId}`,
    );
    expect(
      parseChannelLink(
        `https://briar-api.example/open/channels/${organizationId}/${channelId}/${messageId}`,
        apiOrigin,
      ),
    ).toEqual({
      organizationId,
      channelId,
      messageId,
      rootMessageId: messageId,
    });
    expect(
      parseChannelLink(
        `briar-companion://channels/${organizationId}/${channelId}/${messageId}?root=${rootMessageId}`,
      ),
    ).toEqual({
      organizationId,
      channelId,
      messageId,
      rootMessageId,
    });
    expect(parseChannelLink(
      "https://briar-api.example/open/channels/nope/nope/nope",
      apiOrigin,
    ))
      .toBeNull();
  });

  it("registers issue and session deep links on Tauri Android", () => {
    expect(androidConfig.plugins["deep-link"].mobile).toContainEqual({
      scheme: ["briar-companion"],
      appLink: false,
    });
  });

  it("registers and grants issue deep links on desktop", () => {
    expect(desktopConfig.plugins["deep-link"].desktop.schemes).toContain(
      "briar-companion",
    );
    expect(desktopCapabilities.permissions).toContain("deep-link:default");
  });

});
