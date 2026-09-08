import { describe, expect, it } from "vitest";
import {
  maxImageHeaderBytes,
  parseImageDimensions,
  readLimitedBytes,
} from "./image-dimensions";

const bytes = (...values: number[]) => new Uint8Array(values);

const concat = (...parts: Uint8Array[]) => {
  const total = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
};

const ascii = (value: string) =>
  new Uint8Array([...value].map((char) => char.charCodeAt(0)));

const uint32BE = (value: number) =>
  bytes(value >>> 24, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);

const uint16LE = (value: number) => bytes(value & 0xff, (value >>> 8) & 0xff);

const uint24LE = (value: number) =>
  bytes(value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff);

const png = (width: number, height: number) =>
  concat(
    bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a),
    uint32BE(13),
    ascii("IHDR"),
    uint32BE(width),
    uint32BE(height),
    bytes(8, 6, 0, 0, 0),
  );

const gif = (width: number, height: number) =>
  concat(ascii("GIF89a"), uint16LE(width), uint16LE(height), bytes(0xf7, 0, 0));

const jpegSegment = (marker: number, payload: Uint8Array) =>
  concat(bytes(0xff, marker), uint16BE(payload.byteLength + 2), payload);

function uint16BE(value: number) {
  return bytes((value >>> 8) & 0xff, value & 0xff);
}

const jpeg = (width: number, height: number, marker = 0xc0) =>
  concat(
    bytes(0xff, 0xd8),
    // A realistic file puts APP0/APP1 metadata ahead of the frame header.
    jpegSegment(0xe0, concat(ascii("JFIF\0"), bytes(1, 1, 0, 0, 1, 0, 1, 0, 0))),
    jpegSegment(0xdb, new Uint8Array(65)),
    jpegSegment(
      marker,
      concat(bytes(8), uint16BE(height), uint16BE(width), bytes(3)),
    ),
  );

const webpContainer = (chunk: string, payload: Uint8Array) =>
  concat(
    ascii("RIFF"),
    bytes(0, 0, 0, 0),
    ascii("WEBP"),
    ascii(chunk),
    bytes(0, 0, 0, 0),
    payload,
  );

const webpLossy = (width: number, height: number) =>
  webpContainer(
    "VP8 ",
    concat(
      bytes(0, 0, 0),
      bytes(0x9d, 0x01, 0x2a),
      uint16LE(width),
      uint16LE(height),
    ),
  );

const webpLossless = (width: number, height: number) =>
  webpContainer(
    "VP8L",
    concat(
      bytes(0x2f),
      new Uint8Array(
        new Uint32Array([
          (width - 1) | ((height - 1) << 14),
        ]).buffer,
      ),
    ),
  );

const webpExtended = (width: number, height: number) =>
  webpContainer(
    "VP8X",
    concat(bytes(0x10, 0, 0, 0), uint24LE(width - 1), uint24LE(height - 1)),
  );

describe("image header dimension parsing", () => {
  it("reads PNG, GIF, JPEG, and every WebP flavour", () => {
    expect(parseImageDimensions(png(1_200, 630)))
      .toEqual({ width: 1_200, height: 630 });
    expect(parseImageDimensions(gif(320, 240)))
      .toEqual({ width: 320, height: 240 });
    expect(parseImageDimensions(jpeg(1_920, 1_080)))
      .toEqual({ width: 1_920, height: 1_080 });
    // Progressive JPEGs announce themselves with SOF2 instead of SOF0.
    expect(parseImageDimensions(jpeg(800, 600, 0xc2)))
      .toEqual({ width: 800, height: 600 });
    expect(parseImageDimensions(webpLossy(1_024, 512)))
      .toEqual({ width: 1_024, height: 512 });
    expect(parseImageDimensions(webpLossless(64, 48)))
      .toEqual({ width: 64, height: 48 });
    expect(parseImageDimensions(webpExtended(2_000, 1_000)))
      .toEqual({ width: 2_000, height: 1_000 });
  });

  it("returns null for truncated, foreign, and zero-sized bodies", () => {
    expect(parseImageDimensions(new Uint8Array(0))).toBeNull();
    expect(parseImageDimensions(png(1_200, 630).slice(0, 20))).toBeNull();
    expect(parseImageDimensions(png(0, 0))).toBeNull();
    expect(parseImageDimensions(ascii("<html><head><title>Not an image"))) 
      .toBeNull();
    expect(parseImageDimensions(concat(bytes(0xff, 0xd8), new Uint8Array(64))))
      .toBeNull();
    // A RIFF container Briar cannot decode must not guess a size.
    expect(parseImageDimensions(webpContainer("ANIM", new Uint8Array(32))))
      .toBeNull();
  });

  it("respects a byte budget when the server ignores the range request", async () => {
    const body = new Uint8Array(maxImageHeaderBytes * 2).fill(7);
    const read = await readLimitedBytes(
      new Response(body),
      maxImageHeaderBytes,
    );
    expect(read.byteLength).toBe(maxImageHeaderBytes);
  });

  it("keeps a short body intact", async () => {
    const read = await readLimitedBytes(
      new Response(png(10, 20)),
      maxImageHeaderBytes,
    );
    expect(parseImageDimensions(read)).toEqual({ width: 10, height: 20 });
  });
});
