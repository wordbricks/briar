import { describe, expect, it, vi } from "vitest";
import {
  uploadStoredAttachments,
  type StoredAttachmentFile,
} from "./attachment-storage";

describe("attachment storage", () => {
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
