import { maxIssueAttachmentBytes } from "./issue-attachments";

export const htmlArtifactPreviewPath = "/html-artifact-preview";
export const htmlArtifactPreviewProtocolVersion = 1;
export const htmlArtifactPreviewMaxBytes = maxIssueAttachmentBytes;

export const htmlArtifactPreviewMessageType = {
  error: "briar-html-artifact-preview:error",
  probe: "briar-html-artifact-preview:probe",
  ready: "briar-html-artifact-preview:ready",
  render: "briar-html-artifact-preview:render",
  rendered: "briar-html-artifact-preview:rendered",
} as const;

export type HtmlArtifactPreviewMessageType =
  typeof htmlArtifactPreviewMessageType[keyof typeof htmlArtifactPreviewMessageType];

export function isHtmlArtifactPreviewMessage(
  value: unknown,
  type: HtmlArtifactPreviewMessageType,
) {
  if (typeof value !== "object" || value === null) return false;
  const message = value as Record<string, unknown>;
  return message.type === type &&
    message.version === htmlArtifactPreviewProtocolVersion;
}
