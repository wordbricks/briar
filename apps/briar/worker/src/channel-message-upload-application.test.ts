import { create } from "@bufbuild/protobuf";
import { UploadFileMetadataSchema } from "@briar/contracts/gen/briar/types/v1/upload_pb";
import { describe, expect, it, vi } from "vitest";
import { channelMessageUploadMetadata } from "./channel-message-upload-application";
import { uploadReservedFileApplication } from "./upload-application";

const attachment = (overrides: {
  filename?: string;
  contentType?: string;
  byteSize?: bigint;
} = {}) => create(UploadFileMetadataSchema, {
  clientId: crypto.randomUUID(),
  filename: overrides.filename ?? "brief.pdf",
  contentType: overrides.contentType ?? "application/pdf",
  byteSize: overrides.byteSize ?? 8n,
  sha256: new Uint8Array(32).fill(1),
});

describe("channel message upload policy", () => {
  it("accepts declared and extension-inferred PDFs", () => {
    expect(channelMessageUploadMetadata([attachment()]))
      .toMatchObject([{ contentType: "application/pdf" }]);
    expect(channelMessageUploadMetadata([
      attachment({ contentType: "", filename: "brief.PDF" }),
    ])).toMatchObject([{ contentType: "application/pdf" }]);
    expect(channelMessageUploadMetadata([
      attachment({ contentType: "application/octet-stream" }),
    ])).toMatchObject([{ contentType: "application/pdf" }]);
  });

  it("rejects unsupported, empty, and oversized files before reservation", () => {
    expect(() => channelMessageUploadMetadata([
      attachment({ filename: "notes.txt", contentType: "text/plain" }),
    ])).toThrow("images or PDFs");
    expect(() => channelMessageUploadMetadata([
      attachment({ byteSize: 0n }),
    ])).toThrow("빈 파일");
    expect(() => channelMessageUploadMetadata([
      attachment({ byteSize: BigInt(20 * 1024 * 1024 + 1) }),
    ])).toThrow("20MB");
    expect(() => channelMessageUploadMetadata([
      attachment({ filename: "part-1.pdf", byteSize: BigInt(13 * 1024 * 1024) }),
      attachment({ filename: "part-2.pdf", byteSize: BigInt(13 * 1024 * 1024) }),
    ])).toThrow("25MB");
  });

  it("rejects forged capabilities and tampered PDF bytes before storage", async () => {
    const body = new TextEncoder().encode("%PDF-1.7").buffer;
    const bucket = { put: vi.fn() } as unknown as R2Bucket;
    const getScopedUpload = vi.fn().mockResolvedValue({
      upload_id: "pdf-upload",
      batch_request_id: "pdf-batch",
      purpose: "channel_message",
      organization_id: "pdf-org",
      project_id: null,
      channel_id: "pdf-channel",
      user_id: "pdf-user",
      work_id: "pdf-message",
      run_id: null,
      worker_id: null,
      device_id: null,
      claim_token_hash: null,
      client_id: "pdf-client",
      filename: "brief.pdf",
      content_type: "application/pdf",
      byte_size: body.byteLength,
      sha256: new Uint8Array(32).fill(1).buffer,
      object_key: "channel-attachments/pdf-org/pdf-channel/pdf-message/pdf-upload",
      expires_at: "2099-01-01T00:00:00.000Z",
      uploaded_at: null,
      consumed_at: null,
      consumer_kind: null,
      consumer_id: null,
    });

    await expect(uploadReservedFileApplication({
      db: {} as D1Database,
      bucket,
      signingSecret: "secret",
      uploadId: "pdf-upload",
      capability: "forged",
      contentType: "application/pdf",
      body,
    }, {
      verifyUploadCapability: vi.fn().mockResolvedValue(null),
      getScopedUpload,
    })).rejects.toMatchObject({ reason: "invalid_capability" });
    expect(getScopedUpload).not.toHaveBeenCalled();

    await expect(uploadReservedFileApplication({
      db: {} as D1Database,
      bucket,
      signingSecret: "secret",
      uploadId: "pdf-upload",
      capability: "valid",
      contentType: "application/pdf",
      body,
    }, {
      verifyUploadCapability: vi.fn().mockResolvedValue({ uploadId: "pdf-upload" }),
      getScopedUpload,
      sha256Bytes: vi.fn().mockResolvedValue("00".repeat(32)),
    })).rejects.toMatchObject({ reason: "invalid_request" });
    expect(bucket.put).not.toHaveBeenCalled();
  });
});
