import { CircleAlert, Image as ImageIcon, Paperclip, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useCallback, useEffect, useState } from "react";
import { NativeSelect } from "@/components/NativeSelect";
import { ProviderSelect } from "@/components/ProviderSelect";
import { SelectMenu } from "@/components/SelectMenu";
import { useIssueDialogAttachments } from "@/hooks/useIssueDialogAttachments";
import { type AutoHuntWorkflow, type AutoHuntWorkflowCheckpoint } from "@/lib/auto-hunt-contract";
import { issueAttachmentAccept, maxIssueAttachmentCount } from "@/lib/issue-attachments";
import { issueTitleInputMaxLength, issueTitleLength, isIssueTitleWithinLimit } from "@/lib/issue-title";
import { clearCreateIssueDraft, loadCreateIssueDraft, saveCreateIssueDraft } from "@/lib/create-issue-draft";
import { removeIssueAttachmentMarkdown } from "@/lib/issue-markdown";
import type { CreateIssueInput, OrganizationMember, Project } from "@/types";
import { agentEffortOptions, agentModelOptions, agentProviders, type AgentProvider, type ModelEffort } from "@/lib/project-llm";
import { useAgentProviderModels } from "@/hooks/useAgentProviderModels";
import { useAgentProviderModelPreferences } from "@/hooks/useAgentProviderModelPreferences";
import { useI18n } from "@/i18n";
import { DraftIssueDescriptionEditor } from "./DraftIssueDescriptionEditor";
import { IssueCheckpointDropdown } from "./IssueCheckpointDropdown";
import { SelectedAttachment } from "./SelectedAttachment";
export function CreateIssueDialog({
  availableProviders = agentProviders,
  compactHeader = false,
  defaultProjectId,
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
  const [status, setStatus] = useState<"backlog" | "queued">(initialDraft?.status ?? "queued");
  const [priority, setPriority] = useState(initialDraft?.priority ?? "2");
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
  }, [assigneeUserId, attachments, description, preferredModel, preferredProvider, preferredEffort, fullAuto, checkpoints, priority, projectId, status, title]);
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
  return <div className="dialog-backdrop issue-dialog-backdrop" onMouseDown={event => event.target === event.currentTarget && !isSubmitting && closeWithDraft()}>
      <form className={`issue-dialog${isDraggingAttachments ? " is-dragging-attachments" : ""}`} {...formEventHandlers} onSubmit={event => {
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
        <header>
          <div className="issue-dialog-context">
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
          <button className="issue-dialog-close" disabled={isSubmitting} onClick={closeWithDraft} type="button" aria-label={t("common.close")}>
            <X size={16} />
          </button>
        </header>
        <div className="issue-form-body">
          <div className={`issue-editor-content${attachments.length > 0 ? " has-attachments" : ""}`}>
            <input aria-label={t("issue.title")} autoFocus className="issue-title-input" maxLength={titleMaxLength} onChange={event => setTitle(event.target.value)} placeholder={t("issue.titlePlaceholder")} required value={title} />
            <p className={`issue-title-counter${titleTooLong ? " is-over" : ""}`} aria-live="polite">
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
            {remainingAttachments.length > 0 && <div aria-label={t("issue.attachments")} className="issue-attachment-list">
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
            {(submitError || attachmentError) && <div className="issue-form-error">
                <CircleAlert size={14} />
                {submitError ?? attachmentError}
              </div>}
          </div>
          <div className="issue-metadata-bar">
            <label className="issue-full-auto-toggle">
              <input aria-describedby="issue-full-auto-description" checked={fullAuto} disabled={isSubmitting} onChange={event => {
              const checked = event.currentTarget.checked;
              setFullAuto(checked);
              if (checked) setCheckpoints([]);
            }} type="checkbox" />
              <span>{t("issue.fullAuto")}</span>
              <small id="issue-full-auto-description">
                {t("issue.fullAutoDescription")}
              </small>
            </label>
            {workflow && projectId === workflowProjectId ? <IssueCheckpointDropdown checkpoints={checkpoints} disabled={isSubmitting || fullAuto} onChange={setCheckpoints} workflow={fullAuto ? {
            ...workflow,
            execution: {
              checkpoints: []
            }
          } : workflow} /> : null}
            <NativeSelect className="issue-assignee-select" label={t("issue.assignee")} onValueChange={setAssigneeUserId} options={[{
            label: t("run.unassigned"),
            value: ""
          }, ...members.map(member => ({
            label: member.name,
            value: member.userId
          }))]} value={assigneeUserId} />
            <NativeSelect className="issue-status-select" label={t("dashboard.status")} onValueChange={value => setStatus(value === "backlog" ? "backlog" : "queued")} options={[{
            label: t("status.backlog"),
            value: "backlog"
          }, {
            label: t("status.queued"),
            value: "queued"
          }]} value={status} />
            <NativeSelect className="issue-priority-select" label={t("issue.priority")} onValueChange={value => setPriority(value as "1" | "2" | "3" | "4")} options={[{
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
            <ProviderSelect className="issue-provider-select" emptyOption={{
            label: t("issue.agentDefault"),
            value: ""
          }} label={t("issue.preferredProvider")} onValueChange={value => {
            setPreferredProvider(value);
            setPreferredModel(value ? providerModelPreferences[value as AgentProvider].defaultModel ?? "" : "");
            setPreferredEffort("high");
          }} providers={availableProviders} value={preferredProvider} />
            <NativeSelect className="issue-model-select" disabled={!preferredProvider} label={t("issue.preferredModel")} onValueChange={value => {
            setPreferredModel(value);
            setPreferredEffort("");
          }} options={preferredProvider ? agentModelOptions(providerModels, preferredProvider as AgentProvider, t("settings.providerDefaultModel"), preferredModel, providerModelPreferences[preferredProvider as AgentProvider].favoriteModels) : []} placeholder={t("issue.selectProviderFirst")} searchEmptyMessage={t("issue.noModelsFound")} searchPlaceholder={t("issue.searchModels")} searchable={preferredProvider === "opencode" || preferredProvider === "agy"} value={preferredModel} />
            <NativeSelect className="issue-effort-select" disabled={!preferredProvider || !preferredModel} label={t("settings.effort")} onValueChange={setPreferredEffort} options={preferredProvider ? [{
            label: t("settings.providerDefaultEffort"),
            value: ""
          }, ...agentEffortOptions(providerModels, preferredProvider as AgentProvider, preferredModel, preferredEffort)] : []} placeholder={t("issue.selectModelFirst")} value={preferredEffort} />
            <label className="issue-attachment-trigger">
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
        <footer>
          <span className="issue-submit-hint">
            <kbd>⌘</kbd>
            {t("issue.submitHint")}
          </span>
          <div>
            <button className="issue-cancel-button" disabled={isSubmitting} onClick={closeWithDraft} type="button">
              {t("common.cancel")}
            </button>
            <button className="issue-submit-button" disabled={isSubmitting || !title.trim() || !projectId || titleTooLong} type="submit">
              {isSubmitting && <Spinner size={13} />}
              {isSubmitting ? t("issue.submitting") : t("issue.submit")}
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
