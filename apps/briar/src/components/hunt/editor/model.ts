import { isIssueAttachmentImage } from "@/lib/issue-attachments";
import type { IssueAttachment } from "@/types";
export type DraftIssueAttachment = {
  file: File;
  reference: string;
};
export type IssueDraftInlineAttachment = {
  type: "new";
  file: File;
  reference: string;
} | {
  type: "existing";
  attachment: IssueAttachment;
  reference: string;
};
export function draftInlineAttachmentFile(attachment: IssueDraftInlineAttachment): File | null {
  return attachment.type === "new" ? attachment.file : null;
}
export function draftInlineAttachmentIsImage(attachment: IssueDraftInlineAttachment): boolean {
  return attachment.type === "new" ? attachment.file.type.startsWith("image/") : isIssueAttachmentImage(attachment.attachment.contentType, attachment.attachment.filename);
}
export type DraftIssueDescriptionPart = {
  type: "text";
  start: number;
  end: number;
  value: string;
} | {
  type: "attachment";
  start: number;
  end: number;
  attachment: IssueDraftInlineAttachment;
};
export function draftIssueDescriptionParts(description: string, attachments: IssueDraftInlineAttachment[]): DraftIssueDescriptionPart[] {
  const ranges = attachments.filter(draftInlineAttachmentIsImage).flatMap(attachment => {
    const target = `briar-attachment://${attachment.reference}`;
    const matches: Array<{
      start: number;
      end: number;
      attachment: IssueDraftInlineAttachment;
    }> = [];
    let targetIndex = description.indexOf(target);
    while (targetIndex >= 0) {
      const start = description.lastIndexOf("![", targetIndex);
      const destinationStart = description.lastIndexOf("](", targetIndex);
      const end = description.indexOf(")", targetIndex + target.length);
      if (start >= 0 && destinationStart > start && destinationStart < targetIndex && end >= 0) {
        matches.push({
          attachment,
          end: end + 1,
          start
        });
      }
      targetIndex = description.indexOf(target, targetIndex + target.length);
    }
    return matches;
  }).sort((left, right) => left.start - right.start).filter((range, index, all) => index === 0 || range.start >= all[index - 1]!.end);
  if (ranges.length === 0) {
    return [{
      end: description.length,
      start: 0,
      type: "text",
      value: description
    }];
  }
  const parts: DraftIssueDescriptionPart[] = [];
  let offset = 0;
  for (const range of ranges) {
    parts.push({
      end: range.start,
      start: offset,
      type: "text",
      value: description.slice(offset, range.start)
    });
    parts.push({
      ...range,
      type: "attachment"
    });
    offset = range.end;
  }
  parts.push({
    end: description.length,
    start: offset,
    type: "text",
    value: description.slice(offset)
  });
  return parts;
}
export type SelectedAttachmentSource = {
  type: "new";
  file: File;
} | {
  type: "existing";
  attachment: IssueAttachment;
};
