import { access, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import * as Schema from "effect/Schema";
import {
  issueAttachmentMimeTypeFromName,
  validateIssueAttachments,
} from "../src/lib/issue-attachments";
import { isPathWithinRoot } from "./worktree";

const maxReplyAttachmentPathLength = 4096;

const ReplyAttachmentPaths = Schema.mutable(
  Schema.Array(
    Schema.Trim.check(
      Schema.isLengthBetween(1, maxReplyAttachmentPathLength),
    ),
  ),
).check(Schema.isMaxLength(5));

const decodeAttachmentPaths = Schema.decodeUnknownSync(ReplyAttachmentPaths);

export function decodeReplyAttachmentPaths(value: unknown): string[] {
  return decodeAttachmentPaths(value ?? []);
}

export function validateReplyAttachments(
  attachments: readonly File[],
  replyLabel: string,
): File[] {
  if (attachments.some((attachment) => !attachment.type.startsWith("image/"))) {
    throw new Error(`${replyLabel} attachments must be images`);
  }
  const validationError = validateIssueAttachments(attachments);
  if (validationError) throw new Error(validationError);
  return [...attachments];
}

export function replyCompleteRequestBody(input: {
  payload: Record<string, unknown>;
  attachments: readonly File[];
}) {
  if (input.attachments.length === 0) return JSON.stringify(input.payload);
  const form = new FormData();
  form.append("complete", JSON.stringify(input.payload));
  for (const file of input.attachments) {
    form.append("attachments", file, file.name);
  }
  return form;
}

/**
 * Read reply images before a disposable workspace is deleted. Paths must stay
 * inside that workspace so provider output cannot attach arbitrary host files.
 */
export async function collectReplyAttachments(input: {
  workspacePath: string;
  paths: readonly string[];
  replyLabel: string;
}): Promise<File[]> {
  const files: File[] = [];
  for (const path of input.paths) {
    const resolved = isAbsolute(path)
      ? resolve(path)
      : resolve(input.workspacePath, path);
    try {
      await access(resolved);
    } catch {
      throw new Error(`${input.replyLabel} image does not exist: ${path}`);
    }
    if (!isPathWithinRoot(resolved, input.workspacePath)) {
      throw new Error(`${input.replyLabel} image is outside the workspace: ${path}`);
    }
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      throw new Error(`${input.replyLabel} image is not a file: ${path}`);
    }
    const filename = basename(resolved).normalize("NFC").trim();
    const type = issueAttachmentMimeTypeFromName(filename) ?? "";
    if (!type.startsWith("image/")) {
      throw new Error(`${input.replyLabel} attachments must be images: ${path}`);
    }
    files.push(new File([await readFile(resolved)], filename, { type }));
  }
  return validateReplyAttachments(files, input.replyLabel);
}
