import {
  toBinary,
  type DescMessage,
} from "@bufbuild/protobuf";
import { cors } from "@connectrpc/connect";
import { isTrustedAuthOrigin } from "./auth-origins";

const allowedHeaders = new Set([
  ...cors.allowedHeaders.map((header) => header.toLowerCase()),
  "authorization",
  "idempotency-key",
  "if-none-match",
  "x-briar-claim-token",
  "x-briar-channel-claim-token",
  "x-briar-worker-lifecycle-reason",
]);

const exposedHeaders = new Set([
  ...cors.exposedHeaders,
  "ETag",
]);

const baseCorsHeaders = {
  "Access-Control-Allow-Headers": [...allowedHeaders].join(", "),
  "Access-Control-Allow-Methods":
    "DELETE, GET, HEAD, PATCH, POST, PUT, OPTIONS",
  "Access-Control-Expose-Headers": [...exposedHeaders].join(", "),
};

export const corsHeaders = {
  ...baseCorsHeaders,
  "Access-Control-Allow-Origin": "*",
};

export const credentialedAuthCorsHeaders = (
  request: Request,
): Headers => {
  const headers = new Headers(baseCorsHeaders);
  const origin = request.headers.get("origin");
  if (
    origin &&
    isTrustedAuthOrigin(origin, new URL(request.url).origin)
  ) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Credentials", "true");
  }
  headers.set("Vary", "Origin");
  return headers;
};

export const withCredentialedAuthCorsHeaders = (
  request: Request,
  response: Response,
): Response => {
  const headers = new Headers(response.headers);
  const cors = credentialedAuthCorsHeaders(request);
  for (const [name, value] of cors) {
    if (name.toLowerCase() === "vary" && headers.has(name)) {
      headers.set(name, `${headers.get(name)}, ${value}`);
    } else {
      headers.set(name, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const withCorsHeaders = (response: Response): Response => {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

export const privateNoStoreProtobufResponse = <Desc extends DescMessage>(
  schema: Desc,
  body: Parameters<typeof toBinary<Desc>>[1],
  status = 200,
) =>
  new Response(toBinary(schema, body), {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-store",
      "Content-Type": "application/protobuf",
    },
  });

export const privateNoStoreJson = (body: unknown) =>
  Response.json(body, {
    headers: {
      ...corsHeaders,
      "Cache-Control": "private, no-store",
    },
  });

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}
