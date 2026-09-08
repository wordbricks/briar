import { describe, expect, it } from "vitest";
import {
  channelAttachmentMimeTypeFromName,
  isChannelAttachmentTypeSupported,
  isChannelPdfAttachment,
  normalizeChannelAttachmentFile,
  validateChannelAttachments,
} from "./channel-attachments";

describe("channel attachments", () => {
  it("accepts images and PDFs without enabling videos", () => {
    expect(validateChannelAttachments([
      { name: "screen.png", size: 4, type: "image/png" },
      { name: "brief.pdf", size: 8, type: "application/pdf" },
    ])).toBeNull();
    expect(validateChannelAttachments([
      { name: "clip.mp4", size: 4, type: "video/mp4" },
    ])).toContain("Markdown(.md)");
  });

  it("normalizes a dropped PDF when the browser omits its MIME type", () => {
    const file = new File(["%PDF-1.7"], "brief.PDF", { type: "" });
    const normalized = normalizeChannelAttachmentFile(file);

    expect(normalized.type).toBe("application/pdf");
    expect(channelAttachmentMimeTypeFromName(file.name)).toBe("application/pdf");
    expect(isChannelPdfAttachment(normalized.type, normalized.name)).toBe(true);
    expect(isChannelAttachmentTypeSupported(normalized.type)).toBe(true);
  });

  it.each([
    ["photo.jpg", "image/jpg", "image/jpeg"],
    ["scan.PNG", "application/x-unknown", "image/png"],
    ["brief.pdf", "application/x-pdf", "application/pdf"],
    ["설계.MD", "", "text/markdown"],
    ["notes.md", "text/plain", "text/markdown"],
    ["notes.md", "text/x-markdown", "text/markdown"],
    ["notes.md", "application/octet-stream", "text/markdown"],
    ["notes.txt", "", "text/plain"],
    ["notes.TXT", "text/plain; charset=utf-8", "text/plain"],
    ["notes.txt", "application/octet-stream", "text/plain"],
  ])("preserves bytes and filename while normalizing %s (%s)", async (name, type, expected) => {
    const file = new File(["# 한글\r\n<script>alert(1)</script>\n"], name, { type, lastModified: 123 });
    const normalized = normalizeChannelAttachmentFile(file);
    expect(normalized.name).toBe(name);
    expect(normalized.lastModified).toBe(123);
    expect(normalized.type).toBe(expected);
    expect(await normalized.text()).toBe(await file.text());
    expect(validateChannelAttachments([normalized])).toBeNull();
  });

  it.each(["page.html", "archive.zip", "script.js", "notes.md.exe"])("rejects unsupported %s even with text MIME", (name) => {
    expect(validateChannelAttachments([{ name, size: 3, type: "text/plain" }])).not.toBeNull();
  });

  it("keeps the existing count and byte limits", () => {
    expect(validateChannelAttachments(Array.from(
      { length: 6 },
      (_, index) => ({
        name: `${index}.md`,
        size: 1,
        type: "application/pdf",
      }),
    ))).toContain("최대 5개");
    expect(validateChannelAttachments([
      { name: "empty.txt", size: 0, type: "application/pdf" },
    ])).toContain("빈 파일");
    expect(validateChannelAttachments([
      { name: "large.md", size: 20 * 1024 * 1024 + 1, type: "application/pdf" },
    ])).toContain("20MB");
    expect(validateChannelAttachments([
      { name: "part-1.md", size: 13 * 1024 * 1024, type: "application/pdf" },
      { name: "part-2.txt", size: 13 * 1024 * 1024, type: "application/pdf" },
    ])).toContain("25MB");
  });
});
