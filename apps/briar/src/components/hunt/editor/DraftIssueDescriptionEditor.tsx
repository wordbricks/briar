import {
  useMemo,
  type KeyboardEventHandler,
  type RefObject,
} from "react";
import type { IssueAttachment } from "@/types";
import { IssueDescriptionField } from "./IssueDescriptionField";
import { IssueInlineAttachmentPreview } from "./IssueInlineAttachmentPreview";
import { IssueDraftInlineAttachment, draftIssueDescriptionParts } from "./model";
export function DraftIssueDescriptionEditor({
  attachments,
  autoSizeTextFields = false,
  className,
  description,
  editorRef,
  label,
  onChange,
  onLoadAttachment,
  onKeyDown,
  onRemoveAttachment,
  placeholder,
  removeLabel
}: {
  attachments: IssueDraftInlineAttachment[];
  autoSizeTextFields?: boolean;
  className?: string;
  description: string;
  editorRef: RefObject<HTMLDivElement | null>;
  label: string;
  onChange: (value: string) => void;
  onLoadAttachment?: (attachment: IssueAttachment) => Promise<Blob>;
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>;
  onRemoveAttachment: (reference: string) => void;
  placeholder: string;
  removeLabel: (name: string) => string;
}) {
  const parts = useMemo(() => draftIssueDescriptionParts(description, attachments), [attachments, description]);
  const hasInlineAttachments = parts.some(part => part.type === "attachment");
  return <div className={`issue-description-editor${className ? ` ${className}` : ""}${hasInlineAttachments ? " has-inline-attachments" : ""}`} onKeyDown={onKeyDown} ref={editorRef}>
      {parts.map((part, index) => part.type === "text" ? <IssueDescriptionField autoSize={autoSizeTextFields || hasInlineAttachments} end={part.end} key={`text-${index}`} label={label} maxLength={Math.max(0, 100000 - (description.length - part.value.length))} onChange={nextValue => onChange(`${description.slice(0, part.start)}${nextValue}${description.slice(part.end)}`)} placeholder={parts.length === 1 ? placeholder : undefined} rows={Math.max(1, part.value.split("\n").length)} start={part.start} value={part.value} /> : <IssueInlineAttachmentPreview attachment={part.attachment} key={`attachment-${part.attachment.reference}`} onLoadAttachment={onLoadAttachment} onRemove={() => onRemoveAttachment(part.attachment.reference)} removeLabel={removeLabel(part.attachment.type === "new" ? part.attachment.file.name : part.attachment.attachment.filename)} />)}
    </div>;
}
