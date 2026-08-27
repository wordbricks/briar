import { CircleAlert, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { Spinner } from "@/components/ui/spinner";
import { useCallback, useEffect, useState } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { ProviderModelSelector } from "@/components/ProviderModelSelector";
import { SelectMenu } from "@/components/SelectMenu";
import { useIssueDialogAttachments } from "@/hooks/useIssueDialogAttachments";
import { type AutoHuntWorkflow, type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { issueAttachmentAccept, maxIssueAttachmentCount } from "@/lib/issue-attachments";
import { issueTitleInputMaxLength, issueTitleLength, isIssueTitleWithinLimit } from "@/lib/issue-title";
import { clearCreateIssueDraft, loadCreateIssueDraft, saveCreateIssueDraft } from "@/lib/create-issue-draft";
import { removeIssueAttachmentMarkdown } from "@/lib/issue-markdown";
import { defaultIssueDifficulty, type IssueDifficulty } from "@/lib/issue-difficulty";
import type { CreateIssueInput, OrganizationMember, Project } from "@/types";
import { agentEffortOptions, agentProviders, type AgentProvider, type ModelEffort } from "@/lib/project-llm";
import { useAgentProviderModels } from "@/hooks/useAgentProviderModels";
import { useAgentProviderModelPreferences } from "@/hooks/useAgentProviderModelPreferences";
import { useI18n } from "@/i18n";
import { DraftIssueDescriptionEditor } from "./DraftIssueDescriptionEditor";
import { IssueCheckpointDropdown } from "./IssueCheckpointDropdown";
import { SelectedAttachment } from "./SelectedAttachment";
import { cn } from "@/lib/utils";
export function CreateIssueDialog({
  availableProviders = agentProviders,
  compactHeader = false,
  defaultProjectId,
  defaultStatus = "queued",
  isSubmitting,
  onClose,
  onCreate,
  members = [],
  projects,
  workflow,
  workflowProjectId
}: {
  availableProviders?: readonly AgentProvider[];
  compactHeader?: boolean;
  defaultProjectId?: string;
  defaultStatus?: CreateIssueInput["status"];
  isSubmitting: boolean;
  onClose: () => void;
  onCreate: (projectId: string, input: CreateIssueInput) => Promise<void>;
  members?: OrganizationMember[];
  projects: Project[];
  workflow?: AutoHuntWorkflow;
  workflowProjectId?: string;
}) {
  const {
    locale,
    t
  } = useI18n();
  const providerModels = useAgentProviderModels();
  const providerModelPreferences = useAgentProviderModelPreferences();
  const [initialDraft] = useState(() => {
    const draft = loadCreateIssueDraft();
    return draft && projects.some(project => project.id === draft.projectId) ? draft : null;
  });
  const [title, setTitle] = useState(initialDraft?.title ?? "");
  const titleMaxLength = issueTitleInputMaxLength(title, locale);
  const titleLength = issueTitleLength(title);
  const titleTooLong = Boolean(title.trim()) && !isIssueTitleWithinLimit(title);
  const [description, setDescription] = useState(initialDraft?.description ?? "");
  const [status, setStatus] = useState<"backlog" | "queued">(initialDraft?.status ?? defaultStatus);
  const [priority, setPriority] = useState(initialDraft?.priority ?? "2");
  const [difficulty, setDifficulty] = useState<IssueDifficulty>(initialDraft?.difficulty ?? defaultIssueDifficulty);
  const [assigneeUserId, setAssigneeUserId] = useState(initialDraft?.assigneeUserId ?? "");
  const [preferredProvider, setPreferredProvider] = useState(initialDraft?.preferredProvider ?? "");
  const [preferredModel, setPreferredModel] = useState(() => initialDraft?.preferredModel ?? (initialDraft?.preferredProvider ? providerModelPreferences[initialDraft.preferredProvider as AgentProvider].defaultModel : null) ?? "");
  const [preferredEffort, setPreferredEffort] = useState(initialDraft?.preferredEffort ?? "high");
  const [fullAuto, setFullAuto] = useState(initialDraft?.fullAuto ?? false);
  const [projectId, setProjectId] = useState(() => projects.some(project => project.id === initialDraft?.projectId) ? initialDraft!.projectId : projects.some(project => project.id === defaultProjectId) ? defaultProjectId! : projects[0]?.id ?? "");
  const [checkpoints, setCheckpoints] = useState<AutoHuntWorkflowCheckpoint[]>(initialDraft && initialDraft.projectId === workflowProjectId ? initialDraft.checkpoints ?? [] : []);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    addAttachments,
    attachmentError,
    attachments,
    descriptionEditorRef,
    formEventHandlers,
    inlineAttachmentReferences,
    isDraggingAttachments,
    removeAttachment
  } = useIssueDialogAttachments({
    description,
    isSubmitting,
    setDescription
  });
  const persistDraft = useCallback(() => {
    const draftDescription = attachments.reduce((current, {
      reference
    }) => removeIssueAttachmentMarkdown(current, reference), description);
    saveCreateIssueDraft({
      description: draftDescription,
      priority,
      difficulty,
      projectId,
      status,
      title,
      assigneeUserId: assigneeUserId || null,
      preferredProvider: preferredProvider || null,
      preferredModel: preferredModel || null,
      preferredEffort: preferredEffort || null,
      ...(fullAuto ? {
        fullAuto: true
      } : {}),
      ...(checkpoints.length > 0 ? {
        checkpoints
      } : {})
    });
  }, [assigneeUserId, attachments, description, preferredModel, preferredProvider, preferredEffort, fullAuto, checkpoints, priority, difficulty, projectId, status, title]);
  const closeWithDraft = useCallback(() => {
    persistDraft();
    onClose();
  }, [onClose, persistDraft]);
  const remainingAttachments = attachments.filter(({
    file,
    reference
  }) => !file.type.startsWith("image/") || !inlineAttachmentReferences.has(reference));
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSubmitting) closeWithDraft();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeWithDraft, isSubmitting]);
  useEffect(() => {
    persistDraft();
  }, [persistDraft]);
  return <div className="dialog-backdrop issue-dialog-backdrop fixed inset-0 z-[1100] grid place-items-center bg-black/40 p-6 backdrop-blur-md" onMouseDown={event => event.target === event.currentTarget && !isSubmitting && closeWithDraft()}>
      <form className={cn("issue-dialog relative flex max-h-[calc(100vh-80px)] w-[min(860px,calc(100vw-80px))] flex-col overflow-hidden rounded-2xl border border-border bg-card text-foreground shadow-2xl", isDraggingAttachments && "is-dragging-attachments")} {...formEventHandlers} onSubmit={event => {
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
      if (!projectId) return;
      void onCreate(projectId, {
        title: title.trim(),
        description: description.trim() || null,
        priority: Number(priority),
        difficulty,
        assigneeUserId: assigneeUserId || null,
        status,
        preferredProvider: (preferredProvider || null) as AgentProvider | null,
        preferredModel: preferredModel || null,
        preferredEffort: preferredProvider && preferredModel ? (preferredEffort || null) as ModelEffort | null : null,
        fullAuto,
        ...(!fullAuto && checkpoints.length > 0 ? {
          checkpoints
        } : {}),
        attachments: attachments.map(({
          file
        }) => file),
        ...(attachments.length > 0 ? {
          attachmentReferences: attachments.map(({
            reference
          }) => reference)
        } : {})
      }).then(clearCreateIssueDraft).catch(error => setSubmitError(error instanceof Error ? error.message : String(error)));
    }} role="dialog" aria-modal="true" aria-label={t("issue.dialog")}>
        <header className="flex min-h-14 shrink-0 items-center justify-between gap-3 border-b border-border px-[18px]">
          <div className="issue-dialog-context flex min-w-0 items-center gap-2 text-sm font-semibold">
            {!compactHeader && <strong>{t("issue.newIssue")}</strong>}
            {projects.length > 0 && <>
                {!compactHeader && <span aria-hidden="true">/</span>}
                <SelectMenu className="issue-project-context" disabled={isSubmitting} label={t("issue.project")} onValueChange={nextProjectId => {
              setProjectId(nextProjectId);
              if (nextProjectId !== workflowProjectId) {
                setCheckpoints([]);
              }
            }} options={projects.map(project => ({
              label: project.name,
              value: project.id
            }))} size="small" value={projectId} />
              </>}
          </div>
          <button className="issue-dialog-close grid size-8 shrink-0 place-items-center rounded-lg border-0 bg-transparent text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isSubmitting} onClick={closeWithDraft} type="button" aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="issue-form-body min-h-0 flex-1 overflow-y-auto px-6">
          <div className={cn("issue-editor-content flex min-h-0 flex-col gap-2", attachments.length > 0 && "has-attachments")}>
            <input aria-label={t("issue.title")} autoFocus className="issue-title-input w-full border-0 bg-transparent px-0 py-3 text-lg font-semibold text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-0" maxLength={titleMaxLength} onChange={event => setTitle(event.target.value)} placeholder={t("issue.titlePlaceholder")} required value={title} />
            <p className={cn("issue-title-counter m-0 text-right text-2xs text-muted-foreground", titleTooLong && "is-over text-destructive")} aria-live="polite">
              {t("issue.titleCount", {
              count: titleLength,
              max: titleMaxLength
            })}
            </p>
            <DraftIssueDescriptionEditor attachments={attachments.map(({
            file,
            reference
          }) => ({
            file,
            reference,
            type: "new"
          }))} description={description} editorRef={descriptionEditorRef} label={t("issue.description")} onChange={setDescription} onRemoveAttachment={reference => {
            const index = attachments.findIndex(attachment => attachment.reference === reference);
            if (index >= 0) removeAttachment(index, reference);
          }} placeholder={t("issue.descriptionPlaceholder")} removeLabel={name => t("issue.remove", {
            name
          })} />
            {remainingAttachments.length > 0 && <div aria-label={t("issue.attachments")} className="issue-attachment-list flex max-h-[140px] shrink-0 gap-2 overflow-x-auto py-1">
                {remainingAttachments.map(({
              file,
              reference
            }) => <SelectedAttachment key={reference} onRemove={() => {
              const index = attachments.findIndex(attachment => attachment.reference === reference);
              if (index >= 0) removeAttachment(index, reference);
            }} source={{
              file,
              type: "new"
            }} />)}
              </div>}
            {(submitError || attachmentError) && <div className="issue-form-error mb-2 flex shrink-0 items-center gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-2.5 py-2 text-2xs">
                <CircleAlert size={14} />
                {submitError ?? attachmentError}
              </div>}
          </div>
          <div className="issue-metadata-bar flex min-h-[72px] shrink-0 flex-wrap items-center gap-2 overflow-x-auto border-t border-border py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <label className="issue-full-auto-toggle relative inline-flex h-[34px] cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium">
              <input aria-describedby="issue-full-auto-description" checked={fullAuto} disabled={isSubmitting} onChange={event => {
              const checked = event.currentTarget.checked;
              setFullAuto(checked);
              if (checked) setCheckpoints([]);
            }} type="checkbox" />
              <span>{t("issue.fullAuto")}</span>
              <small className="sr-only" id="issue-full-auto-description">
                {t("issue.fullAutoDescription")}
              </small>
            </label>
            {workflow && projectId === workflowProjectId ? <IssueCheckpointDropdown checkpoints={checkpoints} disabled={isSubmitting || fullAuto} onChange={setCheckpoints} workflow={fullAuto ? {
            ...workflow,
            execution: {
              checkpoints: []
            }
          } : workflow} /> : null}
            <NativeSelect className="issue-assignee-select w-auto max-w-[180px] [&_.select-menu-trigger]:h-[34px] [&_.select-menu-trigger]:min-w-[104px] [&_.select-menu-trigger]:rounded-lg [&_.select-menu-trigger]:border-border [&_.select-menu-trigger]:bg-card [&_.select-menu-trigger]:text-xs" label={t("issue.assignee")} onValueChange={setAssigneeUserId} options={[{
            label: t("run.unassigned"),
            value: ""
          }, ...members.map(member => ({
            label: member.name,
            value: member.userId
          }))]} value={assigneeUserId} />
            <NativeSelect className="issue-status-select w-auto max-w-[180px] [&_.select-menu-trigger]:h-[34px] [&_.select-menu-trigger]:min-w-[88px] [&_.select-menu-trigger]:rounded-lg [&_.select-menu-trigger]:border-border [&_.select-menu-trigger]:bg-card [&_.select-menu-trigger]:text-xs" label={t("dashboard.status")} onValueChange={value => setStatus(value === "backlog" ? "backlog" : "queued")} options={[{
            label: t("status.backlog"),
            value: "backlog"
          }, {
            label: t("status.queued"),
            value: "queued"
          }]} value={status} />
            <NativeSelect className="issue-priority-select w-auto max-w-[180px] [&_.select-menu-trigger]:h-[34px] [&_.select-menu-trigger]:min-w-[110px] [&_.select-menu-trigger]:rounded-lg [&_.select-menu-trigger]:border-border [&_.select-menu-trigger]:bg-card [&_.select-menu-trigger]:text-xs" label={t("issue.priority")} onValueChange={value => setPriority(value as "1" | "2" | "3" | "4")} options={[{
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
            <ProviderModelSelector className="issue-provider-model-selector w-[min(250px,100%)] min-w-[210px] flex-[0_1_250px] [&_.provider-model-selector-label]:sr-only [&_.provider-model-selector-trigger]:h-[34px] [&_.provider-model-selector-trigger]:rounded-lg [&_.provider-model-selector-trigger]:border-border [&_.provider-model-selector-trigger]:bg-card [&_.provider-model-selector-trigger]:text-xs" compact disabled={isSubmitting} groupLabel={`${t("issue.preferredProvider")} · ${t("issue.preferredModel")} `} modelLabel={t("issue.preferredModel")} modelSearchEmptyMessage={t("issue.noModelsFound")} modelSearchPlaceholder={t("issue.searchModels")} modelValue={preferredModel} onModelChange={value => {
            setPreferredModel(value);
            setPreferredEffort("");
          }} onProviderChange={value => {
            setPreferredProvider(value);
            setPreferredModel(value ? providerModelPreferences[value as AgentProvider].defaultModel ?? "" : "");
            setPreferredEffort("high");
          }} providerDefaultModelLabel={t("settings.providerDefaultModel")} providerEmptyOption={{
            label: t("issue.agentDefault"),
            value: ""
          }} providerLabel={t("issue.preferredProvider")} providerModels={providerModels} providers={availableProviders} providerValue={preferredProvider} />
            <NativeSelect className="issue-effort-select w-auto max-w-[180px] [&_.select-menu-trigger]:h-[34px] [&_.select-menu-trigger]:min-w-[92px] [&_.select-menu-trigger]:rounded-lg [&_.select-menu-trigger]:border-border [&_.select-menu-trigger]:bg-card [&_.select-menu-trigger]:text-xs" disabled={!preferredProvider || !preferredModel} label={t("settings.effort")} onValueChange={setPreferredEffort} options={preferredProvider ? [{
            label: t("settings.providerDefaultEffort"),
            value: ""
          }, ...agentEffortOptions(providerModels, preferredProvider as AgentProvider, preferredModel, preferredEffort)] : []} placeholder={t("issue.selectModelFirst")} value={preferredEffort} />
            <label className="issue-attachment-trigger ml-auto inline-flex h-[34px] cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-2.5 text-xs font-medium hover:bg-accent focus-within:ring-2 focus-within:ring-ring [&>input]:sr-only">
              <Paperclip size={13} />
              <span>
                {attachments.length > 0 ? t("issue.attachmentCount", {
                count: attachments.length
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
            <button className="issue-cancel-button inline-flex h-9 items-center justify-center rounded-lg border-0 bg-transparent px-3.5 text-xs font-semibold text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50" disabled={isSubmitting} onClick={closeWithDraft} type="button">
              {t("common.cancel")}
            </button>
            <button className="issue-submit-button inline-flex h-9 min-w-[108px] items-center justify-center gap-2 rounded-lg border-0 bg-primary px-3.5 text-xs font-semibold text-primary-foreground outline-none hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" disabled={isSubmitting || !title.trim() || !projectId || titleTooLong} type="submit">
              {isSubmitting && <Spinner size={13} />}
              {isSubmitting ? t("issue.submitting") : t("issue.submit")}
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
