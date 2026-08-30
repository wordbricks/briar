import { describe, expect, it, vi } from "vitest";
import { handleReplyAttachmentUploadRoute } from "./reply-attachment-upload-route";
import { ReplyCompletionApplicationError } from "./worker-reply-completion-application";

const attachmentId = "77777777-7777-4777-8777-777777777777";
const url = `https://briar.example/reply-attachment-uploads/${attachmentId}`;

describe("reply attachment raw upload boundary", () => {
  it("accepts bounded raw bytes once and keeps capability responses private", async () => {
    const upload = vi.fn().mockResolvedValue({ attachmentId });
    const body = new TextEncoder().encode("verified bytes");
    const response = await handleReplyAttachmentUploadRoute({
      request: new Request(url, {
        method: "PUT",
        headers: {
          authorization: "Bearer opaque-capability",
          "content-type": "text/html",
        },
        body,
      }),
      url: new URL(url),
      db: {} as D1Database,
      bucket: {} as R2Bucket,
      signingSecret: "test-secret",
    }, { uploadReplyAttachmentApplication: upload });

    expect(response).toMatchObject({ status: 204 });
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      attachmentId,
      capability: "opaque-capability",
      contentType: "text/html",
      body: expect.any(ArrayBuffer),
    }));
    expect(new TextDecoder().decode(
      upload.mock.calls[0]![0].body as ArrayBuffer,
    )).toBe("verified bytes");

    upload.mockRejectedValueOnce(new ReplyCompletionApplicationError(
      "invalid_capability",
      "Reply attachment upload capability is invalid or expired",
    ));
    const rejected = await handleReplyAttachmentUploadRoute({
      request: new Request(url, {
        method: "PUT",
        headers: {
          authorization: "Bearer expired-capability",
          "content-type": "text/html",
        },
        body,
      }),
      url: new URL(url),
      db: {} as D1Database,
      bucket: {} as R2Bucket,
      signingSecret: "test-secret",
    }, { uploadReplyAttachmentApplication: upload });
    expect(rejected).toMatchObject({ status: 401 });
    expect(rejected?.headers.get("cache-control")).toBe("private, no-store");
  });
});
