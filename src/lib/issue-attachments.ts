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

export type IssueAttachmentCandidate = {
  name: string;
  size: number;
  type: string;
};

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
    if (!allowedMimeTypes.has(attachment.type)) {
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
