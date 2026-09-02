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
    ])).toContain("이미지 또는 PDF");
  });

  it("normalizes a dropped PDF when the browser omits its MIME type", () => {
    const file = new File(["%PDF-1.7"], "brief.PDF", { type: "" });
    const normalized = normalizeChannelAttachmentFile(file);

    expect(normalized.type).toBe("application/pdf");
    expect(channelAttachmentMimeTypeFromName(file.name)).toBe("application/pdf");
    expect(isChannelPdfAttachment(normalized.type, normalized.name)).toBe(true);
    expect(isChannelAttachmentTypeSupported(normalized.type)).toBe(true);
  });

  it("keeps the existing count and byte limits", () => {
    expect(validateChannelAttachments(Array.from(
      { length: 6 },
      (_, index) => ({
        name: `${index}.pdf`,
        size: 1,
        type: "application/pdf",
      }),
    ))).toContain("최대 5개");
    expect(validateChannelAttachments([
      { name: "empty.pdf", size: 0, type: "application/pdf" },
    ])).toContain("빈 파일");
    expect(validateChannelAttachments([
      { name: "large.pdf", size: 20 * 1024 * 1024 + 1, type: "application/pdf" },
    ])).toContain("20MB");
    expect(validateChannelAttachments([
      { name: "part-1.pdf", size: 13 * 1024 * 1024, type: "application/pdf" },
      { name: "part-2.pdf", size: 13 * 1024 * 1024, type: "application/pdf" },
    ])).toContain("25MB");
  });
});
