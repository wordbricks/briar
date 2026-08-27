import {
  issueAttachmentMimeTypeFromName,
  issueAttachmentMimeTypes,
  maxIssueAttachmentBytes,
  maxIssueAttachmentCount,
  maxIssueAttachmentTotalBytes,
  type IssueAttachmentCandidate,
} from "./issue-attachments";

export const htmlArtifactMimeType = "text/html";

const imageReplyMimeTypes = new Set<string>(
  issueAttachmentMimeTypes.filter((type) => type.startsWith("image/")),
);

const normalizedContentType = (contentType: string | null | undefined) =>
  contentType?.split(";", 1)[0]?.trim().toLowerCase() ?? "";

export function isHtmlArtifactAttachment(
  contentType: string | null | undefined,
  filename: string,
) {
  if (normalizedContentType(contentType) === htmlArtifactMimeType) return true;
  return /\.html?$/iu.test(filename.normalize("NFC").trim());
}

export function agentReplyAttachmentMimeTypeFromName(name: string) {
  if (isHtmlArtifactAttachment(null, name)) return htmlArtifactMimeType;
  const mediaType = issueAttachmentMimeTypeFromName(name);
  return mediaType && imageReplyMimeTypes.has(mediaType) ? mediaType : null;
}

export function normalizeAgentReplyAttachmentFile(file: File) {
  const declaredType = normalizedContentType(file.type);
  const type = declaredType === htmlArtifactMimeType || imageReplyMimeTypes.has(declaredType)
    ? declaredType
    : agentReplyAttachmentMimeTypeFromName(file.name);
  if (!type || type === file.type) return file;
  return new File([file], file.name, {
    lastModified: file.lastModified,
    type,
  });
}

export function validateAgentReplyAttachments(
  attachments: readonly IssueAttachmentCandidate[],
): string | null {
  if (attachments.length > maxIssueAttachmentCount) {
    return `Reply attachments are limited to ${maxIssueAttachmentCount} files.`;
  }
  let totalBytes = 0;
  for (const attachment of attachments) {
    const name = attachment.name.normalize("NFC").trim();
    if (!name || name.length > 255 || name.includes("\0")) {
      return "A reply attachment filename is invalid.";
    }
    const declaredType = normalizedContentType(attachment.type);
    const type = declaredType === htmlArtifactMimeType || imageReplyMimeTypes.has(declaredType)
      ? declaredType
      : agentReplyAttachmentMimeTypeFromName(name);
    if (!type) {
      return `${name} is unsupported. Reply attachments must be images or HTML files.`;
    }
    if (!Number.isSafeInteger(attachment.size) || attachment.size <= 0) {
      return `${name} is empty or its size cannot be determined.`;
    }
    if (attachment.size > maxIssueAttachmentBytes) {
      return `${name} exceeds the 20MB per-file limit.`;
    }
    totalBytes += attachment.size;
  }
  if (totalBytes > maxIssueAttachmentTotalBytes) {
    return "Reply attachments exceed the 25MB total limit.";
  }
  return null;
}

export const htmlArtifactContentSecurityPolicy = [
  "default-src 'none'",
  "img-src data: blob:",
  "media-src data: blob:",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "font-src data:",
  "connect-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const htmlArtifactCspMeta =
  `<meta http-equiv="Content-Security-Policy" content="${htmlArtifactContentSecurityPolicy}">`;

/** Parses the restrictive CSP before any untrusted artifact markup can execute. */
export function sandboxHtmlArtifactDocument(document: string) {
  return `<!doctype html>${htmlArtifactCspMeta}${document}`;
}
