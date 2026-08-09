import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  agentImageAttachments,
  readAgentImage,
} from "./runner-attachments";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("runner attachments", () => {
  it("normalizes downloaded images into provider-neutral attachments", () => {
    expect(
      agentImageAttachments([
        {
          filename: "screen.png",
          contentType: "image/png",
          localPath: "/tmp/screen.png",
        },
        {
          filename: "failed.jpg",
          contentType: "image/jpeg",
          localPath: null,
        },
        {
          filename: "clip.mp4",
          contentType: "video/mp4",
          localPath: "/tmp/clip.mp4",
        },
      ]),
    ).toEqual([
      {
        type: "image",
        path: "/tmp/screen.png",
        name: "screen.png",
        mimeType: "image/png",
      },
    ]);
  });

  it("reads a normalized image for provider-specific conversion", async () => {
    const directory = await mkdtemp(join(tmpdir(), "briar-runner-image-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "screen.png");
    await writeFile(path, Uint8Array.from([1, 2, 3]));

    await expect(
      readAgentImage({
        type: "image",
        path,
        name: "screen.png",
        mimeType: "image/png",
      }).then((bytes) => Array.from(bytes)),
    ).resolves.toEqual([1, 2, 3]);
  });
});
