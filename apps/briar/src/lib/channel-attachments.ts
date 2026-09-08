import {
  issueAttachmentMimeTypeFromName,
  issueAttachmentMimeTypes,
  validateAttachments,
  type IssueAttachmentCandidate,
} from "./issue-attachments";

export const channelPdfContentType = "application/pdf";
export const channelAttachmentAccept = "image/*,application/pdf,.pdf,text/markdown,text/plain,.md,.txt";

export const channelAttachmentMimeTypes = [
  ...issueAttachmentMimeTypes.filter((contentType) =>
    contentType.startsWith("image/")
  ),
  channelPdfContentType,
  "text/markdown",
  "text/plain",
] as const;

const allowedMimeTypes = new Set<string>(channelAttachmentMimeTypes);

export function channelAttachmentMimeTypeFromName(name: string): string | null {
  const extension = name.normalize("NFC").trim().split(".").pop()?.toLowerCase();
  if (extension === "md") return "text/markdown";
  if (extension === "txt") return "text/plain";
  if (extension === "pdf") return channelPdfContentType;
  const inferred = issueAttachmentMimeTypeFromName(name);
  return inferred?.startsWith("image/") ? inferred : null;
}

export function isChannelAttachmentTypeSupported(contentType: string) {
  return allowedMimeTypes.has(contentType.trim().toLowerCase());
}

export function isChannelPdfAttachment(
  contentType: string | null | undefined,
  filename: string,
) {
  const normalizedType = contentType?.trim().toLowerCase() ?? "";
  return normalizedType === channelPdfContentType ||
    (!normalizedType && channelAttachmentMimeTypeFromName(filename) === channelPdfContentType);
}

// Text attachments are identified by their extension: browsers report Markdown
// as text/plain, text/x-markdown, octet-stream, or no MIME type at all.
export function normalizeChannelAttachmentContentType(value: string, filename: string): string | null {
  const declared = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  const inferred = channelAttachmentMimeTypeFromName(filename);
  if (inferred === "text/markdown" || inferred === "text/plain") return inferred;
  if (declared === "text/markdown" || declared === "text/plain") return null;
  // Preserve the existing image/PDF extension fallback for browser MIME aliases.
  return allowedMimeTypes.has(declared) ? declared : inferred;
}

export function isChannelTextAttachment(contentType: string | null | undefined, filename: string) {
  const type = normalizeChannelAttachmentContentType(contentType ?? "", filename);
  return type === "text/markdown" || type === "text/plain";
}

export function normalizeChannelAttachmentFile(file: File): File {
  const type = normalizeChannelAttachmentContentType(file.type, file.name);
  if (!type || type === file.type) return file;
  return new File([file], file.name, { lastModified: file.lastModified, type });
}

export function validateChannelAttachments(
  attachments: readonly IssueAttachmentCandidate[],
) {
  return validateAttachments(attachments.map((file) => ({
    ...file,
    name: file.name,
    size: file.size,
    type: normalizeChannelAttachmentContentType(file.type, file.name) ?? "",
  })), {
    allowedMimeTypes,
    mimeTypeFromName: () => null,
    unsupportedTypeMessage: (name) =>
      `${name}은(는) 지원하지 않는 형식입니다. 이미지, PDF, Markdown(.md) 또는 텍스트(.txt) 파일을 선택해 주세요.`,
  });
}
