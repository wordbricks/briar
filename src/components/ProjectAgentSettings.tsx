import {
  ArrowLeft,
  Bot,
  Check,
  CircleAlert,
  Cpu,
  ImagePlus,
  LoaderCircle,
  Save,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";
import {
  agentEffortOptions,
  agentModelOptions,
  type AgentProvider,
  type ModelEffort,
} from "../lib/project-llm";
import { useAgentProviderModels } from "../hooks/useAgentProviderModels";
import {
  projectAgentAvatarAccept,
  projectAgentAvatarFromFile,
} from "../lib/project-agent-avatar";
import { projectAgentAvatarFromCodexPet } from "../lib/codex-pets";
import type { Project, ProjectAgent, UpdateProjectAgentInput } from "../types";
import { CodexPetAttribution, CodexPetPicker } from "./CodexPetPicker";
import { NativeSelect } from "./NativeSelect";
import { ProviderSelect } from "./ProviderSelect";
import {
  ProjectAgentSkillsEditor,
  projectAgentSkillInputs,
  projectAgentSkillsValid,
} from "./ProjectAgentSkillsEditor";
import {
  MainContent,
  PageHeader,
} from "@/components/layout";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";

export function ProjectAgentSettings({
  agent,
  isDeleteDisabled,
  isSidebarOpen,
  onBack,
  onDelete,
  onSave,
  project,
}: {
  agent: ProjectAgent;
  isDeleteDisabled: boolean;
  isSidebarOpen: boolean;
  onBack: () => void;
  onDelete: () => Promise<void>;
  onSave: (input: UpdateProjectAgentInput) => Promise<ProjectAgent>;
  project: Project;
}) {
  const { t } = useI18n();
  const { toast } = useToast();
  const providerModels = useAgentProviderModels();
  const [name, setName] = useState(agent.name);
  const [avatar, setAvatar] = useState(agent.avatar);
  const [codexPet, setCodexPet] = useState(agent.codexPet);
  const [provider, setProvider] = useState<AgentProvider>(agent.provider);
  const [model, setModel] = useState(agent.model ?? "");
  const [effort, setEffort] = useState<ModelEffort | null>(agent.effort);
  const [responsibility, setResponsibility] = useState(agent.responsibility);
  const [calendarColor, setCalendarColor] = useState(agent.calendarColor);
  const [skills, setSkills] = useState(() =>
    projectAgentSkillInputs(agent.skills),
  );
  const [savedProfile, setSavedProfile] = useState({
    name: agent.name,
    avatar: agent.avatar,
    codexPet: agent.codexPet,
    provider: agent.provider,
    model: agent.model ?? "",
    effort: agent.effort,
    responsibility: agent.responsibility,
    skills: projectAgentSkillInputs(agent.skills),
    calendarColor: agent.calendarColor,
  });
  const [profileSaving, setProfileSaving] = useState(false);

  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const profileChanged =
    name !== savedProfile.name ||
    avatar !== savedProfile.avatar ||
    codexPet?.slug !== savedProfile.codexPet?.slug ||
    provider !== savedProfile.provider ||
    model !== savedProfile.model ||
    effort !== savedProfile.effort ||
    responsibility !== savedProfile.responsibility ||
    JSON.stringify(skills) !== JSON.stringify(savedProfile.skills) ||
    calendarColor !== savedProfile.calendarColor;
  const modelOptions = agentModelOptions(
    providerModels,
    provider,
    t("agents.providerDefaultModel"),
    model,
  );
  const saveProfile = async () => {
    if (
      !responsibility.trim() ||
      !projectAgentSkillsValid(skills) ||
      profileSaving
    ) return;
    setProfileSaving(true);
    try {
      const saved = await onSave({
        name: name.trim() || null,
        avatar,
        codexPet,
        provider,
        model: model || null,
        effort,
        responsibility: responsibility.trim(),
        skills: projectAgentSkillInputs(skills),
        calendarColor,
      });
      const nextProfile = {
        name: saved.name,
        avatar: saved.avatar,
        codexPet: saved.codexPet,
        provider: saved.provider,
        model: saved.model ?? "",
        effort: saved.effort,
        responsibility: saved.responsibility,
        skills: projectAgentSkillInputs(saved.skills),
        calendarColor: saved.calendarColor,
      };
      setName(nextProfile.name);
      setAvatar(nextProfile.avatar);
      setCodexPet(nextProfile.codexPet);
      setProvider(nextProfile.provider);
      setModel(nextProfile.model);
      setEffort(nextProfile.effort);
      setResponsibility(nextProfile.responsibility);
      setSkills(nextProfile.skills);
      setCalendarColor(nextProfile.calendarColor);
      setSavedProfile(nextProfile);
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : String(caught),
        { tone: "error" },
      );
    } finally {
      setProfileSaving(false);
    }
  };

  const deleteAgent = async () => {
    if (isDeleteDisabled || isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete();
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : String(caught));
      setIsDeleting(false);
    }
  };

  return (
    <MainContent
      className="project-agent-settings-page"
      id="project-agent-settings"
    >
      <PageHeader
        action={
          <Button
            className="project-agent-create project-agent-settings-save"
            disabled={
              profileSaving ||
              !responsibility.trim() ||
              !profileChanged ||
              !projectAgentSkillsValid(skills)
            }
            onClick={() => void saveProfile()}
            type="button"
          >
            {profileSaving ? (
              <LoaderCircle className="spin" size={14} />
            ) : !profileChanged ? (
              <Check size={14} />
            ) : (
              <Save size={14} />
            )}
            {profileSaving
              ? t("agents.updating")
              : !profileChanged
                ? t("common.saved")
                : t("agents.saveProfile")}
          </Button>
        }
        className={`app-page-header project-agents-heading project-agent-settings-heading${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
        title={
          <span className="project-agent-detail-title">
            <Button
              aria-label={t("agents.back")}
              className="project-agent-detail-back project-agent-settings-back"
              onClick={onBack}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </Button>
            <span>{t("agents.settingsTitle")}</span>
          </span>
        }
        titleId="project-agent-settings-title"
      />
      <div className="project-agents-scroll project-agent-settings-scroll">
        <section
          aria-labelledby="project-agent-settings-title"
          className="project-agents-content project-agent-settings-content"
        >
          <div className="project-agents-body project-agent-settings-body">
            <header>
              <div>
                <Typography as="strong" variant="body">
                  {t("agents.profileTitle")}
                </Typography>
                <Typography as="span" tone="muted" variant="caption">
                  {t("agents.settingsDescription", {
                    name: agent.name,
                    project: project.name,
                  })}
                </Typography>
              </div>
            </header>

            <form
              className="project-agent-settings-card"
              onSubmit={(event) => {
                event.preventDefault();
                void saveProfile();
              }}
            >
              <header>
                <span className="project-agent-settings-card-icon">
                  <Bot size={18} strokeWidth={1.8} />
                </span>
                <span>
                  <Typography as="strong" variant="body">
                    {t("agents.profileTitle")}
                  </Typography>
                  <Typography as="small" tone="muted" variant="caption">
                    {t("agents.profileDescription")}
                  </Typography>
                </span>
              </header>

              <div className="project-agent-settings-fields">
                <div className="project-agent-avatar-field">
                  <Label>{t("agents.avatar")}</Label>
                  <div>
                    <span className="project-agent-avatar-preview">
                      {avatar ? (
                        <img alt="" src={avatar} />
                      ) : (
                        <Bot aria-hidden="true" size={26} />
                      )}
                    </span>
                    <span className="project-agent-avatar-actions">
                      <label className="project-agent-avatar-upload">
                        <ImagePlus size={14} />
                        {t(
                          avatar
                            ? "agents.replaceAvatar"
                            : "agents.uploadAvatar",
                        )}
                        <input
                          accept={projectAgentAvatarAccept}
                          aria-label={t("agents.uploadAvatar")}
                          disabled={profileSaving}
                          onChange={(event) => {
                            const file = event.currentTarget.files?.[0];
                            event.currentTarget.value = "";
                            if (!file) return;
                            void projectAgentAvatarFromFile(file)
                              .then((nextAvatar) => {
                                setAvatar(nextAvatar);
                                setCodexPet(null);
                              })
                              .catch(() =>
                                toast(t("agents.avatarUploadFailed"), {
                                  tone: "error",
                                }),
                              );
                          }}
                          type="file"
                        />
                      </label>
                      {avatar ? (
                        <Button
                          className="project-agent-avatar-remove"
                          disabled={profileSaving}
                          onClick={() => {
                            setAvatar(null);
                            setCodexPet(null);
                          }}
                          type="button"
                          variant="outline"
                          size="sm"
                        >
                          <Trash2 size={13} />
                          {t("agents.removeAvatar")}
                        </Button>
                      ) : null}
                      <Typography as="small" tone="muted" variant="caption">
                        {t("agents.avatarHint")}
                      </Typography>
                    </span>
                  </div>
                  <div className="project-agent-codex-pet-row">
                    <CodexPetPicker
                      disabled={profileSaving}
                      onSelect={async (pet) => {
                        const nextAvatar =
                          await projectAgentAvatarFromCodexPet(pet);
                        setAvatar(nextAvatar);
                        setCodexPet({
                          slug: pet.slug,
                          name: pet.name,
                          author: pet.author,
                          license: pet.license,
                          spriteVersion: pet.spriteVersion,
                          spriteSheetUrl: null,
                        });
                      }}
                    />
                    {codexPet ? <CodexPetAttribution pet={codexPet} /> : null}
                  </div>
                </div>
                <div className="project-agent-settings-field">
                  <Label htmlFor="project-agent-settings-name">
                    {t("agents.name")}
                  </Label>
                  <Input
                    id="project-agent-settings-name"
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={t("agents.namePlaceholder")}
                    value={name}
                  />
                </div>
                <div className="project-agent-settings-runtime-heading">
                  <Cpu aria-hidden="true" size={15} />
                  <span>
                    <Typography as="strong" variant="bodySm">
                      {t("agents.executionTitle")}
                    </Typography>
                    <Typography as="small" tone="muted" variant="caption">
                      {t("agents.executionDescription")}
                    </Typography>
                  </span>
                </div>
                <div className="project-agent-settings-field-grid">
                  <div className="project-agent-settings-field">
                    <Label>{t("agents.provider")}</Label>
                    <ProviderSelect
                      disabled={profileSaving}
                      label={t("agents.provider")}
                      onValueChange={(value) => {
                        setProvider(value as AgentProvider);
                        setModel("");
                        setEffort(null);
                      }}
                      value={provider}
                    />
                  </div>
                  <div className="project-agent-settings-field">
                    <Label>{t("agents.model")}</Label>
                    <NativeSelect
                      disabled={profileSaving}
                      label={t("agents.model")}
                      onValueChange={(value) => {
                        setModel(value);
                        setEffort(null);
                      }}
                      options={modelOptions}
                      searchEmptyMessage={t("issue.noModelsFound")}
                      searchPlaceholder={t("issue.searchModels")}
                      searchable={provider === "opencode" || provider === "agy"}
                      value={model}
                    />
                  </div>
                  <div className="project-agent-settings-field">
                    <Label>{t("agents.effort")}</Label>
                    <NativeSelect
                      disabled={profileSaving}
                      label={t("agents.effort")}
                      onValueChange={(value) =>
                        setEffort(
                          (value || null) as ModelEffort | null,
                        )
                      }
                      options={[
                        {
                          label: t("agents.providerDefaultEffort"),
                          value: "",
                        },
                        ...agentEffortOptions(
                          providerModels,
                          provider,
                          model,
                          effort,
                        ),
                      ]}
                      value={effort ?? ""}
                    />
                  </div>
                </div>
                <div className="project-agent-settings-field">
                  <Label htmlFor="project-agent-settings-responsibility">
                    {t("agents.responsibility")}
                  </Label>
                  <Textarea
                    id="project-agent-settings-responsibility"
                    maxLength={2_000}
                    onChange={(event) => setResponsibility(event.target.value)}
                    placeholder={t("agents.responsibilityPlaceholder")}
                    required
                    rows={6}
                    value={responsibility}
                  />
                  <Typography as="small" tone="muted" variant="caption">
                    {t("agents.responsibilityHint")}
                  </Typography>
                </div>
                <div className="project-agent-color-field project-agent-settings-field">
                  <Label htmlFor="project-agent-settings-color">
                    {t("agents.calendarColor")}
                  </Label>
                  <div>
                    <input
                      aria-label={t("agents.calendarColor")}
                      id="project-agent-settings-color"
                      onChange={(event) => setCalendarColor(event.target.value)}
                      type="color"
                      value={calendarColor}
                    />
                    <code>{calendarColor.toUpperCase()}</code>
                  </div>
                  <Typography as="small" tone="muted" variant="caption">
                    {t("agents.calendarColorHint")}
                  </Typography>
                </div>
                <ProjectAgentSkillsEditor
                  defaultEffort={effort}
                  defaultModel={model || null}
                  defaultProvider={provider}
                  disabled={profileSaving}
                  onChange={setSkills}
                  skills={skills}
                />
              </div>

              <footer>
                <Button
                  className="project-agent-settings-save"
                  disabled={
                    profileSaving ||
                    !responsibility.trim() ||
                    !projectAgentSkillsValid(skills) ||
                    !profileChanged
                  }
                  type="submit"
                >
                  {profileSaving ? (
                    <LoaderCircle className="spin" size={14} />
                  ) : !profileChanged ? (
                    <Check size={14} />
                  ) : (
                    <Save size={14} />
                  )}
                  {profileSaving
                    ? t("agents.updating")
                    : !profileChanged
                      ? t("common.saved")
                      : t("agents.saveProfile")}
                </Button>
              </footer>
            </form>

            <section className="project-agent-settings-card danger">
              <header>
                <span className="project-agent-settings-card-icon">
                  <Trash2 size={18} strokeWidth={1.8} />
                </span>
                <span>
                  <Typography as="strong" variant="body">
                    {t("agents.dangerTitle")}
                  </Typography>
                  <Typography as="small" tone="muted" variant="caption">
                    {t("agents.dangerDescription")}
                  </Typography>
                </span>
              </header>
              {isDeleteDisabled ? (
                <p className="project-agent-settings-delete-blocked">
                  <CircleAlert size={14} />
                  {t("agents.deleteBlocked")}
                </p>
              ) : null}
              <footer>
                <Button
                  disabled={isDeleteDisabled}
                  onClick={() => setIsDeleteDialogOpen(true)}
                  type="button"
                  variant="destructive"
                >
                  <Trash2 size={15} />
                  {t("agents.deleteAgent")}
                </Button>
              </footer>
            </section>
          </div>
        </section>
      </div>
      <Dialog
        onOpenChange={(open) => {
          if (isDeleting) return;
          setIsDeleteDialogOpen(open);
          if (!open) setDeleteError(null);
        }}
        open={isDeleteDialogOpen}
      >
        <DialogContent
          aria-label={t("agents.deleteDialog", { name: agent.name })}
          className="sm:max-w-md"
        >
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <Trash2 size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>
              {t("agents.deleteTitle", { name: agent.name })}
            </DialogTitle>
            <DialogDescription>
              {t("agents.deleteDescription")}
            </DialogDescription>
          </DialogHeader>
          {deleteError ? (
            <p className="text-xs text-destructive" role="alert">
              {deleteError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isDeleting}
              onClick={() => setIsDeleteDialogOpen(false)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="project-agent-delete-confirm"
              disabled={isDeleting}
              onClick={() => void deleteAgent()}
              type="button"
              variant="destructive"
            >
              {isDeleting ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <Trash2 size={15} />
              )}
              {isDeleting ? t("agents.deleting") : t("agents.deleteAgent")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </MainContent>
  );
}
