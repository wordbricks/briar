import { describe, expect, it } from "vitest";
import {
  dataTransferHasFiles,
  filesFromDataTransfer,
  isIssueAttachmentImage,
  issueAttachmentMimeTypeFromName,
  maxIssueAttachmentBytes,
  normalizeIssueAttachmentFile,
  validateIssueAttachments,
} from "./issue-attachments";

describe("issue attachment validation", () => {
  it("accepts supported images and videos", () => {
    expect(
      validateIssueAttachments([
        { name: "screen.png", size: 2_000, type: "image/png" },
        { name: "diagram.svg", size: 1_500, type: "image/svg+xml" },
        { name: "recording.mov", size: 3_000, type: "video/quicktime" },
      ]),
    ).toBeNull();
  });

  it("accepts dropped files that omit MIME type when the extension is known", () => {
    expect(
      validateIssueAttachments([
        { name: "dropped.png", size: 2_000, type: "" },
        { name: "clip.mov", size: 3_000, type: "" },
      ]),
    ).toBeNull();
  });

  it("rejects unsupported, oversized, and excessive attachments", () => {
    expect(
      validateIssueAttachments([
        { name: "payload.pdf", size: 100, type: "application/pdf" },
      ]),
    ).toContain("지원하지 않는");
    expect(
      validateIssueAttachments([
        {
          name: "long.mp4",
          size: maxIssueAttachmentBytes + 1,
          type: "video/mp4",
        },
      ]),
    ).toContain("20MB");
    expect(
      validateIssueAttachments(
        Array.from({ length: 6 }, (_, index) => ({
          name: `${index}.png`,
          size: 100,
          type: "image/png",
        })),
      ),
    ).toContain("최대 5개");
  });
});

describe("issue attachment drop helpers", () => {
  it("infers MIME types from common image and video extensions", () => {
    expect(issueAttachmentMimeTypeFromName("shot.JPG")).toBe("image/jpeg");
    expect(issueAttachmentMimeTypeFromName("diagram.SVG")).toBe("image/svg+xml");
    expect(issueAttachmentMimeTypeFromName("clip.m4v")).toBe("video/mp4");
    expect(issueAttachmentMimeTypeFromName("notes.txt")).toBeNull();
  });

  it("detects image attachments from content type or filename", () => {
    expect(isIssueAttachmentImage("image/png", "x.bin")).toBe(true);
    expect(isIssueAttachmentImage("", "image.png")).toBe(true);
    expect(isIssueAttachmentImage(null, "photo.JPG")).toBe(true);
    expect(isIssueAttachmentImage("video/mp4", "clip.mp4")).toBe(false);
    expect(isIssueAttachmentImage("", "notes.txt")).toBe(false);
  });

  it("fills missing or generic File.type from the filename for supported media", () => {
    const untyped = new File(["pixels"], "photo.webp", { type: "" });
    const normalized = normalizeIssueAttachmentFile(untyped);
    expect(normalized.type).toBe("image/webp");
    expect(normalized.name).toBe("photo.webp");

    const untypedSvg = new File(["vector"], "diagram.svg", { type: "" });
    expect(normalizeIssueAttachmentFile(untypedSvg).type).toBe("image/svg+xml");

    const genericSvg = new File(["vector"], "generic.svg", {
      type: "application/octet-stream",
    });
    expect(normalizeIssueAttachmentFile(genericSvg).type).toBe("image/svg+xml");
  });

  it("reads files from DataTransfer items and types", () => {
    const image = new File(["dropped"], "dropped.png", { type: "" });
    const dataTransfer = {
      files: [image],
      items: [
        {
          kind: "file",
          getAsFile: () => image,
        },
      ],
      types: ["Files"],
    } as unknown as DataTransfer;

    expect(dataTransferHasFiles(dataTransfer)).toBe(true);
    const files = filesFromDataTransfer(dataTransfer);
    expect(files).toHaveLength(1);
    expect(files[0]?.type).toBe("image/png");
    expect(files[0]?.name).toBe("dropped.png");
  });
});
