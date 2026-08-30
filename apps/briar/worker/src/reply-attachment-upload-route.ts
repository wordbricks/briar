import { corsHeaders, HttpError } from "./http-response";
import { rethrowReplyCompletionHttpError } from "./reply-completion-http-error";
import { uploadReplyAttachmentApplication } from "./worker-reply-completion-application";

const MAX_REPLY_ATTACHMENT_BYTES = 20 * 1_024 * 1_024;
const uploadPath = /^\/reply-attachment-uploads\/([^/]+)$/u;
const privateNoStoreHeaders = {
  ...corsHeaders,
  "Cache-Control": "private, no-store",
};

export type ReplyAttachmentUploadRouteServices = {
  uploadReplyAttachmentApplication: typeof uploadReplyAttachmentApplication;
};

const routeServices: ReplyAttachmentUploadRouteServices = {
  uploadReplyAttachmentApplication,
};

const boundedBody = async (request: Request) => {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      throw new HttpError(400, "Reply attachment Content-Length is invalid");
    }
    if (Number(declaredLength) > MAX_REPLY_ATTACHMENT_BYTES) {
      throw new HttpError(413, "Reply attachment is too large");
    }
  }
  if (!request.body) return new ArrayBuffer(0);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_REPLY_ATTACHMENT_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "Reply attachment is too large");
      }
      chunks.push(chunk.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
};

const errorResponse = (error: unknown) => {
  let mapped: unknown;
  try {
    rethrowReplyCompletionHttpError(error);
  } catch (cause) {
    mapped = cause;
  }
  if (mapped instanceof HttpError) {
    return Response.json(
      { message: mapped.message },
      { status: mapped.status, headers: privateNoStoreHeaders },
    );
  }
  throw mapped;
};

export async function handleReplyAttachmentUploadRoute(
  input: {
    request: Request;
    url: URL;
    db: D1Database;
    bucket: R2Bucket;
    signingSecret: string;
  },
  overrides: Partial<ReplyAttachmentUploadRouteServices> = {},
) {
  const match = uploadPath.exec(input.url.pathname);
  if (!match) return undefined;
  try {
    if (input.request.method !== "PUT") {
      return new Response(null, {
        status: 405,
        headers: { ...privateNoStoreHeaders, Allow: "PUT" },
      });
    }
    const contentEncoding = input.request.headers.get("content-encoding");
    if (contentEncoding && contentEncoding.toLowerCase() !== "identity") {
      throw new HttpError(415, "Encoded reply attachment bodies are unsupported");
    }
    const authorization = input.request.headers.get("authorization") ?? "";
    const capability = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    const body = await boundedBody(input.request);
    await (overrides.uploadReplyAttachmentApplication ??
      routeServices.uploadReplyAttachmentApplication)({
        db: input.db,
        bucket: input.bucket,
        signingSecret: input.signingSecret,
        attachmentId: match[1]!,
        capability,
        contentType: input.request.headers.get("content-type") ?? "",
        body,
      });
    return new Response(null, { status: 204, headers: privateNoStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
