export const issueAttachmentMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

// Wildcard media hints open the native photo picker on mobile platforms. The
// exact allowlist below remains authoritative when the selected files return.
export const issueAttachmentAccept = "image/*,video/*";
export const maxIssueAttachmentCount = 5;
export const maxIssueAttachmentBytes = 20 * 1024 * 1024;
export const maxIssueAttachmentTotalBytes = 25 * 1024 * 1024;
export const maxIssueMultipartBytes = maxIssueAttachmentTotalBytes + 1024 * 1024;

const allowedMimeTypes = new Set<string>(issueAttachmentMimeTypes);

const mimeTypesByExtension: Record<string, (typeof issueAttachmentMimeTypes)[number]> = {
  avif: "image/avif",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  m4v: "video/mp4",
  mov: "video/quicktime",
  mp4: "video/mp4",
  png: "image/png",
  webm: "video/webm",
  webp: "image/webp",
};

export type IssueAttachmentCandidate = {
  name: string;
  size: number;
  type: string;
};

/** Infer a supported media type from a filename when the browser omits File.type. */
export function issueAttachmentMimeTypeFromName(name: string): string | null {
  const extension = name.normalize("NFC").trim().split(".").pop()?.toLowerCase();
  if (!extension) return null;
  return mimeTypesByExtension[extension] ?? null;
}

/** True when content type or filename indicates an image preview is appropriate. */
export function isIssueAttachmentImage(
  contentType: string | null | undefined,
  filename: string,
): boolean {
  const normalizedType = contentType?.trim().toLowerCase() ?? "";
  if (normalizedType.startsWith("image/")) return true;
  const inferred = issueAttachmentMimeTypeFromName(filename);
  return inferred?.startsWith("image/") ?? false;
}

/**
 * OS file drops sometimes arrive with an empty MIME type even for valid media.
 * Fill in a supported type from the extension so validation and previews work.
 */
export function normalizeIssueAttachmentFile(file: File): File {
  if (file.type && allowedMimeTypes.has(file.type)) return file;
  if (file.type) return file;
  const inferred = issueAttachmentMimeTypeFromName(file.name);
  if (!inferred) return file;
  return new File([file], file.name, {
    lastModified: file.lastModified,
    type: inferred,
  });
}

/** Minimal DataTransfer shape so helpers stay usable outside DOM-only TS projects. */
export type IssueAttachmentDataTransferLike = {
  files?: ArrayLike<File> | null;
  items?: ArrayLike<{
    kind: string;
    getAsFile: () => File | null;
  }> | null;
  types?: ArrayLike<string> | null;
};

export function filesFromDataTransfer(
  dataTransfer: IssueAttachmentDataTransferLike | null | undefined,
): File[] {
  if (!dataTransfer) return [];
  const fromItems = Array.from(dataTransfer.items ?? [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
  const files =
    fromItems.length > 0 ? fromItems : Array.from(dataTransfer.files ?? []);
  return files.map(normalizeIssueAttachmentFile);
}

export function dataTransferHasFiles(
  dataTransfer: IssueAttachmentDataTransferLike | null | undefined,
): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types ?? []);
  if (types.includes("Files") || types.includes("application/x-moz-file")) {
    return true;
  }
  return Array.from(dataTransfer.items ?? []).some((item) => item.kind === "file");
}

export function validateIssueAttachments(
  attachments: readonly IssueAttachmentCandidate[],
): string | null {
  if (attachments.length > maxIssueAttachmentCount) {
    return `첨부 파일은 최대 ${maxIssueAttachmentCount}개까지 추가할 수 있습니다.`;
  }
  let totalBytes = 0;
  for (const attachment of attachments) {
    const name = attachment.name.normalize("NFC").trim();
    if (!name || name.length > 255 || name.includes("\0")) {
      return "첨부 파일 이름이 유효하지 않습니다.";
    }
    const type =
      attachment.type && allowedMimeTypes.has(attachment.type)
        ? attachment.type
        : issueAttachmentMimeTypeFromName(name) ?? attachment.type;
    if (!allowedMimeTypes.has(type)) {
      return `${name}은(는) 지원하지 않는 이미지·영상 형식입니다.`;
    }
    if (!Number.isSafeInteger(attachment.size) || attachment.size <= 0) {
      return `${name}은(는) 빈 파일이거나 크기를 확인할 수 없습니다.`;
    }
    if (attachment.size > maxIssueAttachmentBytes) {
      return `${name}은(는) 파일당 20MB 제한을 넘습니다.`;
    }
    totalBytes += attachment.size;
  }
  if (totalBytes > maxIssueAttachmentTotalBytes) {
    return "첨부 파일의 전체 크기는 25MB를 넘을 수 없습니다.";
  }
  return null;
}

export function formatAttachmentBytes(bytes: number) {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
