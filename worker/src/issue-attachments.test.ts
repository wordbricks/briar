import { describe, expect, it } from "vitest";
import { maxIssueMultipartBytes } from "../../src/lib/issue-attachments";
import { readIssueRequest } from "./index";

const issueRequest = (file: File, declaredLength = file.size + 1024) => {
  const form = new FormData();
  form.set("title", "Screenshot issue");
  form.set("description", "Please inspect the attachment");
  form.set("priority", "2");
  form.append("attachments", file, file.name);
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
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual(
      expect.objectContaining({ name: "screen.png", type: "image/png", size: 5 }),
    );
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
});
