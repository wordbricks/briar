import { describe, expect, it, vi } from "vitest";
import {
  prepareStoredAttachments,
  uploadStoredAttachments,
  type StoredAttachmentFile,
} from "./attachment-storage";

describe("attachment storage", () => {
  it("prepares normalized attachment metadata while leaving identity to the caller", () => {
    const first = new File(["first"], " e\u0301vidence.png ", {
      type: "image/png",
    });
    const second = new File(["second"], "clip.mp4", { type: "video/mp4" });

    const attachments = prepareStoredAttachments(
      [first, second],
      (_file, position) => ({
        id: `attachment-${position}`,
        object_key: `caller-namespace/owner/attachment-${position}`,
        organization_id: "organization-1",
      }),
    );

    expect(attachments).toEqual([
      {
        id: "attachment-0",
        object_key: "caller-namespace/owner/attachment-0",
        organization_id: "organization-1",
        filename: "évidence.png",
        content_type: "image/png",
        byte_size: first.size,
        file: first,
      },
      {
        id: "attachment-1",
        object_key: "caller-namespace/owner/attachment-1",
        organization_id: "organization-1",
        filename: "clip.mp4",
        content_type: "video/mp4",
        byte_size: second.size,
        file: second,
      },
    ]);
  });

  it("uploads sequentially with caller metadata and records keys after success", async () => {
    const put = vi.fn(
      async (_key: string, _value: unknown, _options?: unknown) => null,
    );
    const attachments: StoredAttachmentFile[] = [
      {
        id: "attachment-1",
        object_key: "issues/run/attachment-1",
        filename: "report (1)'*.png",
        content_type: "image/png",
        byte_size: 3,
        file: new File(["one"], "report (1)'*.png", { type: "image/png" }),
      },
      {
        id: "attachment-2",
        object_key: "issues/run/attachment-2",
        filename: "second.png",
        content_type: "image/png",
        byte_size: 3,
        file: new File(["two"], "second.png", { type: "image/png" }),
      },
    ];
    const uploadedKeys: string[] = [];

    await uploadStoredAttachments(
      { put } as unknown as Pick<R2Bucket, "put">,
      attachments,
      uploadedKeys,
      (attachment) => ({
        attachmentId: attachment.id,
        owner: "run-1",
      }),
    );

    expect(put.mock.calls.map(([key]) => key)).toEqual([
      "issues/run/attachment-1",
      "issues/run/attachment-2",
    ]);
    expect(put.mock.calls[0]?.[2]).toEqual({
      httpMetadata: {
        contentType: "image/png",
        contentDisposition:
          "inline; filename*=UTF-8''report%20%281%29%27%2A.png",
      },
      customMetadata: { attachmentId: "attachment-1", owner: "run-1" },
    });
    expect(uploadedKeys).toEqual([
      "issues/run/attachment-1",
      "issues/run/attachment-2",
    ]);
  });

  it("stops on failure and exposes only completed uploads for caller cleanup", async () => {
    const failure = new Error("R2 put failed");
    let attempts = 0;
    const put = vi.fn(async () => {
      attempts += 1;
      if (attempts === 2) throw failure;
      return null;
    });
    const attachments = ["first", "second", "third"].map(
      (id): StoredAttachmentFile => ({
        id,
        object_key: `issues/run/${id}`,
        filename: `${id}.png`,
        content_type: "image/png",
        byte_size: id.length,
        file: new File([id], `${id}.png`, { type: "image/png" }),
      }),
    );
    const uploadedKeys: string[] = [];

    await expect(
      uploadStoredAttachments(
        { put } as unknown as Pick<R2Bucket, "put">,
        attachments,
        uploadedKeys,
        (attachment) => ({ attachmentId: attachment.id }),
      ),
    ).rejects.toBe(failure);

    expect(put).toHaveBeenCalledTimes(2);
    expect(uploadedKeys).toEqual(["issues/run/first"]);
  });
});
