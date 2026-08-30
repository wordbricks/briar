import { describe, expect, it } from "vitest";
import { maxEvidenceMultipartBytes } from "../../src/lib/evidence-images";
import { maxIssueMultipartBytes } from "../../src/lib/issue-attachments";
import {
  readIssueMessageRequest,
  readChannelMessageRequest,
  readIssueRequest,
  readIssueUpdateRequest,
  readRunEvidenceRequest,
} from "./request-readers";

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

const multipartReaders: Array<{
  name: string;
  maxBytes: number;
  tooLargeMessage: string;
  read: (request: Request) => Promise<unknown>;
}> = [
  {
    name: "run evidence",
    maxBytes: maxEvidenceMultipartBytes,
    tooLargeMessage: "Evidence images exceed the 25MB total limit",
    read: readRunEvidenceRequest,
  },
  {
    name: "issue message",
    maxBytes: maxIssueMultipartBytes,
    tooLargeMessage: "Message attachments exceed the 25MB total limit",
    read: readIssueMessageRequest,
  },
  {
    name: "channel message",
    maxBytes: maxIssueMultipartBytes,
    tooLargeMessage: "Channel images exceed the 25MB total limit",
    read: readChannelMessageRequest,
  },
  {
    name: "issue create",
    maxBytes: maxIssueMultipartBytes,
    tooLargeMessage: "Issue attachments exceed the 25MB total limit",
    read: readIssueRequest,
  },
  {
    name: "issue update",
    maxBytes: maxIssueMultipartBytes,
    tooLargeMessage: "Issue attachments exceed the 25MB total limit",
    read: readIssueUpdateRequest,
  },
];

const invalidMultipartRequest = (contentLength?: number) =>
  new Request("https://briar.example/multipart", {
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data; boundary=invalid",
      ...(contentLength === undefined
        ? undefined
        : { "Content-Length": String(contentLength) }),
    },
    body: "not multipart data",
  });

const multipartFormRequest = (form: FormData) =>
  new Request("https://briar.example/multipart", {
    method: "POST",
    headers: { "Content-Length": "8192" },
    body: form,
  });

describe("shared multipart request envelope", () => {
  it.each([
    {
      name: "run evidence",
      read: readRunEvidenceRequest,
      emptyField: "images",
      body: {
        evidenceKey: "LOCAL-1:qa:result",
        stage: "qa",
        type: "test",
        status: "passed",
        observedAt: "2026-08-10T00:00:00.000Z",
        actor: "test",
      },
    },
    {
      name: "issue message",
      read: readIssueMessageRequest,
      emptyField: "attachments",
      body: { body: "JSON issue message" },
    },
    {
      name: "channel message",
      read: readChannelMessageRequest,
      emptyField: "attachments",
      body: { body: "JSON channel message" },
    },
    {
      name: "issue create",
      read: readIssueRequest,
      emptyField: "attachments",
      body: { title: "JSON issue" },
    },
    {
      name: "issue update",
      read: readIssueUpdateRequest,
      emptyField: "attachments",
      body: {
        title: "JSON update",
        description: null,
        priority: null,
        difficulty: "normal",
      },
    },
  ])("keeps non-multipart $name requests on the JSON path", async ({
    read,
    emptyField,
    body,
  }) => {
    const parsed = (await read(
      new Request("https://briar.example/json", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body),
      }),
    )) as Record<string, unknown>;

    expect(parsed[emptyField]).toEqual([]);
  });

  it.each([
    {
      name: "issue message",
      read: readIssueMessageRequest,
      body: { body: "Issue message" },
    },
    {
      name: "channel message",
      read: readChannelMessageRequest,
      body: { body: "Channel message" },
    },
    {
      name: "issue create",
      read: readIssueRequest,
      body: { title: "Issue with an existing image" },
    },
    {
      name: "issue update",
      read: readIssueUpdateRequest,
      body: {
        title: "Issue with an existing image",
        description: null,
        priority: null,
        difficulty: null,
      },
    },
  ])("preserves JSON attachment references for $name", async ({
    read,
    body,
  }) => {
    const result = await read(new Request("https://briar.example/json", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        attachmentReferences: ["existing-image"],
      }),
    }));

    expect(result.attachmentReferences).toEqual(["existing-image"]);
  });

  it.each(multipartReaders)(
    "requires Content-Length for $name",
    async ({ read }) => {
      await expect(read(invalidMultipartRequest())).rejects.toMatchObject({
        status: 411,
        message: "Multipart Content-Length is required",
      });
    },
  );

  it.each(multipartReaders)(
    "preserves the request-specific size error for $name",
    async ({ read, maxBytes, tooLargeMessage }) => {
      await expect(
        read(invalidMultipartRequest(maxBytes + 1)),
      ).rejects.toMatchObject({ status: 413, message: tooLargeMessage });
    },
  );

  it.each(multipartReaders)(
    "rejects malformed form data for $name",
    async ({ read }) => {
      await expect(read(invalidMultipartRequest(32))).rejects.toMatchObject({
        status: 400,
        message: "Invalid multipart form data",
      });
    },
  );

  it.each([
    {
      name: "evidence images",
      fieldName: "images",
      expectedMessage: "Evidence images must be files",
      read: readRunEvidenceRequest,
      prepare(form: FormData) {
        form.set(
          "evidence",
          JSON.stringify({
            evidenceKey: "LOCAL-1:qa:result",
            stage: "qa",
            type: "test",
            status: "passed",
            observedAt: "2026-08-10T00:00:00.000Z",
            actor: "test",
          }),
        );
      },
    },
    {
      name: "issue attachments",
      fieldName: "attachments",
      expectedMessage: "Attachments must be files",
      read: readIssueRequest,
      prepare(form: FormData) {
        form.set("title", "Invalid attachment");
      },
    },
  ])("rejects non-file $name with the existing error", async ({
    fieldName,
    expectedMessage,
    read,
    prepare,
  }) => {
    const form = new FormData();
    prepare(form);
    form.set(fieldName, "not a file");

    await expect(read(multipartFormRequest(form))).rejects.toMatchObject({
      status: 400,
      message: expectedMessage,
    });
  });

  it.each([
    {
      name: "evidence images",
      fieldName: "images",
      expectedMessage: "Evidence images are limited to 5 files.",
      read: readRunEvidenceRequest,
      prepare(form: FormData) {
        form.set(
          "evidence",
          JSON.stringify({
            evidenceKey: "LOCAL-1:qa:result",
            stage: "qa",
            type: "test",
            status: "passed",
            observedAt: "2026-08-10T00:00:00.000Z",
            actor: "test",
          }),
        );
      },
    },
    {
      name: "issue attachments",
      fieldName: "attachments",
      expectedMessage: "첨부 파일은 최대 5개까지 추가할 수 있습니다.",
      read: readIssueRequest,
      prepare(form: FormData) {
        form.set("title", "Too many attachments");
      },
    },
  ])("preserves the file-count validation for $name", async ({
    fieldName,
    expectedMessage,
    read,
    prepare,
  }) => {
    const form = new FormData();
    prepare(form);
    for (let index = 0; index < 6; index += 1) {
      form.append(
        fieldName,
        new File(["image"], `image-${index}.png`, { type: "image/png" }),
      );
    }

    await expect(read(multipartFormRequest(form))).rejects.toMatchObject({
      status: 400,
      message: expectedMessage,
    });
  });
});

describe("issue multipart input", () => {
  it("parses a bounded supported attachment", async () => {
    const result = await readIssueRequest(
      issueRequest(new File(["image"], "screen.png", { type: "image/png" })),
    );

    expect(result.input).toEqual({
      title: "Screenshot issue",
      description: "Please inspect the attachment",
      priority: 2,
      difficulty: null,
      assigneeUserId: null,
      status: "backlog",
      preferredProvider: null,
      preferredModel: null,
      preferredEffort: null,
      fullAuto: false,
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

  it("accepts SVG media and rejects oversized multipart bodies", async () => {
    const svg = await readIssueRequest(
      issueRequest(new File(["svg"], "diagram.svg", { type: "image/svg+xml" })),
    );
    expect(svg.attachments).toEqual([
      expect.objectContaining({
        name: "diagram.svg",
        type: "image/svg+xml",
      }),
    ]);
    await expect(
      readIssueRequest(
        issueRequest(new File(["document"], "unsafe.pdf", { type: "application/pdf" })),
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

  it.each([
    { name: "diagram.SVG", type: "" },
    { name: "diagram.svg", type: "application/octet-stream" },
    { name: "diagram.svg", type: "image/svg+xml; charset=utf-8" },
  ])("normalizes SVG MIME metadata from $type", async ({ name, type }) => {
    const result = await readIssueRequest(
      issueRequest(new File(["<svg />"], name, { type })),
    );

    expect(result.attachments).toEqual([
      expect.objectContaining({ name, type: "image/svg+xml" }),
    ]);
  });

  it("keeps existing PNG attachment behavior while normalizing generic MIME metadata", async () => {
    const result = await readIssueRequest(
      issueRequest(
        new File(["png"], "screen.PNG", { type: "application/octet-stream" }),
      ),
    );

    expect(result.attachments).toEqual([
      expect.objectContaining({ name: "screen.PNG", type: "image/png" }),
    ]);
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

describe("channel image multipart input", () => {
  it("parses image references and structured mentions", async () => {
    const reference = "7316678b-e3d4-4de3-a045-b76a0fc2e765";
    const clientMessageId = "33333333-3333-4333-8333-333333333333";
    const image = new File(["image"], "screen.png", { type: "image/png" });
    const form = new FormData();
    form.set("body", `Screenshot\n\n![screen.png](briar-attachment://${reference})`);
    form.set("parentMessageId", "11111111-1111-4111-8111-111111111111");
    form.set("clientMessageId", clientMessageId.toUpperCase());
    form.set("skillId", "44444444-4444-4444-8444-444444444444");
    form.set("mentionedUserIds", JSON.stringify(["owner"]));
    form.set(
      "mentionedAgentIds",
      JSON.stringify(["22222222-2222-4222-8222-222222222222"]),
    );
    form.set("attachmentReferences", JSON.stringify([reference]));
    form.append("attachments", image, image.name);
    const request = new Request("https://briar.example/channels/channel/messages", {
      method: "POST",
      headers: { "Content-Length": "2048" },
      body: form,
    });

    const result = await readChannelMessageRequest(request);

    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual(
      expect.objectContaining({
        name: "screen.png",
        type: "image/png",
        size: image.size,
      }),
    );
    expect(result.attachmentReferences).toEqual([reference]);
    expect(result.input).toMatchObject({
      clientMessageId,
      skillId: "44444444-4444-4444-8444-444444444444",
      parentMessageId: "11111111-1111-4111-8111-111111111111",
      mentionedUserIds: ["owner"],
      mentionedAgentIds: ["22222222-2222-4222-8222-222222222222"],
    });
  });

  it("rejects non-image channel attachments", async () => {
    const reference = "7316678b-e3d4-4de3-a045-b76a0fc2e765";
    const form = new FormData();
    form.set("body", `File\n\n![recording.mp4](briar-attachment://${reference})`);
    form.set("attachmentReferences", JSON.stringify([reference]));
    form.append(
      "attachments",
      new File(["video"], "recording.mp4", { type: "video/mp4" }),
    );
    const request = new Request("https://briar.example/channels/channel/messages", {
      method: "POST",
      headers: { "Content-Length": "2048" },
      body: form,
    });

    await expect(readChannelMessageRequest(request)).rejects.toThrow(
      "must be images",
    );
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
    form.set("difficulty", "hard");
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
          difficulty: "easy",
          assigneeUserId: null,
        }),
      }),
    );

    expect(result.input).toEqual({
      title: "Updated issue",
      description: null,
      priority: 2,
      difficulty: "easy",
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
      difficulty: "hard",
      assigneeUserId: "user-1",
    });
    expect(result.attachments).toEqual([
      expect.objectContaining({ name: "inline.png", type: "image/png" }),
    ]);
    expect(result.attachmentReferences).toEqual(["draft-update-1"]);
    expect(result.keptAttachmentIds).toEqual([existingAttachmentId]);
  });

  it("preserves omitted multipart patch fields", async () => {
    const form = new FormData();
    form.set("title", "Edited screenshot issue");
    form.append(
      "attachments",
      new File(["image"], "inline.png", { type: "image/png" }),
    );
    form.set("attachmentReferences", JSON.stringify(["draft-update-1"]));
    const result = await readIssueUpdateRequest(
      new Request("https://briar.example/projects/project/runs/run", {
        method: "PATCH",
        headers: { "Content-Length": "4096" },
        body: form,
      }),
    );

    expect(result.keptAttachmentIds).toBeUndefined();
    expect(result.input).not.toHaveProperty("assigneeUserId");
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
  const messageRequest = (
    file: File,
    reference = crypto.randomUUID(),
    clientMessageId = crypto.randomUUID(),
  ) => {
    const form = new FormData();
    form.set(
      "body",
      `확인해 주세요\n\n![${file.name}](briar-attachment://${reference})`,
    );
    form.set("parentMessageId", "");
    form.set("clientMessageId", clientMessageId.toUpperCase());
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
    const clientMessageId = crypto.randomUUID();
    const result = await readIssueMessageRequest(
      messageRequest(
        new File(["image"], "clipboard.png", { type: "image/png" }),
        reference,
        clientMessageId,
      ),
    );

    expect(result.input.clientMessageId).toBe(clientMessageId);
    expect(result.input.body).toContain(`briar-attachment://${reference}`);
    expect(result.attachments).toEqual([
      expect.objectContaining({ name: "clipboard.png", type: "image/png" }),
    ]);
    expect(result.attachmentReferences).toEqual([reference]);
  });

  it("canonicalizes uppercase agent UUIDs from iOS conversation requests", async () => {
    const mentionedAgentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const request = new Request(
      "https://briar.example/projects/project/runs/run/messages",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: "@developer 확인해 주세요",
          parentMessageId: null,
          mentionedUserIds: [],
          mentionedAgentIds: [mentionedAgentId.toUpperCase()],
          agentConversationId: null,
        }),
      },
    );

    const result = await readIssueMessageRequest(request);

    expect(result.input.mentionedAgentIds).toEqual([mentionedAgentId]);
  });

  it("rejects videos in issue conversations", async () => {
    await expect(
      readIssueMessageRequest(
        messageRequest(new File(["video"], "clip.mp4", { type: "video/mp4" })),
      ),
    ).rejects.toThrow("must be images");
  });
});
