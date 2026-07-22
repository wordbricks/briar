import { describe, expect, it } from "vitest";
import {
  maxIssueAttachmentBytes,
  validateIssueAttachments,
} from "./issue-attachments";

describe("issue attachment validation", () => {
  it("accepts supported images and videos", () => {
    expect(
      validateIssueAttachments([
        { name: "screen.png", size: 2_000, type: "image/png" },
        { name: "recording.mov", size: 3_000, type: "video/quicktime" },
      ]),
    ).toBeNull();
  });

  it("rejects unsupported, oversized, and excessive attachments", () => {
    expect(
      validateIssueAttachments([
        { name: "payload.svg", size: 100, type: "image/svg+xml" },
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
