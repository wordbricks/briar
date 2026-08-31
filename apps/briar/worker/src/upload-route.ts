import { corsHeaders, HttpError } from "./http-response";
import {
  uploadReservedFileApplication,
  UploadApplicationError,
} from "./upload-application";
import { verifyUploadCapability } from "./upload-capability";

const MAX_UPLOAD_BYTES = 20 * 1_024 * 1_024;
const uploadPath = /^\/uploads\/([^/]+)$/u;
const privateNoStoreHeaders = {
  ...corsHeaders,
  "Cache-Control": "private, no-store",
};

export type UploadRouteServices = {
  uploadReservedFileApplication: typeof uploadReservedFileApplication;
  verifyUploadCapability: typeof verifyUploadCapability;
};

const routeServices: UploadRouteServices = {
  uploadReservedFileApplication,
  verifyUploadCapability,
};

const boundedBody = async (request: Request) => {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/u.test(declaredLength)) {
      throw new HttpError(400, "Upload Content-Length is invalid");
    }
    if (Number(declaredLength) > MAX_UPLOAD_BYTES) {
      throw new HttpError(413, "Upload is too large");
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
      if (byteLength > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new HttpError(413, "Upload is too large");
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
  const mapped = error instanceof UploadApplicationError
    ? new HttpError(
        error.reason === "invalid_capability"
          ? 401
          : error.reason === "unavailable"
          ? 409
          : 400,
        error.message,
      )
    : error;
  if (mapped instanceof HttpError) {
    return Response.json(
      { message: mapped.message },
      { status: mapped.status, headers: privateNoStoreHeaders },
    );
  }
  throw mapped;
};

export async function handleUploadRoute(
  input: {
    request: Request;
    url: URL;
    db: D1Database;
    bucket: R2Bucket;
    signingSecret: string;
  },
  overrides: Partial<UploadRouteServices> = {},
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
      throw new HttpError(415, "Encoded upload bodies are unsupported");
    }
    const authorization = input.request.headers.get("authorization") ?? "";
    const capability = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    const uploadId = match[1]!;
    const validCapability = await (overrides.verifyUploadCapability ??
      routeServices.verifyUploadCapability)(
        input.signingSecret,
        capability,
        uploadId,
      );
    if (!validCapability) {
      throw new UploadApplicationError(
        "invalid_capability",
        "Upload capability is invalid or expired",
      );
    }
    const body = await boundedBody(input.request);
    await (overrides.uploadReservedFileApplication ??
      routeServices.uploadReservedFileApplication)({
        db: input.db,
        bucket: input.bucket,
        signingSecret: input.signingSecret,
        uploadId,
        capability,
        contentType: input.request.headers.get("content-type") ?? "",
        body,
      });
    return new Response(null, { status: 204, headers: privateNoStoreHeaders });
  } catch (error) {
    return errorResponse(error);
  }
}
