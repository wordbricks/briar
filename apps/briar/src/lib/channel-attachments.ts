import {
  issueAttachmentMimeTypeFromName,
  issueAttachmentMimeTypes,
  validateAttachments,
  type IssueAttachmentCandidate,
} from "./issue-attachments";

export const channelPdfContentType = "application/pdf";
export const channelAttachmentAccept = "image/*,application/pdf,.pdf";

export const channelAttachmentMimeTypes = [
  ...issueAttachmentMimeTypes.filter((contentType) =>
    contentType.startsWith("image/")
  ),
  channelPdfContentType,
] as const;

const allowedMimeTypes = new Set<string>(channelAttachmentMimeTypes);

export function channelAttachmentMimeTypeFromName(name: string): string | null {
  const extension = name.normalize("NFC").trim().split(".").pop()?.toLowerCase();
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

export function normalizeChannelAttachmentFile(file: File): File {
  const normalizedType = file.type.trim().toLowerCase();
  if (allowedMimeTypes.has(normalizedType)) return file;
  const inferred = channelAttachmentMimeTypeFromName(file.name);
  if (!inferred) return file;
  return new File([file], file.name, {
    lastModified: file.lastModified,
    type: inferred,
  });
}

export function validateChannelAttachments(
  attachments: readonly IssueAttachmentCandidate[],
) {
  return validateAttachments(attachments, {
    allowedMimeTypes,
    mimeTypeFromName: channelAttachmentMimeTypeFromName,
    unsupportedTypeMessage: (name) =>
      `${name}은(는) 지원하지 않는 형식입니다. 이미지 또는 PDF 파일을 선택해 주세요.`,
  });
}
