export const MAX_TRANSCRIPT_PAYLOAD_BYTES = 32 * 1024;
export const MAX_TRANSCRIPT_EVENTS_PER_REQUEST = 200;

/** Sum of serialized event payload bytes, excluding the request envelope. */
export const MAX_TRANSCRIPT_REQUEST_BYTES = 1024 * 1024;

/** Allows the payload budget plus JSON event and request envelope overhead. */
export const MAX_TRANSCRIPT_HTTP_BODY_BYTES =
  MAX_TRANSCRIPT_REQUEST_BYTES + 64 * 1024;
