import { describe, expect, it, vi } from "vitest";
import { handleUploadRoute } from "./upload-route";

const uploadId = "77777777-7777-4777-8777-777777777777";
const url = `https://briar.example/uploads/${uploadId}`;

describe("raw upload capability boundary", () => {
  it("authorizes before accepting bounded bytes and keeps responses private", async () => {
    const calls: string[] = [];
    const verify = vi.fn(async () => {
      calls.push("authorize");
      return { uploadId } as never;
    });
    const upload = vi.fn(async () => {
      calls.push("store");
      return { objectKey: "uploads/object", replayed: false };
    });
    const body = new TextEncoder().encode("verified bytes");
    const response = await handleUploadRoute({
      request: new Request(url, {
        method: "PUT",
        headers: {
          authorization: "Bearer opaque-capability",
          "content-type": "image/png",
        },
        body,
      }),
      url: new URL(url),
      db: {} as D1Database,
      bucket: {} as R2Bucket,
      signingSecret: "test-secret",
    }, {
      verifyUploadCapability: verify,
      uploadReservedFileApplication: upload,
    });

    expect(response).toMatchObject({ status: 204 });
    expect(response?.headers.get("cache-control")).toBe("private, no-store");
    expect(calls).toEqual(["authorize", "store"]);
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({
      uploadId,
      capability: "opaque-capability",
      contentType: "image/png",
      body: expect.any(ArrayBuffer),
    }));
  });

  it("rejects an invalid capability before invoking byte storage", async () => {
    const upload = vi.fn();
    const response = await handleUploadRoute({
      request: new Request(url, {
        method: "PUT",
        headers: { authorization: "Bearer forged" },
        body: new Uint8Array(1024),
      }),
      url: new URL(url),
      db: {} as D1Database,
      bucket: {} as R2Bucket,
      signingSecret: "test-secret",
    }, {
      verifyUploadCapability: vi.fn().mockResolvedValue(null),
      uploadReservedFileApplication: upload,
    });

    expect(response).toMatchObject({ status: 401 });
    expect(upload).not.toHaveBeenCalled();
  });
});
