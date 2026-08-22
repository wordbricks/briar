const attachmentScheme = "briar-attachment://";
const attachmentReferencePattern = /^[0-9a-z_-]+$/iu;
const attachmentUrlPattern = /briar-attachment:\/\/([0-9a-z_-]+)/giu;

export function issueAttachmentMarkdown(reference: string, filename: string) {
  const alt = filename
    .replace(/[\r\n]+/gu, " ")
    .replace(/\\/gu, "\\\\")
    .replace(/([\[\]])/gu, "\\$1");
  return `![${alt}](${attachmentScheme}${reference})`;
}

export function issueAttachmentReference(url: string | undefined) {
  if (!url?.startsWith(attachmentScheme)) return null;
  const reference = url.slice(attachmentScheme.length);
  return attachmentReferencePattern.test(reference) ? reference : null;
}

export function issueAttachmentReferences(markdown: string | null) {
  const references = new Set<string>();
  if (!markdown) return references;
  for (const match of markdown.matchAll(attachmentUrlPattern)) {
    if (match[1]) references.add(match[1]);
  }
  return references;
}

export function canonicalizeIssueAttachmentReferences(
  markdown: string | null | undefined,
  references: readonly string[],
  attachmentIds: readonly string[],
) {
  if (!markdown) return markdown ?? null;
  let result = markdown;
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    const attachmentId = attachmentIds[index];
    if (!reference || !attachmentId) continue;
    result = result.replaceAll(
      `${attachmentScheme}${reference}`,
      `${attachmentScheme}${attachmentId}`,
    );
  }
  return result;
}

export function removeIssueAttachmentMarkdown(
  markdown: string,
  reference: string,
) {
  const target = `${attachmentScheme}${reference}`;
  let result = markdown;
  let targetIndex = result.indexOf(target);
  while (targetIndex >= 0) {
    const imageStart = result.lastIndexOf("![", targetIndex);
    const destinationStart = result.lastIndexOf("](", targetIndex);
    const imageEnd = result.indexOf(")", targetIndex + target.length);
    if (
      imageStart < 0 ||
      destinationStart < imageStart ||
      destinationStart > targetIndex ||
      imageEnd < 0
    ) {
      break;
    }
    result = `${result.slice(0, imageStart)}${result.slice(imageEnd + 1)}`;
    targetIndex = result.indexOf(target);
  }
  return result.replace(/\n{3,}/gu, "\n\n");
}

export function isIssueAttachmentReference(value: unknown): value is string {
  return typeof value === "string" && attachmentReferencePattern.test(value);
}
