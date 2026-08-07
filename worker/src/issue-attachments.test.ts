import { describe, expect, it } from "vitest";
import { maxIssueMultipartBytes } from "../../src/lib/issue-attachments";
import {
  readIssueMessageRequest,
  readIssueRequest,
  readIssueUpdateRequest,
} from "./index";

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
      assigneeUserId: null,
      status: "backlog",
      preferredProvider: null,
      preferredModel: null,
      preferredEffort: null,
      checkpoints: [],
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

describe("issue update multipart input", () => {
  const updateRequest = (
    file: File,
    declaredLength = file.size + 2048,
    keptAttachmentIds?: string[],
  ) => {
    const form = new FormData();
    form.set("title", "Edited screenshot issue");
    form.set("description", "Replaced description");
    form.set("priority", "3");
    form.set("assigneeUserId", "user-1");
    form.append("attachments", file, file.name);
    form.set("attachmentReferences", JSON.stringify(["draft-update-1"]));
    if (keptAttachmentIds) {
      form.set("keptAttachmentIds", JSON.stringify(keptAttachmentIds));
    }
    return new Request("https://briar.example/projects/project/runs/run", {
      method: "PATCH",
      headers: { "Content-Length": String(declaredLength) },
      body: form,
    });
  };

  const existingAttachmentId = "7316678b-e3d4-4de3-a045-b76a0fc2e765";

  it("parses a JSON update without attachment fields", async () => {
    const result = await readIssueUpdateRequest(
      new Request("https://briar.example/projects/project/runs/run", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Updated issue",
          description: null,
          priority: 2,
          assigneeUserId: null,
        }),
      }),
    );

    expect(result.input).toEqual({
      title: "Updated issue",
      description: null,
      priority: 2,
      assigneeUserId: null,
    });
    expect(result.attachments).toEqual([]);
    expect(result.keptAttachmentIds).toBeUndefined();
  });

  it("parses a multipart update with attachments and kept IDs", async () => {
    const result = await readIssueUpdateRequest(
      updateRequest(
        new File(["image"], "inline.png", { type: "image/png" }),
        undefined,
        [existingAttachmentId],
      ),
    );

    expect(result.input).toEqual({
      title: "Edited screenshot issue",
      description: "Replaced description",
      priority: 3,
      assigneeUserId: "user-1",
    });
    expect(result.attachments).toEqual([
      expect.objectContaining({ name: "inline.png", type: "image/png" }),
    ]);
    expect(result.attachmentReferences).toEqual(["draft-update-1"]);
    expect(result.keptAttachmentIds).toEqual([existingAttachmentId]);
  });

  it("keeps keptAttachmentIds undefined when the field is absent", async () => {
    const result = await readIssueUpdateRequest(
      updateRequest(new File(["image"], "inline.png", { type: "image/png" })),
    );

    expect(result.keptAttachmentIds).toBeUndefined();
  });

  it("rejects malformed kept attachment IDs", async () => {
    await expect(
      readIssueUpdateRequest(
        updateRequest(
          new File(["image"], "inline.png", { type: "image/png" }),
          undefined,
          ["not-a-uuid"],
        ),
      ),
    ).rejects.toThrow("Kept attachment IDs are invalid");
  });
});

describe("issue conversation multipart input", () => {
  const messageRequest = (file: File, reference = crypto.randomUUID()) => {
    const form = new FormData();
    form.set(
      "body",
      `확인해 주세요\n\n![${file.name}](briar-attachment://${reference})`,
    );
    form.set("parentMessageId", "");
    form.set("mentionedUserIds", "[]");
    form.set("agentConversationId", "");
    form.set("attachmentReferences", JSON.stringify([reference]));
    form.append("attachments", file, file.name);
    return new Request("https://briar.example/projects/project/runs/run/messages", {
      method: "POST",
      headers: { "Content-Length": String(file.size + 2048) },
      body: form,
    });
  };

  it("parses pasted conversation images and their inline references", async () => {
    const reference = crypto.randomUUID();
    const result = await readIssueMessageRequest(
      messageRequest(
        new File(["image"], "clipboard.png", { type: "image/png" }),
        reference,
      ),
    );

    expect(result.input.body).toContain(`briar-attachment://${reference}`);
    expect(result.attachments).toEqual([
      expect.objectContaining({ name: "clipboard.png", type: "image/png" }),
    ]);
    expect(result.attachmentReferences).toEqual([reference]);
  });

  it("rejects videos in issue conversations", async () => {
    await expect(
      readIssueMessageRequest(
        messageRequest(new File(["video"], "clip.mp4", { type: "video/mp4" })),
      ),
    ).rejects.toThrow("must be images");
  });
});
