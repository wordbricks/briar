export type ImageDimensions = { readonly width: number; readonly height: number };

/*
  Most sites publish og:image without og:image:width/height, so the link preview
  card has no height to reserve until the browser has downloaded the picture.
  Every container format states its pixel size in a small fixed header, so a
  ranged read of the first bytes is enough to answer the question the meta tags
  left open.
*/
export const maxImageHeaderBytes = 64 * 1_024;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length &&
  signature.every((byte, index) => bytes[offset + index] === byte);

const ascii = (value: string) => [...value].map((char) => char.charCodeAt(0));

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const gifSignature = ascii("GIF8");
const riffSignature = ascii("RIFF");
const webpSignature = ascii("WEBP");

const positive = (dimensions: ImageDimensions | null) =>
  dimensions && dimensions.width > 0 && dimensions.height > 0 ? dimensions : null;

function parsePng(view: DataView, bytes: Uint8Array): ImageDimensions | null {
  // Signature, then an 8 byte IHDR chunk header, then width and height.
  if (!startsWith(bytes, pngSignature) || bytes.length < 24) return null;
  if (String.fromCharCode(...bytes.slice(12, 16)) !== "IHDR") return null;
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

function parseGif(view: DataView, bytes: Uint8Array): ImageDimensions | null {
  // "GIF87a"/"GIF89a" followed by the little-endian logical screen size.
  if (!startsWith(bytes, gifSignature) || bytes.length < 10) return null;
  return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
}

function parseWebp(view: DataView, bytes: Uint8Array): ImageDimensions | null {
  if (!startsWith(bytes, riffSignature) || !startsWith(bytes, webpSignature, 8)) {
    return null;
  }
  const chunk = bytes.length >= 16 ? String.fromCharCode(...bytes.slice(12, 16)) : "";
  if (chunk === "VP8 ") {
    // Lossy keyframe: a three byte start code guards the 14 bit dimensions.
    if (bytes.length < 30) return null;
    if (!startsWith(bytes, [0x9d, 0x01, 0x2a], 23)) return null;
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L") {
    // Lossless: 14 bits of width then 14 bits of height, both stored minus one.
    if (bytes.length < 25 || bytes[20] !== 0x2f) return null;
    const packed = view.getUint32(21, true);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
    };
  }
  if (chunk === "VP8X") {
    // Extended: a 24 bit little-endian canvas size, also stored minus one.
    if (bytes.length < 30) return null;
    const readUint24 = (offset: number) =>
      (bytes[offset] ?? 0) |
      ((bytes[offset + 1] ?? 0) << 8) |
      ((bytes[offset + 2] ?? 0) << 16);
    return { width: readUint24(24) + 1, height: readUint24(27) + 1 };
  }
  return null;
}

const jpegStartOfFrameMarkers = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7,
  0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function parseJpeg(view: DataView, bytes: Uint8Array): ImageDimensions | null {
  if (!startsWith(bytes, [0xff, 0xd8])) return null;
  let offset = 2;
  while (offset + 1 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    // Padding and standalone markers carry no length field.
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (offset + 3 >= bytes.length) return null;
    const length = view.getUint16(offset + 2);
    if (length < 2) return null;
    if (jpegStartOfFrameMarkers.has(marker)) {
      if (offset + 9 > bytes.length) return null;
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
    }
    offset += 2 + length;
  }
  return null;
}

/** Reads pixel dimensions from a PNG, JPEG, WebP, or GIF header prefix. */
export function parseImageDimensions(bytes: Uint8Array): ImageDimensions | null {
  if (bytes.byteLength < 10) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return positive(
    parsePng(view, bytes) ??
      parseGif(view, bytes) ??
      parseWebp(view, bytes) ??
      parseJpeg(view, bytes),
  );
}

/** Reads at most `limit` bytes from a response body, cancelling the rest. */
export async function readLimitedBytes(response: Response, limit: number) {
  if (!response.body) {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer.slice(0, limit));
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const result = await reader.read();
      if (result.done) break;
      chunks.push(result.value);
      total += result.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(Math.min(total, limit));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= bytes.byteLength) break;
    const slice = chunk.subarray(0, bytes.byteLength - offset);
    bytes.set(slice, offset);
    offset += slice.byteLength;
  }
  return bytes;
}
