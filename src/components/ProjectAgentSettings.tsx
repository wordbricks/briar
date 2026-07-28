import {
  ArrowLeft,
  Bot,
  Check,
  CircleAlert,
  ImagePlus,
  LoaderCircle,
  Save,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { useI18n } from "../i18n";
import {
  projectAgentAvatarAccept,
  projectAgentAvatarFromFile,
} from "../lib/project-agent-avatar";
import { projectAgentAvatarFromCodexPet } from "../lib/codex-pets";
import type { Project, ProjectAgent, UpdateProjectAgentInput } from "../types";
import { CodexPetAttribution, CodexPetPicker } from "./CodexPetPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Typography } from "@/components/ui/typography";

export function ProjectAgentSettings({
  agent,
  isSidebarOpen,
  onBack,
  onSave,
  project,
}: {
  agent: ProjectAgent;
  isSidebarOpen: boolean;
  onBack: () => void;
  onSave: (input: UpdateProjectAgentInput) => Promise<ProjectAgent>;
  project: Project;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(agent.name);
  const [avatar, setAvatar] = useState(agent.avatar);
  const [codexPet, setCodexPet] = useState(agent.codexPet);
  const [responsibility, setResponsibility] = useState(agent.responsibility);
  const [calendarColor, setCalendarColor] = useState(agent.calendarColor);
  const [savedProfile, setSavedProfile] = useState({
    name: agent.name,
    avatar: agent.avatar,
    codexPet: agent.codexPet,
    responsibility: agent.responsibility,
    calendarColor: agent.calendarColor,
  });
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const profileChanged =
    name !== savedProfile.name ||
    avatar !== savedProfile.avatar ||
    codexPet?.slug !== savedProfile.codexPet?.slug ||
    responsibility !== savedProfile.responsibility ||
    calendarColor !== savedProfile.calendarColor;

  const saveProfile = async () => {
    if (!responsibility.trim() || profileSaving) return;
    setProfileSaving(true);
    setProfileError(null);
    try {
      const saved = await onSave({
        name: name.trim() || null,
        avatar,
        codexPet,
        provider: agent.provider,
        model: agent.model,
        responsibility: responsibility.trim(),
        calendarColor,
      });
      const nextProfile = {
        name: saved.name,
        avatar: saved.avatar,
        codexPet: saved.codexPet,
        responsibility: saved.responsibility,
        calendarColor: saved.calendarColor,
      };
      setName(nextProfile.name);
      setAvatar(nextProfile.avatar);
      setCodexPet(nextProfile.codexPet);
      setResponsibility(nextProfile.responsibility);
      setCalendarColor(nextProfile.calendarColor);
      setSavedProfile(nextProfile);
    } catch (caught) {
      setProfileError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <main
      className="main-content project-agent-settings-page"
      id="project-agent-settings"
    >
      <header
        className={`topbar${isSidebarOpen ? "" : " sidebar-closed"}`}
        data-tauri-drag-region
      />
      <div className="project-agent-settings-scroll">
        <section
          aria-labelledby="project-agent-settings-title"
          className="project-agent-settings-content"
        >
          <button
            className="auto-hunt-session-back project-agent-settings-back"
            onClick={onBack}
            type="button"
          >
            <ArrowLeft size={16} />
            {t("agents.back")}
          </button>
          <header className="project-agent-settings-heading">
            <p className="eyebrow">
              <Bot size={13} />
              {t("agents.settingsEyebrow")}
            </p>
            <h1 id="project-agent-settings-title">
              {t("agents.settingsTitle")}
            </h1>
            <p>
              {t("agents.settingsDescription", {
                name: agent.name,
                project: project.name,
              })}
            </p>
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
                <strong>{t("agents.profileTitle")}</strong>
                <small>{t("agents.profileDescription")}</small>
              </span>
            </header>

            <div className="project-agent-settings-fields">
              <div className="project-agent-avatar-field">
                <span>{t("agents.avatar")}</span>
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
                        avatar ? "agents.replaceAvatar" : "agents.uploadAvatar",
                      )}
                      <input
                        accept={projectAgentAvatarAccept}
                        aria-label={t("agents.uploadAvatar")}
                        disabled={profileSaving}
                        onChange={(event) => {
                          const file = event.currentTarget.files?.[0];
                          event.currentTarget.value = "";
                          if (!file) return;
                          setProfileError(null);
                          void projectAgentAvatarFromFile(file)
                            .then((nextAvatar) => {
                              setAvatar(nextAvatar);
                              setCodexPet(null);
                            })
                            .catch(() =>
                              setProfileError(t("agents.avatarUploadFailed")),
                            );
                        }}
                        type="file"
                      />
                    </label>
                    {avatar ? (
                      <button
                        className="project-agent-avatar-remove"
                        disabled={profileSaving}
                        onClick={() => {
                          setAvatar(null);
                          setCodexPet(null);
                          setProfileError(null);
                        }}
                        type="button"
                      >
                        <Trash2 size={13} />
                        {t("agents.removeAvatar")}
                      </button>
                    ) : null}
                    <small>{t("agents.avatarHint")}</small>
                  </span>
                </div>
                <div className="project-agent-codex-pet-row">
                  <CodexPetPicker
                    disabled={profileSaving}
                    onSelect={async (pet) => {
                      setProfileError(null);
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
              <label>
                <span>{t("agents.name")}</span>
                <input
                  maxLength={100}
                  onChange={(event) => setName(event.target.value)}
                  placeholder={t("agents.namePlaceholder")}
                  value={name}
                />
              </label>
              <label>
                <span>{t("agents.responsibility")}</span>
                <textarea
                  maxLength={2_000}
                  onChange={(event) => setResponsibility(event.target.value)}
                  placeholder={t("agents.responsibilityPlaceholder")}
                  required
                  rows={6}
                  value={responsibility}
                />
                <small>{t("agents.responsibilityHint")}</small>
              </label>
              <label className="project-agent-color-field">
                <span>{t("agents.calendarColor")}</span>
                <div>
                  <input
                    aria-label={t("agents.calendarColor")}
                    onChange={(event) => setCalendarColor(event.target.value)}
                    type="color"
                    value={calendarColor}
                  />
                  <code>{calendarColor.toUpperCase()}</code>
                </div>
                <small>{t("agents.calendarColorHint")}</small>
              </label>
            </div>

            {profileError ? (
              <p className="project-agent-settings-error" role="alert">
                <CircleAlert size={14} />
                {profileError}
              </p>
            ) : null}
            <footer>
              <button
                className="project-agent-settings-save"
                disabled={
                  profileSaving || !responsibility.trim() || !profileChanged
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
              </button>
            </footer>
          </form>

        </section>
      </div>
    </main>
  );
}
