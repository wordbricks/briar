import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  copyIssueId,
  copyIssueShareLink,
  copySessionShareLink,
  issueDeepLinkUrl,
  issueShareUrl,
  parseBriarLink,
  parseIssueLink,
  parseSessionLink,
  sessionDeepLinkUrl,
  sessionShareUrl,
  shareIssueLink,
} from "./issue-links";

const projectId = "11111111-1111-4111-8111-111111111111";
const runId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const mobileConfig = (platform: "android" | "ios") =>
  JSON.parse(
    readFileSync(
      new URL(`../../src-tauri/tauri.${platform}.conf.json`, import.meta.url),
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("issue links", () => {
  it("builds matching HTTPS share and app deep links", () => {
    expect(
      issueShareUrl(projectId, runId, "https://briar-api.example/base"),
    ).toBe(
      `https://briar-api.example/open/issues/${projectId}/${runId}`,
    );
    expect(issueDeepLinkUrl(projectId, runId)).toBe(
      `briar-companion://issues/${projectId}/${runId}`,
    );
  });

  it("parses only well-formed issue links", () => {
    expect(
      parseIssueLink(
        `https://briar-api.example/open/issues/${projectId}/${runId}`,
      ),
    ).toEqual({ projectId, runId });
    expect(
      parseIssueLink(`briar-companion://issues/${projectId}/${runId}`),
    ).toEqual({ projectId, runId });
    expect(parseIssueLink("briar-companion://auth-complete")).toBeNull();
    expect(parseIssueLink("https://briar-api.example/open/issues/nope/nope"))
      .toBeNull();
  });

  it("builds and parses matching session share and app deep links", () => {
    expect(
      sessionShareUrl(projectId, sessionId, "https://briar-api.example/base"),
    ).toBe(
      `https://briar-api.example/open/sessions/${projectId}/${sessionId}`,
    );
    expect(sessionDeepLinkUrl(projectId, sessionId)).toBe(
      `briar-companion://sessions/${projectId}/${sessionId}`,
    );
    expect(
      parseSessionLink(
        `https://briar-api.example/open/sessions/${projectId}/${sessionId}`,
      ),
    ).toEqual({ projectId, sessionId });
    expect(
      parseSessionLink(
        `briar-companion://sessions/${projectId}/${sessionId}`,
      ),
    ).toEqual({ projectId, sessionId });
    expect(parseSessionLink("briar-companion://issues/nope/nope")).toBeNull();
    expect(
      parseSessionLink("https://briar-api.example/open/sessions/nope/nope"),
    ).toBeNull();
  });

  it("classifies issue and session links through one app-link parser", () => {
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
  });

  it("registers issue and session deep links on both mobile platforms", () => {
    expect(mobileConfig("android").plugins["deep-link"].mobile).toContainEqual({
      scheme: ["briar-companion"],
      appLink: false,
    });
    expect(mobileConfig("ios").plugins["deep-link"].mobile).toEqual(
      expect.arrayContaining([
        {
          scheme: ["briar-companion"],
          appLink: false,
        },
        {
          scheme: ["https"],
          host: "briar-api.wbai.workers.dev",
          pathPrefix: ["/open/issues", "/open/sessions"],
          appLink: true,
        },
      ]),
    );
  });

  it("registers and grants issue deep links on desktop", () => {
    expect(desktopConfig.plugins["deep-link"].desktop.schemes).toContain(
      "briar-companion",
    );
    expect(desktopCapabilities.permissions).toContain("deep-link:default");
  });

  it("copies the deterministic issue URL directly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copyIssueShareLink({ projectId, runId });

    expect(writeText).toHaveBeenCalledWith(
      `http://127.0.0.1:8787/open/issues/${projectId}/${runId}`,
    );
  });

  it("copies the deterministic session URL directly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copySessionShareLink({ projectId, sessionId });

    expect(writeText).toHaveBeenCalledWith(
      `http://127.0.0.1:8787/open/sessions/${projectId}/${sessionId}`,
    );
  });

  it("copies the displayed AH issue ID", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await copyIssueId(42);

    expect(writeText).toHaveBeenCalledWith("AH-42");
  });

  it("uses native sharing when the WebView supports it", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: share,
    });

    await expect(
      shareIssueLink({ projectId, runId, title: "Shared issue" }),
    ).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({
      title: "Shared issue",
      url: `http://127.0.0.1:8787/open/issues/${projectId}/${runId}`,
    });
  });

  it("copies the link when native sharing is unavailable", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: undefined,
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await expect(
      shareIssueLink({ projectId, runId, title: "Copied issue" }),
    ).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(
      `http://127.0.0.1:8787/open/issues/${projectId}/${runId}`,
    );
  });
});
