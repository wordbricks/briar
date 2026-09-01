import { Buffer } from "node:buffer";
import type { RunnerToParent } from "@briar/contracts/gen/briar/sidecar/v1/agent_runner_pb";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { sidecarProviderRaw } from "../src-agent/sidecar-protocol";

const preserveExcessProperties = {
  onExcessProperty: "preserve",
} as const;

const CompletedImageGenerationPayload = Schema.Struct({
  type: Schema.Literal("event"),
  raw: Schema.Struct({
    method: Schema.Literal("item/completed"),
    params: Schema.Struct({
      item: Schema.Struct({
        type: Schema.Literal("imageGeneration"),
        status: Schema.Literal("completed"),
        result: Schema.String,
      }).annotate({ parseOptions: preserveExcessProperties }),
    }).annotate({ parseOptions: preserveExcessProperties }),
  }).annotate({ parseOptions: preserveExcessProperties }),
}).annotate({ parseOptions: preserveExcessProperties });

const decodeCompletedImageGeneration = Schema.decodeUnknownOption(
  CompletedImageGenerationPayload,
);

const dataUrlPattern = /^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/iu;

function decodedGeneratedImage(result: string) {
  const dataUrl = result.match(dataUrlPattern);
  const contentType = dataUrl?.[1]?.toLowerCase() ?? "image/png";
  const encoded = dataUrl?.[2] ?? result;
  const bytes = Buffer.from(encoded.replaceAll(/\s/gu, ""), "base64");
  if (bytes.byteLength === 0) {
    throw new Error("Generated reply image is empty");
  }
  return { bytes, contentType };
}

/** Collect images returned directly by provider image-generation tools. */
export class ReplyGeneratedImageCollector {
  readonly #files: File[] = [];

  observePayload(payload: unknown) {
    const projected =
      payload && typeof payload === "object" && "$typeName" in payload &&
        payload.$typeName === "briar.sidecar.v1.RunnerToParent"
        ? {
            type: "event",
            raw: sidecarProviderRaw(payload as RunnerToParent),
          }
        : payload;
    const decoded = decodeCompletedImageGeneration(projected);
    if (Option.isNone(decoded)) return;
    const image = decodedGeneratedImage(decoded.value.raw.params.item.result);
    const extension = image.contentType === "image/jpeg"
      ? "jpg"
      : image.contentType.slice("image/".length);
    this.#files.push(
      new File(
        [image.bytes],
        `generated-image-${this.#files.length + 1}.${extension}`,
        { type: image.contentType },
      ),
    );
  }

  files() {
    return [...this.#files];
  }
}
