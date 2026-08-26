import {
  ArrowLeft,
  Bot,
  Check,
  CircleAlert,
  Cpu,
  ImagePlus,
  Save,
  Trash2,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useState } from "react";
import { useI18n } from "../i18n";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
} from "../lib/agent-limits";
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
  const [description, setDescription] = useState(agent.description ?? "");
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
    description: agent.description ?? "",
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
    description !== savedProfile.description ||
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
        description: description.trim(),
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
        description: saved.description ?? "",
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
      setDescription(nextProfile.description);
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
      className="flex h-full min-h-0 flex-col overflow-hidden bg-card"
      id="project-agent-settings"
    >
      <PageHeader
        action={
          <Button
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
              <Spinner size={14} />
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
        className={`h-12 min-h-12 shrink-0 px-5 py-0${
          isSidebarOpen
            ? ""
            : " pl-[var(--window-navigation-content-inset)]"
        }`}
        data-tauri-drag-region
        title={
          <span className="flex min-w-0 items-center gap-2.5">
            <Button
              aria-label={t("agents.back")}
              className="size-7 shrink-0 text-muted-foreground shadow-none"
              onClick={onBack}
              size="icon"
              type="button"
              variant="ghost"
            >
              <ArrowLeft aria-hidden="true" size={16} />
            </Button>
            <span className="truncate">{t("agents.settingsTitle")}</span>
          </span>
        }
        titleId="project-agent-settings-title"
      />
      <div className="scrollbar-subtle min-h-0 flex-1 overflow-y-auto bg-card">
        <section
          aria-labelledby="project-agent-settings-title"
          className="min-h-full pb-14"
        >
          <div className="mx-auto w-full max-w-[760px] px-5 pt-8 min-[761px]:px-8">
            <header className="mb-5">
              <div className="grid items-start gap-1.5">
                <Typography as="strong" variant="bodyLg">
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
              className="rounded-2xl border border-border bg-card p-[22px] shadow-xs"
              onSubmit={(event) => {
                event.preventDefault();
                void saveProfile();
              }}
            >
              <header className="flex items-start gap-3">
                <span className="grid size-[46px] shrink-0 place-items-center rounded-xl border border-border bg-muted text-muted-foreground">
                  <Bot size={18} strokeWidth={1.8} />
                </span>
                <span className="grid min-w-0 gap-1">
                  <Typography as="strong" variant="bodyLg">
                    {t("agents.profileTitle")}
                  </Typography>
                  <Typography as="small" tone="muted" variant="caption">
                    {t("agents.profileDescription")}
                  </Typography>
                </span>
              </header>

              <div className="mt-5 grid gap-[17px] [&_.native-select]:w-full [&_.select-menu-trigger]:h-[42px] [&_.select-menu-trigger]:w-full [&_.select-menu-trigger]:rounded-[11px]">
                <div className="grid min-w-0 gap-2 text-2xs font-semibold text-foreground">
                  <Label>{t("agents.avatar")}</Label>
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span className="grid size-18 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-muted text-muted-foreground [&>img]:size-full [&>img]:object-cover">
                      {avatar ? (
                        <img alt="" src={avatar} />
                      ) : (
                        <Bot aria-hidden="true" size={26} />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-2">
                      <label className="inline-flex min-h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-input bg-card px-2.5 text-2xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
                        <ImagePlus size={14} />
                        {t(
                          avatar
                            ? "agents.replaceAvatar"
                            : "agents.uploadAvatar",
                        )}
                        <input
                          accept={projectAgentAvatarAccept}
                          aria-label={t("agents.uploadAvatar")}
                          className="sr-only"
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
                      <Typography
                        as="small"
                        className="w-full font-medium"
                        tone="muted"
                        variant="caption"
                      >
                        {t("agents.avatarHint")}
                      </Typography>
                    </span>
                  </div>
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
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
                <div className="grid min-w-0 gap-2">
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
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="project-agent-settings-description">
                    {t("agents.agentDescription")}
                  </Label>
                  <Textarea
                    id="project-agent-settings-description"
                    maxLength={agentDescriptionMaxLength}
                    onChange={(event) => setDescription(event.target.value)}
                    placeholder={t("agents.agentDescriptionPlaceholder")}
                    rows={3}
                    value={description}
                  />
                  <Typography as="small" tone="muted" variant="caption">
                    {t("agents.agentDescriptionHint")}
                  </Typography>
                </div>
                <div className="mt-1 flex items-start gap-2 border-t border-border pt-[17px] text-muted-foreground">
                  <Cpu aria-hidden="true" className="mt-0.5 shrink-0" size={15} />
                  <span className="grid min-w-0 gap-1">
                    <Typography as="strong" variant="bodySm">
                      {t("agents.executionTitle")}
                    </Typography>
                    <Typography as="small" tone="muted" variant="caption">
                      {t("agents.executionDescription")}
                    </Typography>
                  </span>
                </div>
                <div className="grid grid-cols-1 gap-3 min-[761px]:grid-cols-[1fr_1.35fr]">
                  <div className="grid min-w-0 gap-2">
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
                  <div className="grid min-w-0 gap-2">
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
                  <div className="grid min-w-0 gap-2">
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
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="project-agent-settings-responsibility">
                    {t("agents.responsibility")}
                  </Label>
                  <Textarea
                    id="project-agent-settings-responsibility"
                    maxLength={agentResponsibilityMaxLength}
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
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="project-agent-settings-color">
                    {t("agents.calendarColor")}
                  </Label>
                  <div className="flex h-[42px] items-center gap-2.5 rounded-[11px] border border-border bg-muted px-3">
                    <input
                      aria-label={t("agents.calendarColor")}
                      className="size-7 cursor-pointer rounded-lg border border-border bg-card p-0.5"
                      id="project-agent-settings-color"
                      onChange={(event) => setCalendarColor(event.target.value)}
                      type="color"
                      value={calendarColor}
                    />
                    <code className="font-mono text-2xs font-semibold text-foreground">
                      {calendarColor.toUpperCase()}
                    </code>
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

              <footer className="mt-5 flex justify-end border-t border-border pt-4 max-[760px]:[&>button]:w-full">
                <Button
                  disabled={
                    profileSaving ||
                    !responsibility.trim() ||
                    !projectAgentSkillsValid(skills) ||
                    !profileChanged
                  }
                  type="submit"
                >
                  {profileSaving ? (
                    <Spinner size={14} />
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

            <section className="mt-[18px] rounded-2xl border border-destructive/30 bg-card p-[22px] shadow-xs">
              <header className="flex items-start gap-3">
                <span className="grid size-[46px] shrink-0 place-items-center rounded-xl border border-destructive/25 bg-destructive/10 text-destructive">
                  <Trash2 size={18} strokeWidth={1.8} />
                </span>
                <span className="grid min-w-0 gap-1">
                  <Typography as="strong" variant="bodyLg">
                    {t("agents.dangerTitle")}
                  </Typography>
                  <Typography as="small" tone="muted" variant="caption">
                    {t("agents.dangerDescription")}
                  </Typography>
                </span>
              </header>
              {isDeleteDisabled ? (
                <p className="mt-4 flex items-center gap-1.5 text-2xs leading-relaxed text-destructive">
                  <CircleAlert className="shrink-0" size={14} />
                  {t("agents.deleteBlocked")}
                </p>
              ) : null}
              <footer className="mt-5 flex justify-start border-t border-border pt-4">
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
              disabled={isDeleting}
              onClick={() => void deleteAgent()}
              type="button"
              variant="destructive"
            >
              {isDeleting ? (
                <Spinner size={15} />
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
