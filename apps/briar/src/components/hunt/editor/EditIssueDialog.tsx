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
import { cn } from "@/lib/utils";
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
  const [difficulty, setDifficulty] = useState<IssueDifficulty>(run.difficulty);
  const [assigneeUserId, setAssigneeUserId] = useState(run.assigneeUserId ?? "");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [keptAttachmentIds, setKeptAttachmentIds] = useState<string[]>(() => (run.attachments ?? []).map(attachment => attachment.id));
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
  const existingAttachments = run.attachments ?? [];
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
  return <div className="dialog-backdrop issue-dialog-backdrop fixed inset-0 z-[1100] grid place-items-center bg-black/40 p-6 backdrop-blur-md" onMouseDown={event => event.target === event.currentTarget && !isSubmitting && onClose()}>
      <form aria-label={t("issue.editDialog")} aria-modal="true" className={cn("issue-dialog edit-issue-dialog relative flex max-h-[calc(100vh-80px)] w-[min(860px,calc(100vw-80px))] flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl", isDraggingAttachments && "is-dragging-attachments")} {...formEventHandlers} onSubmit={event => {
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
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-[18px]">
          <div className="issue-dialog-context flex min-w-0 items-center gap-2 text-sm font-semibold">
            <strong>{t("issue.editIssue")}</strong>
          </div>
          <button aria-label={t("common.close")} className="issue-dialog-close grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isSubmitting} onClick={onClose} type="button">
            <X size={16} />
          </button>
        </header>
        <div className="issue-form-body min-h-0 flex-1 overflow-y-auto px-6">
          <div className={cn("issue-editor-content flex min-h-0 flex-col gap-2", inlineAttachments.length > 0 && "has-attachments")}>
            <input aria-label={t("issue.title")} autoFocus className="issue-title-input w-full border-0 bg-transparent px-0 py-3 text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0" maxLength={titleMaxLength} onChange={event => setTitle(event.target.value)} placeholder={t("issue.titlePlaceholder")} required value={title} />
            <p className={cn("issue-title-counter m-0 text-right text-2xs text-muted-foreground", titleTooLong && "is-over text-destructive")} aria-live="polite">
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
            {remainingNewAttachments.length > 0 || remainingExistingAttachments.length > 0 ? <div aria-label={t("issue.attachments")} className="issue-attachment-list flex max-h-[140px] shrink-0 gap-2 overflow-x-auto py-1">
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
            {(submitError || attachmentError) && <div className="issue-form-error mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-2xs">
                <CircleAlert size={14} />
                {submitError ?? attachmentError}
              </div>}
          </div>
          <div className="issue-metadata-bar flex min-h-[72px] shrink-0 flex-wrap items-center gap-2 overflow-x-auto border-t border-border py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <NativeSelect className="issue-assignee-select w-auto max-w-[180px] [&_.select-menu-trigger]:h-[34px] [&_.select-menu-trigger]:min-w-[104px] [&_.select-menu-trigger]:rounded-lg [&_.select-menu-trigger]:border-border [&_.select-menu-trigger]:bg-card [&_.select-menu-trigger]:text-xs" label={t("issue.assignee")} onValueChange={setAssigneeUserId} options={[{
            label: t("run.unassigned"),
            value: ""
          }, ...members.map(member => ({
            label: member.name,
            value: member.userId
          }))]} value={assigneeUserId} />
            <NativeSelect className="issue-priority-select w-auto max-w-[180px] [&_.select-menu-trigger]:h-[34px] [&_.select-menu-trigger]:min-w-[110px] [&_.select-menu-trigger]:rounded-lg [&_.select-menu-trigger]:border-border [&_.select-menu-trigger]:bg-card [&_.select-menu-trigger]:text-xs" label={t("issue.priority")} onValueChange={setPriority} options={[{
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
            <NativeSelect className="issue-priority-select issue-difficulty-select w-auto max-w-[180px] [&_.select-menu-trigger]:h-[34px] [&_.select-menu-trigger]:min-w-[110px] [&_.select-menu-trigger]:rounded-lg [&_.select-menu-trigger]:border-border [&_.select-menu-trigger]:bg-card [&_.select-menu-trigger]:text-xs" label={t("issue.difficulty")} onValueChange={value => setDifficulty(value as IssueDifficulty)} options={[{
            label: t("issue.difficulty.easy"),
            value: "easy"
          }, {
            label: t("issue.difficulty.normal"),
            value: "normal"
          }, {
            label: t("issue.difficulty.hard"),
            value: "hard"
          }]} value={difficulty} />
            <label className="issue-attachment-trigger ml-auto inline-flex h-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent focus-within:ring-2 focus-within:ring-ring [&>input]:sr-only">
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
        <footer className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-t border-border px-6">
          <span className="issue-submit-hint flex items-center gap-1.5 text-2xs font-medium text-muted-foreground">
            <Kbd>⌘</Kbd>
            {t("issue.submitHint")}
          </span>
          <div className="flex items-center gap-2">
            <button className="issue-cancel-button inline-flex h-9 items-center justify-center rounded-lg border-0 bg-transparent px-3.5 text-xs font-semibold text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isSubmitting} onClick={onClose} type="button">
              {t("common.cancel")}
            </button>
            <button className="issue-submit-button inline-flex h-9 min-w-[108px] items-center justify-center gap-2 rounded-lg border-0 bg-primary px-3.5 text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" disabled={isSubmitting || !title.trim() || titleTooLong} type="submit">
              {isSubmitting && <Spinner size={13} />}
              {isSubmitting ? t("common.saving") : t("common.save")}
            </button>
          </div>
        </footer>
        {isDraggingAttachments && <div aria-live="polite" className="issue-attachment-drop-overlay absolute inset-0 z-10 grid place-items-center gap-2 bg-primary/10 text-primary backdrop-blur-sm" role="status">
            <ImageIcon aria-hidden="true" size={28} />
            <strong>{t("issue.dropHint")}</strong>
          </div>}
      </form>
    </div>;
}
