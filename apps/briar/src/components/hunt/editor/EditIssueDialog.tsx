import { CircleAlert, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useEffect, useState } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { useIssueDialogAttachments } from "@/hooks/useIssueDialogAttachments";
import { issueAttachmentAccept, maxIssueAttachmentCount } from "@/lib/issue-attachments";
import { issueTitleInputMaxLength, issueTitleLength, isIssueTitleWithinLimit } from "@/lib/issue-title";
import { removeIssueAttachmentMarkdown } from "@/lib/issue-markdown";
import type { IssueDifficulty } from "@/lib/issue-difficulty";
import type { HuntRun, IssueAttachment, OrganizationMember, UpdateIssueInput } from "@/types";
import { useI18n } from "@/i18n";
import { DraftIssueDescriptionEditor } from "./DraftIssueDescriptionEditor";
import { SelectedAttachment } from "./SelectedAttachment";
import { IssueDraftInlineAttachment } from "./model";
export function EditIssueDialog({
  isSubmitting,
  members = [],
  onClose,
  onLoadAttachment,
  onUpdate,
  run
}: {
  isSubmitting: boolean;
  members?: OrganizationMember[];
  onClose: () => void;
  onLoadAttachment?: (attachment: IssueAttachment) => Promise<Blob>;
  onUpdate: (input: UpdateIssueInput) => Promise<unknown>;
  run: HuntRun;
}) {
  const {
    locale,
    t
  } = useI18n();
  const [title, setTitle] = useState(run.title);
  const [description, setDescription] = useState(run.issueDescription ?? "");
  const [priority, setPriority] = useState(run.priority === null ? "" : String(run.priority));
  const [difficulty, setDifficulty] = useState<IssueDifficulty | null>(run.difficulty);
  const [assigneeUserId, setAssigneeUserId] = useState(run.assigneeUserId ?? "");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [keptAttachmentIds, setKeptAttachmentIds] = useState<string[]>(() => run.attachments.map(attachment => attachment.id));
  const titleMaxLength = issueTitleInputMaxLength(title, locale);
  const titleLength = issueTitleLength(title);
  const titleTooLong = Boolean(title.trim()) && !isIssueTitleWithinLimit(title);
  const {
    addAttachments,
    attachmentError,
    attachments,
    descriptionEditorRef,
    formEventHandlers,
    inlineAttachmentReferences,
    isDraggingAttachments,
    removeAttachment: removeNewAttachment
  } = useIssueDialogAttachments({
    description,
    isSubmitting,
    setDescription
  });
  const existingAttachments = run.attachments;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [isSubmitting, onClose]);
  const removeExistingAttachment = (attachmentId: string) => {
    setKeptAttachmentIds(current => current.filter(candidate => candidate !== attachmentId));
    setDescription(current => removeIssueAttachmentMarkdown(current, attachmentId));
  };
  const inlineAttachments: IssueDraftInlineAttachment[] = [...existingAttachments.map(attachment => ({
    attachment,
    reference: attachment.id,
    type: "existing" as const
  })), ...attachments.map(({
    file,
    reference
  }) => ({
    file,
    reference,
    type: "new" as const
  }))];
  const remainingNewAttachments = attachments.filter(({
    file,
    reference
  }) => !file.type.startsWith("image/") || !inlineAttachmentReferences.has(reference));
  const remainingExistingAttachments = existingAttachments.filter(attachment => keptAttachmentIds.includes(attachment.id) && !inlineAttachmentReferences.has(attachment.id));
  return <div className="dialog-backdrop issue-dialog-backdrop" onMouseDown={event => event.target === event.currentTarget && !isSubmitting && onClose()}>
      <form aria-label={t("issue.editDialog")} aria-modal="true" className={`issue-dialog edit-issue-dialog${isDraggingAttachments ? " is-dragging-attachments" : ""}`} {...formEventHandlers} onSubmit={event => {
      event.preventDefault();
      if (!title.trim() || isSubmitting) return;
      if (!isIssueTitleWithinLimit(title)) {
        setSubmitError(t("issue.titleTooLong", {
          max: titleMaxLength,
          count: titleLength
        }));
        return;
      }
      setSubmitError(null);
      void onUpdate({
        title: title.trim(),
        description: description.trim() || null,
        priority: priority ? Number(priority) : null,
        difficulty,
        assigneeUserId: assigneeUserId || null,
        attachments: attachments.map(({
          file
        }) => file),
        ...(attachments.length > 0 ? {
          attachmentReferences: attachments.map(({
            reference
          }) => reference)
        } : {}),
        keptAttachmentIds
      }).catch(error => setSubmitError(error instanceof Error ? error.message : String(error)));
    }} role="dialog">
        <header>
          <div className="issue-dialog-context">
            <strong>{t("issue.editIssue")}</strong>
          </div>
          <button aria-label={t("common.close")} className="issue-dialog-close" disabled={isSubmitting} onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>
        <div className="issue-form-body">
          <div className={`issue-editor-content${inlineAttachments.length > 0 ? " has-attachments" : ""}`}>
            <input aria-label={t("issue.title")} autoFocus className="issue-title-input" maxLength={titleMaxLength} onChange={event => setTitle(event.target.value)} placeholder={t("issue.titlePlaceholder")} required value={title} />
            <p className={`issue-title-counter${titleTooLong ? " is-over" : ""}`} aria-live="polite">
              {t("issue.titleCount", {
              count: titleLength,
              max: titleMaxLength
            })}
            </p>
            <DraftIssueDescriptionEditor attachments={inlineAttachments} description={description} editorRef={descriptionEditorRef} label={t("issue.description")} onChange={setDescription} onLoadAttachment={onLoadAttachment} onRemoveAttachment={reference => {
            const existingIndex = existingAttachments.findIndex(attachment => attachment.id === reference);
            if (existingIndex >= 0) {
              removeExistingAttachment(reference);
              return;
            }
            const newIndex = attachments.findIndex(attachment => attachment.reference === reference);
            if (newIndex >= 0) removeNewAttachment(newIndex, reference);
          }} placeholder={t("issue.descriptionPlaceholder")} removeLabel={name => t("issue.remove", {
            name
          })} />
            {remainingNewAttachments.length > 0 || remainingExistingAttachments.length > 0 ? <div aria-label={t("issue.attachments")} className="issue-attachment-list">
                {remainingExistingAttachments.map(attachment => <SelectedAttachment key={attachment.id} onLoadAttachment={onLoadAttachment} onRemove={() => removeExistingAttachment(attachment.id)} source={{
              attachment,
              type: "existing"
            }} />)}
                {remainingNewAttachments.map(({
              file,
              reference
            }) => <SelectedAttachment key={reference} onRemove={() => {
              const index = attachments.findIndex(attachment => attachment.reference === reference);
              if (index >= 0) removeNewAttachment(index, reference);
            }} source={{
              file,
              type: "new"
            }} />)}
              </div> : null}
            {(submitError || attachmentError) && <div className="issue-form-error">
                <CircleAlert size={14} />
                {submitError ?? attachmentError}
              </div>}
          </div>
          <div className="issue-metadata-bar">
            <NativeSelect className="issue-assignee-select" label={t("issue.assignee")} onValueChange={setAssigneeUserId} options={[{
            label: t("run.unassigned"),
            value: ""
          }, ...members.map(member => ({
            label: member.name,
            value: member.userId
          }))]} value={assigneeUserId} />
            <NativeSelect className="issue-priority-select" label={t("issue.priority")} onValueChange={setPriority} options={[{
            label: t("run.notSet"),
            value: ""
          }, {
            label: t("issue.priority1"),
            value: "1"
          }, {
            label: t("issue.priority2"),
            value: "2"
          }, {
            label: t("issue.priority3"),
            value: "3"
          }, {
            label: t("issue.priority4"),
            value: "4"
          }]} value={priority} />
            <NativeSelect className="issue-priority-select issue-difficulty-select" label={t("issue.difficulty")} onValueChange={value => setDifficulty(value ? value as IssueDifficulty : null)} options={[{
            label: t("run.notSet"),
            value: ""
          }, {
            label: t("issue.difficulty.easy"),
            value: "easy"
          }, {
            label: t("issue.difficulty.normal"),
            value: "normal"
          }, {
            label: t("issue.difficulty.hard"),
            value: "hard"
          }]} value={difficulty ?? ""} />
            <label className="issue-attachment-trigger">
              <Paperclip size={13} />
              <span>
                {attachments.length + existingAttachments.length > 0 ? t("issue.attachmentCount", {
                count: attachments.length + existingAttachments.length
              }) : t("issue.attachments")}
              </span>
              <input accept={issueAttachmentAccept} aria-label={t("issue.attachmentLabel")} disabled={isSubmitting || attachments.length >= maxIssueAttachmentCount} multiple onChange={event => {
              const selected = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = "";
              addAttachments(selected, true);
            }} type="file" />
            </label>
          </div>
        </div>
        <footer>
          <span className="issue-submit-hint">
            <Kbd>⌘</Kbd>
            {t("issue.submitHint")}
          </span>
          <div>
            <button className="issue-cancel-button" disabled={isSubmitting} onClick={onClose} type="button">
              {t("common.cancel")}
            </button>
            <button className="issue-submit-button" disabled={isSubmitting || !title.trim() || titleTooLong} type="submit">
              {isSubmitting && <Spinner className="size-[13px]" />}
              {isSubmitting ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </footer>
        {isDraggingAttachments && <div aria-live="polite" className="issue-attachment-drop-overlay" role="status">
            <ImageIcon aria-hidden="true" size={28} />
            <strong>{t("issue.dropHint")}</strong>
          </div>}
      </form>
    </div>;
}
