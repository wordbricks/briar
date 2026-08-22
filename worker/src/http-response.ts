export const corsHeaders = {
  "Access-Control-Allow-Headers":
    "authorization, content-type, idempotency-key, if-none-match, x-briar-claim-token, x-briar-channel-claim-token",
  "Access-Control-Allow-Methods":
    "DELETE, GET, HEAD, PATCH, POST, PUT, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Expose-Headers": "ETag",
};

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: corsHeaders });

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
