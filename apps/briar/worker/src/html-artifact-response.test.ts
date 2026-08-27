import { describe, expect, it } from "vitest";
import { channelAttachmentResponse } from "./channel-attachment-response";
import { issueAttachmentResponse } from "./issue-attachment-service";

const object = {
  size: 15,
  httpEtag: '"artifact-etag"',
} as R2Object;

describe("HTML artifact responses", () => {
  it("applies the same restrictive sandbox policy to channel and issue files", () => {
    for (const response of [
      channelAttachmentResponse({
        filename: "lesson.html",
        content_type: "text/html",
        byte_size: 15,
      }, object, null),
      issueAttachmentResponse({
        filename: "lesson.html",
        content_type: "text/html",
        byte_size: 15,
      }, object, null),
    ]) {
      expect(response.headers.get("Content-Security-Policy"))
        .toContain("sandbox allow-scripts");
      expect(response.headers.get("Content-Security-Policy"))
        .toContain("connect-src 'none'");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });
});
