import { access, readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, resolve } from "node:path";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";
import { channelReplyCompletionSchema } from "../src/lib/channels-contract";
import {
  issueAttachmentMimeTypeFromName,
  validateIssueAttachments,
} from "../src/lib/issue-attachments";
import { isPathWithinRoot } from "./worktree";

const maxChannelReplyAttachmentPathLength = 4096;

const ChannelReplyAttachmentPaths = Schema.mutable(
  Schema.Array(
    Schema.Trim.check(
      Schema.isLengthBetween(1, maxChannelReplyAttachmentPathLength),
    ),
  ),
).check(Schema.isMaxLength(5));

const decodeChannelReplyAttachmentPaths = Schema.decodeUnknownSync(
  ChannelReplyAttachmentPaths,
);
const decodeChannelReplyCompletion = Schema.decodeUnknownSync(
  channelReplyCompletionSchema,
);

type ChannelReplyCompletion = typeof channelReplyCompletionSchema.Type;

export function parseChannelReplyAgentResult(parsed: unknown): {
  result: ChannelReplyCompletion;
  attachmentPaths: string[];
} {
  if (!Predicate.isObject(parsed)) {
    return {
      result: decodeChannelReplyCompletion(parsed),
      attachmentPaths: [],
    };
  }
  if (parsed.contextRequests !== null && parsed.contextRequests !== undefined) {
    throw new Error("A completed channel reply cannot request more context");
  }
  const attachmentPaths = decodeChannelReplyAttachmentPaths(
    parsed.attachments ?? [],
  );
  const {
    attachments: _ignored,
    contextRequests: _contextRequests,
    ...rest
  } = parsed;
  return {
    result: decodeChannelReplyCompletion(rest),
    attachmentPaths,
  };
}

export function channelReplyCompleteRequestBody(input: {
  organizationId: string;
  workerId: string;
  claimToken: string;
  result: ChannelReplyCompletion;
  attachments: readonly File[];
}) {
  const payload = {
    organizationId: input.organizationId,
    workerId: input.workerId,
    claimToken: input.claimToken,
    result: input.result,
  };
  if (input.attachments.length === 0) return JSON.stringify(payload);
  const form = new FormData();
  form.append("complete", JSON.stringify(payload));
  for (const file of input.attachments) {
    form.append("attachments", file, file.name);
  }
  return form;
}

/**
 * Read reply images before the disposable workspace is deleted. Paths stay
 * inside that workspace so a model cannot attach an arbitrary host file.
 */
export async function collectChannelReplyAttachments(input: {
  workspacePath: string;
  paths: readonly string[];
}): Promise<File[]> {
  const files: File[] = [];
  for (const path of input.paths) {
    const resolved = isAbsolute(path)
      ? resolve(path)
      : resolve(input.workspacePath, path);
    try {
      await access(resolved);
    } catch {
      throw new Error(`Channel reply image does not exist: ${path}`);
    }
    if (!isPathWithinRoot(resolved, input.workspacePath)) {
      throw new Error(`Channel reply image is outside the workspace: ${path}`);
    }
    const fileStat = await stat(resolved);
    if (!fileStat.isFile()) {
      throw new Error(`Channel reply image is not a file: ${path}`);
    }
    const filename = basename(resolved).normalize("NFC").trim();
    const type = issueAttachmentMimeTypeFromName(filename) ?? "";
    if (!type.startsWith("image/")) {
      throw new Error(`Channel reply attachments must be images: ${path}`);
    }
    files.push(new File([await readFile(resolved)], filename, { type }));
  }
  const validationError = validateIssueAttachments(files);
  if (validationError) throw new Error(validationError);
  return files;
}
