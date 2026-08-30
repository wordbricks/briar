import {
  create,
  toBinary,
  type DescMessage,
} from "@bufbuild/protobuf";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import {
  CreateChannelMessageRequestSchema,
} from "@briar/contracts/gen/briar/app/v1/channel_pb";
import {
  IssueDifficulty,
  RunStatus,
} from "@briar/contracts/gen/briar/app/v1/common_pb";
import {
  CreateIssueMessageRequestSchema,
  CreateIssueRequestSchema,
  RunEvidence_Status,
  UpdateIssueRequestSchema,
} from "@briar/contracts/gen/briar/app/v1/issue_pb";
import {
  RecordRunEvidenceRequestSchema,
} from "@briar/contracts/gen/briar/worker/v1/worker_queue_pb";
import { describe, expect, it } from "vitest";
import { maxEvidenceMultipartBytes } from "../../src/lib/evidence-images";
import {
  readChannelMessageRequest,
  readIssueMessageRequest,
  readIssueRequest,
  readIssueUpdateRequest,
  readRunEvidenceRequest,
} from "./request-readers";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";
const runId = "33333333-3333-4333-8333-333333333333";
const organizationId = "44444444-4444-4444-8444-444444444444";
const channelId = "55555555-5555-4555-8555-555555555555";
const messageId = "66666666-6666-4666-8666-666666666666";
const parentMessageId = "77777777-7777-4777-8777-777777777777";
const agentId = "88888888-8888-4888-8888-888888888888";
const attachmentReference = "99999999-9999-4999-8999-999999999999";
const keptAttachmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function setProtobufRequest<Desc extends DescMessage>(
  form: FormData,
  schema: Desc,
  message: ReturnType<typeof create<Desc>>,
) {
  form.set(
    "request",
    new File([toBinary(schema, message)], "request.pb", {
      type: "application/protobuf",
    }),
  );
}

const image = () =>
  new File(["image"], "screen.png", { type: "image/png" });

const multipartRequest = (form: FormData, method = "POST") =>
  new Request("https://briar.example/multipart", {
    method,
    headers: { "Content-Length": "8192" },
    body: form,
  });

describe("protobuf multipart mutation boundary", () => {
  it("round-trips generated issue, update, issue-message, and channel-message requests", async () => {
    const createForm = new FormData();
    setProtobufRequest(
      createForm,
      CreateIssueRequestSchema,
      create(CreateIssueRequestSchema, {
        projectId,
        title: "Screenshot issue",
        description: "Please inspect the attachment",
        priority: 2,
        difficulty: IssueDifficulty.HARD,
        status: RunStatus.BACKLOG,
        attachmentReferences: [attachmentReference],
      }),
    );
    createForm.append("attachments", image(), "screen.png");
    const created = await readIssueRequest(multipartRequest(createForm), {
      projectId,
    });
    expect(created).toMatchObject({
      input: {
        title: "Screenshot issue",
        description: "Please inspect the attachment",
        priority: 2,
        difficulty: "hard",
        status: "backlog",
      },
      attachmentReferences: [attachmentReference],
    });
    expect(created.attachments).toEqual([
      expect.objectContaining({ name: "screen.png", type: "image/png" }),
    ]);

    const updateForm = new FormData();
    setProtobufRequest(
      updateForm,
      UpdateIssueRequestSchema,
      create(UpdateIssueRequestSchema, {
        projectId,
        runId,
        title: "Updated issue",
        description: "Updated description",
        difficulty: IssueDifficulty.NORMAL,
        assigneeUpdate: { case: "assigneeUserId", value: "user-1" },
        attachmentReferences: [attachmentReference],
        keptAttachmentIds: { values: [keptAttachmentId] },
      }),
    );
    updateForm.append("attachments", image(), "screen.png");
    const updated = await readIssueUpdateRequest(
      multipartRequest(updateForm, "PATCH"),
      { projectId, runId },
    );
    expect(updated.input).toMatchObject({
      title: "Updated issue",
      difficulty: "normal",
      assigneeUserId: "user-1",
    });
    expect(updated.keptAttachmentIds).toEqual([keptAttachmentId]);

    const body = `Screenshot\n\n![screen.png](briar-attachment://${attachmentReference})`;
    const issueMessageForm = new FormData();
    setProtobufRequest(
      issueMessageForm,
      CreateIssueMessageRequestSchema,
      create(CreateIssueMessageRequestSchema, {
        projectId,
        runId,
        clientMessageId: messageId.toUpperCase(),
        body,
        parentMessageId,
        mentionedUserIds: ["user-1"],
        mentionedAgentIds: [agentId.toUpperCase()],
        attachmentReferences: [attachmentReference],
      }),
    );
    issueMessageForm.append("attachments", image(), "screen.png");
    const issueMessage = await readIssueMessageRequest(
      multipartRequest(issueMessageForm),
      { projectId, runId },
    );
    expect(issueMessage.input).toMatchObject({
      clientMessageId: messageId,
      parentMessageId,
      mentionedUserIds: ["user-1"],
      mentionedAgentIds: [agentId],
    });

    const channelMessageForm = new FormData();
    setProtobufRequest(
      channelMessageForm,
      CreateChannelMessageRequestSchema,
      create(CreateChannelMessageRequestSchema, {
        organizationId,
        channelId,
        clientMessageId: messageId,
        body,
        parentMessageId,
        mentionedUserIds: ["user-1"],
        mentionedAgentIds: [agentId],
        attachmentReferences: [attachmentReference],
      }),
    );
    channelMessageForm.append("attachments", image(), "screen.png");
    const channelMessage = await readChannelMessageRequest(
      multipartRequest(channelMessageForm),
      { organizationId, channelId },
    );
    expect(channelMessage.input).toMatchObject({
      clientMessageId: messageId,
      parentMessageId,
      mentionedAgentIds: [agentId],
    });
    expect(channelMessage.attachmentReferences).toEqual([attachmentReference]);
  });

  it("rejects path identity mismatches before application mutation", async () => {
    const form = new FormData();
    setProtobufRequest(
      form,
      CreateIssueRequestSchema,
      create(CreateIssueRequestSchema, {
        projectId,
        title: "Wrong project",
        status: RunStatus.QUEUED,
      }),
    );
    form.append("attachments", image(), "screen.png");

    await expect(
      readIssueRequest(multipartRequest(form), { projectId: otherProjectId }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Multipart project ID does not match the request path",
    });
  });

  it("requires the generated protobuf request part and rejects unknown enums", async () => {
    const missing = new FormData();
    missing.append("attachments", image(), "screen.png");
    await expect(
      readIssueRequest(multipartRequest(missing), { projectId }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Multipart issue protobuf request is required",
    });

    const unknown = new FormData();
    setProtobufRequest(
      unknown,
      CreateIssueRequestSchema,
      create(CreateIssueRequestSchema, {
        projectId,
        title: "Unknown status",
        status: 99 as RunStatus,
      }),
    );
    unknown.append("attachments", image(), "screen.png");
    await expect(
      readIssueRequest(multipartRequest(unknown), { projectId }),
    ).rejects.toMatchObject({ status: 400, message: "Unknown run status" });
  });

  it("decodes generated run evidence metadata and image bytes once", async () => {
    const form = new FormData();
    setProtobufRequest(
      form,
      RecordRunEvidenceRequestSchema,
      create(RecordRunEvidenceRequestSchema, {
        projectId,
        runId,
        evidenceKey: "LOCAL-1:local_qa:screenshot",
        stage: "local_qa",
        type: "  signoff/app worker  ",
        status: RunEvidence_Status.PASSED,
        observedAt: timestampFromDate(
          new Date("2026-07-28T00:00:00.000Z"),
        ),
        actor: "briar-workflow",
        url: "https://example.com/evidence",
        metadata: { durationMs: 100 },
      }),
    );
    form.append("images", image(), "dashboard.png");

    const parsed = await readRunEvidenceRequest(multipartRequest(form), {
      projectId,
      runId,
    });

    expect(parsed.input).toEqual({
      evidenceKey: "LOCAL-1:local_qa:screenshot",
      stage: "local_qa",
      type: "signoff/app worker",
      status: "passed",
      observedAt: "2026-07-28T00:00:00.000Z",
      actor: "briar-workflow",
      detail: null,
      command: null,
      url: "https://example.com/evidence",
      metadata: { durationMs: 100 },
    });
    expect(parsed.images).toEqual([
      expect.objectContaining({ name: "dashboard.png", type: "image/png" }),
    ]);
  });

  it("rejects legacy evidence JSON, forged identity, and unsafe proto values", async () => {
    const legacy = new FormData();
    legacy.set("evidence", JSON.stringify({ status: "passed" }));
    await expect(
      readRunEvidenceRequest(multipartRequest(legacy), { projectId, runId }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Multipart run evidence protobuf request is required",
    });

    const forged = new FormData();
    setProtobufRequest(
      forged,
      RecordRunEvidenceRequestSchema,
      create(RecordRunEvidenceRequestSchema, {
        projectId: otherProjectId,
        runId,
      }),
    );
    await expect(
      readRunEvidenceRequest(multipartRequest(forged), { projectId, runId }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Multipart project ID does not match the request path",
    });

    const unsafe = new FormData();
    setProtobufRequest(
      unsafe,
      RecordRunEvidenceRequestSchema,
      create(RecordRunEvidenceRequestSchema, {
        projectId,
        runId,
        evidenceKey: "key",
        stage: "local_qa",
        type: "test",
        status: 99 as RunEvidence_Status,
        observedAt: timestampFromDate(new Date()),
        actor: "worker",
        url: "http://example.com/evidence",
      }),
    );
    await expect(
      readRunEvidenceRequest(multipartRequest(unsafe), { projectId, runId }),
    ).rejects.toMatchObject({
      status: 400,
      message: "Unknown evidence status",
    });

    const insecureUrl = new FormData();
    setProtobufRequest(
      insecureUrl,
      RecordRunEvidenceRequestSchema,
      create(RecordRunEvidenceRequestSchema, {
        projectId,
        runId,
        evidenceKey: "key",
        stage: "local_qa",
        type: "test",
        status: RunEvidence_Status.PASSED,
        observedAt: timestampFromDate(new Date()),
        actor: "worker",
        url: "http://example.com/evidence",
      }),
    );
    await expect(
      readRunEvidenceRequest(multipartRequest(insecureUrl), {
        projectId,
        runId,
      }),
    ).rejects.toThrow("HTTPS URL required");
  });
});

describe("multipart size boundary", () => {
  it("keeps the evidence upload size limit fail-closed", async () => {
    const request = new Request("https://briar.example/evidence", {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=invalid",
        "Content-Length": String(maxEvidenceMultipartBytes + 1),
      },
      body: "invalid",
    });
    await expect(
      readRunEvidenceRequest(request, { projectId, runId }),
    ).rejects.toMatchObject({
      status: 413,
      message: "Evidence images exceed the 25MB total limit",
    });
  });
});
