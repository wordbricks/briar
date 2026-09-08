import { strFromU8, strToU8, unzlibSync, zlibSync } from "fflate";

const binaryChunkSize = 0x8000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += binaryChunkSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + binaryChunkSize),
    );
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Encodes JSON into a compact string suitable for WebKit localStorage. */
export function encodeCompressedJson(value: unknown): string {
  return bytesToBase64(zlibSync(strToU8(JSON.stringify(value)), { level: 6 }));
}

/** Decodes a value produced by {@link encodeCompressedJson}. */
export function decodeCompressedJson(value: string): unknown {
  return JSON.parse(strFromU8(unzlibSync(base64ToBytes(value))));
}
