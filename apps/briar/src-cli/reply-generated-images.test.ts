import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { ReplyGeneratedImageCollector } from "./reply-generated-images";

const png = Buffer.from([137, 80, 78, 71]);

const completedImage = (result: string) => ({
  type: "event",
  raw: {
    method: "item/completed",
    params: {
      item: {
        id: "image-1",
        type: "imageGeneration",
        status: "completed",
        result,
      },
    },
  },
});

describe("generated reply images", () => {
  it("collects raw base64 image-generation results", () => {
    const collector = new ReplyGeneratedImageCollector();
    collector.observePayload(completedImage(png.toString("base64")));

    expect(collector.files()).toHaveLength(1);
    expect(collector.files()[0]).toMatchObject({
      name: "generated-image-1.png",
      type: "image/png",
      size: png.byteLength,
    });
  });

  it("preserves the image type from data URLs", () => {
    const collector = new ReplyGeneratedImageCollector();
    collector.observePayload(
      completedImage(`data:image/jpeg;base64,${png.toString("base64")}`),
    );

    expect(collector.files()[0]).toMatchObject({
      name: "generated-image-1.jpg",
      type: "image/jpeg",
    });
  });

  it("ignores unrelated and incomplete provider events", () => {
    const collector = new ReplyGeneratedImageCollector();
    collector.observePayload({ type: "event", raw: { method: "turn/started" } });
    collector.observePayload({
      type: "event",
      raw: {
        method: "item/completed",
        params: {
          item: {
            type: "imageGeneration",
            status: "failed",
            result: png.toString("base64"),
          },
        },
      },
    });

    expect(collector.files()).toEqual([]);
  });
});
