import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectChannelReplyAttachments } from "./channel-reply-attachments";

const temporaryDirectories: string[] = [];

async function temporaryWorkspace() {
  const directory = await mkdtemp(join(tmpdir(), "briar-channel-reply-out-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    ),
  );
});

describe("channel reply attachments", () => {
  it("reads validated workspace images and HTML artifacts", async () => {
    const workspacePath = await temporaryWorkspace();
    await writeFile(
      join(workspacePath, "screenshot.png"),
      new Uint8Array([137, 80, 78, 71]),
    );
    await writeFile(join(workspacePath, "lesson.html"), "<h1>Lesson</h1>");

    await expect(collectChannelReplyAttachments({
      workspacePath,
      paths: ["screenshot.png", "lesson.html"],
    })).resolves.toEqual([
      expect.objectContaining({
        name: "screenshot.png",
        type: "image/png",
        size: 4,
      }),
      expect.objectContaining({
        name: "lesson.html",
        type: "text/html",
        size: 15,
      }),
    ]);
  });

  it("rejects missing, escaped, or unsupported workspace paths", async () => {
    const workspacePath = await temporaryWorkspace();
    await writeFile(join(workspacePath, "notes.txt"), "not an image");
    const nestedDirectory = join(workspacePath, "shots");
    await mkdir(nestedDirectory);
    const outside = join(
      tmpdir(),
      `briar-channel-reply-outside-${Date.now()}.png`,
    );
    temporaryDirectories.push(outside);
    await writeFile(outside, new Uint8Array([137, 80, 78, 71]));
    await symlink(outside, join(workspacePath, "escape.png"));

    await expect(collectChannelReplyAttachments({
      workspacePath,
      paths: ["missing.png"],
    })).rejects.toThrow("does not exist");
    await expect(collectChannelReplyAttachments({
      workspacePath,
      paths: ["notes.txt"],
    })).rejects.toThrow("must be images or HTML files");
    await expect(collectChannelReplyAttachments({
      workspacePath,
      paths: [outside],
    })).rejects.toThrow("outside the workspace");
    await expect(collectChannelReplyAttachments({
      workspacePath,
      paths: ["escape.png"],
    })).rejects.toThrow("outside the workspace");
    await expect(collectChannelReplyAttachments({
      workspacePath,
      paths: ["shots"],
    })).rejects.toThrow("not a file");
  });
});
