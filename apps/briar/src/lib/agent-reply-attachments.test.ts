import { describe, expect, it } from "vitest";
import {
  htmlArtifactContentSecurityPolicy,
  isHtmlArtifactAttachment,
  normalizeAgentReplyAttachmentFile,
  sandboxHtmlArtifactDocument,
  validateAgentReplyAttachments,
} from "./agent-reply-attachments";

describe("agent reply attachments", () => {
  it("recognizes and normalizes HTML artifacts without widening ordinary uploads", () => {
    expect(isHtmlArtifactAttachment("text/html; charset=utf-8", "lesson.bin"))
      .toBe(true);
    expect(isHtmlArtifactAttachment("", "lesson.HTML")).toBe(true);
    expect(isHtmlArtifactAttachment("text/plain", "notes.txt")).toBe(false);

    const normalized = normalizeAgentReplyAttachmentFile(
      new File(["<h1>Lesson</h1>"], "lesson.html"),
    );
    expect(normalized.type).toBe("text/html");
    expect(validateAgentReplyAttachments([normalized])).toBeNull();
    expect(validateAgentReplyAttachments([
      new File(["notes"], "notes.txt", { type: "text/plain" }),
    ])).toContain("images or HTML files");
  });

  it("injects the restrictive preview policy into complete or fragment markup", () => {
    const complete = sandboxHtmlArtifactDocument(
      "<!doctype html><html><head><title>Lesson</title></head><body>Hi</body></html>",
    );
    expect(complete).toContain("Content-Security-Policy");
    expect(complete).toContain(htmlArtifactContentSecurityPolicy);
    expect(complete).toContain("<title>Lesson</title>");

    const fragment = sandboxHtmlArtifactDocument("<main>Hi</main>");
    expect(fragment).toContain("<!doctype html>");
    expect(fragment).toContain("<main>Hi</main>");
    expect(fragment.indexOf("Content-Security-Policy"))
      .toBeLessThan(fragment.indexOf("<main>"));
  });
});
