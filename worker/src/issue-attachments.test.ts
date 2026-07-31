import { describe, expect, it } from "vitest";
import { maxIssueMultipartBytes } from "../../src/lib/issue-attachments";
import { readIssueRequest } from "./index";

const issueRequest = (
  file: File,
  declaredLength = file.size + 1024,
  attachmentReference?: string,
) => {
  const form = new FormData();
  form.set("title", "Screenshot issue");
  form.set("description", "Please inspect the attachment");
  form.set("priority", "2");
  form.set("status", "backlog");
  form.append("attachments", file, file.name);
  if (attachmentReference) {
    form.set("attachmentReferences", JSON.stringify([attachmentReference]));
  }
  return new Request("https://briar.example/projects/project/issues", {
    method: "POST",
    headers: { "Content-Length": String(declaredLength) },
    body: form,
  });
};

describe("issue multipart input", () => {
  it("parses a bounded supported attachment", async () => {
    const result = await readIssueRequest(
      issueRequest(new File(["image"], "screen.png", { type: "image/png" })),
    );

    expect(result.input).toEqual({
      title: "Screenshot issue",
      description: "Please inspect the attachment",
      priority: 2,
      status: "backlog",
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual(
      expect.objectContaining({ name: "screen.png", type: "image/png", size: 5 }),
    );
    expect(result.attachmentReferences).toEqual([]);
  });

  it("parses an inline markdown attachment reference", async () => {
    const reference = "7316678b-e3d4-4de3-a045-b76a0fc2e765";
    const result = await readIssueRequest(
      issueRequest(
        new File(["image"], "screen.png", { type: "image/png" }),
        1029,
        reference,
      ),
    );

    expect(result.attachmentReferences).toEqual([reference]);
  });

  it("keeps queued as the default for JSON clients that omit status", async () => {
    const result = await readIssueRequest(
      new Request("https://briar.example/projects/project/issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Legacy issue client",
          description: null,
          priority: null,
        }),
      }),
    );

    expect(result.input.status).toBe("queued");
  });

  it("rejects unsupported media and oversized multipart bodies", async () => {
    await expect(
      readIssueRequest(
        issueRequest(new File(["svg"], "unsafe.svg", { type: "image/svg+xml" })),
      ),
    ).rejects.toThrow("지원하지 않는");
    await expect(
      readIssueRequest(
        issueRequest(
          new File(["video"], "recording.mp4", { type: "video/mp4" }),
          maxIssueMultipartBytes + 1,
        ),
      ),
    ).rejects.toThrow("25MB");
  });

  it("rejects malformed inline attachment references", async () => {
    await expect(
      readIssueRequest(
        issueRequest(
          new File(["image"], "screen.png", { type: "image/png" }),
          1029,
          "../../unsafe",
        ),
      ),
    ).rejects.toThrow("Attachment references are invalid");
  });
});
