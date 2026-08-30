import {
  toBinary,
  type DescMessage,
} from "@bufbuild/protobuf";
import { cors } from "@connectrpc/connect";

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

export const corsHeaders = {
  "Access-Control-Allow-Headers": [...allowedHeaders].join(", "),
  "Access-Control-Allow-Methods":
    "DELETE, GET, HEAD, PATCH, POST, PUT, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": [...exposedHeaders].join(", "),
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
