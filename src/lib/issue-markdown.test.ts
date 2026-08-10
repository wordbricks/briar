import { describe, expect, it } from "vitest";
import {
  canonicalizeIssueAttachmentReferences,
  issueAttachmentMarkdown,
  issueAttachmentReference,
  issueAttachmentReferences,
  removeIssueAttachmentMarkdown,
} from "./issue-markdown";

describe("issue markdown attachments", () => {
  it("builds and reads an inline attachment image", () => {
    const markdown = issueAttachmentMarkdown("draft-1", "screen [1].png");

    expect(markdown).toBe("![screen \\[1\\].png](briar-attachment://draft-1)");
    expect(issueAttachmentReferences(markdown)).toEqual(new Set(["draft-1"]));
    expect(issueAttachmentReference("briar-attachment://draft-1")).toBe(
      "draft-1",
    );
  });

  it("escapes filenames identically across web and native mobile payloads", () => {
    expect(
      issueAttachmentMarkdown("fixed-ref", "line\\[a]\r\nnext\nfinal].png"),
    ).toBe(
      "![line\\\\\\[a\\] next final\\].png](briar-attachment://fixed-ref)",
    );
  });

  it("canonicalizes temporary references without changing other markdown", () => {
    expect(
      canonicalizeIssueAttachmentReferences(
        "before\n\n![screen](briar-attachment://draft-1)\n\nafter",
        ["draft-1"],
        ["stored-1"],
      ),
    ).toBe("before\n\n![screen](briar-attachment://stored-1)\n\nafter");
  });

  it("removes the generated markdown when an attachment is removed", () => {
    const image = issueAttachmentMarkdown("draft-1", "screen.png");
    expect(
      removeIssueAttachmentMarkdown(`before\n\n${image}\n\nafter`, "draft-1"),
    ).toBe("before\n\nafter");
  });

  it("removes a reference even after its image alt text is edited", () => {
    expect(
      removeIssueAttachmentMarkdown(
        "before\n\n![edited alt](briar-attachment://draft-1)\n\nafter",
        "draft-1",
      ),
    ).toBe("before\n\nafter");
  });
});
