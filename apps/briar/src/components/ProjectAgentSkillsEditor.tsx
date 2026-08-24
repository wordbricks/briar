import { Plus, Trash2, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import {
  agentSkillBodyMaxLength,
  agentSkillDescriptionMaxLength,
  agentSkillsMaxCount,
} from "../lib/agent-limits";
import {
  agentEffortOptions,
  agentModelOptions,
  type AgentProvider,
  type ModelEffort,
} from "../lib/project-llm";
import { useAgentProviderModels } from "../hooks/useAgentProviderModels";
import type { ProjectAgentSkillInput } from "../types";
import { NativeSelect } from "./NativeSelect";
import { ProviderSelect } from "./ProviderSelect";

function positioned(skills: ProjectAgentSkillInput[]) {
  return skills.map((skill, position) => ({ ...skill, position }));
}

export function projectAgentSkillInputs(
  skills: readonly ProjectAgentSkillInput[],
): ProjectAgentSkillInput[] {
  const next = skills.map((skill, position) => {
    const input = {
      name: skill.name,
      description: skill.description,
      body: skill.body,
      provider: skill.provider,
      model: skill.model,
      effort: skill.effort,
      kind: skill.kind,
      position,
    };
    return skill.id ? { id: skill.id, ...input } : input;
  });
  return next;
}

export function projectAgentSkillsValid(
  skills: readonly ProjectAgentSkillInput[],
) {
  const names = skills.map((skill) =>
    skill.name.trim().normalize("NFKC").toLocaleLowerCase(),
  );
  return (
    skills.length <= agentSkillsMaxCount &&
    new Set(names).size === names.length &&
    skills.every(
      (skill) =>
        skill.name.trim() &&
        skill.description.trim() &&
        skill.description.length <= agentSkillDescriptionMaxLength &&
        skill.body.trim() &&
        skill.body.length <= agentSkillBodyMaxLength,
    )
  );
}

export function ProjectAgentSkillsEditor({
  defaultEffort,
  defaultModel,
  defaultProvider,
  disabled = false,
  onChange,
  skills,
}: {
  defaultEffort: ModelEffort | null;
  defaultModel: string | null;
  defaultProvider: AgentProvider;
  disabled?: boolean;
  onChange: (skills: ProjectAgentSkillInput[]) => void;
  skills: ProjectAgentSkillInput[];
}) {
  const { t } = useI18n();
  const providerModels = useAgentProviderModels();

  const updateSkill = (
    index: number,
    update: Partial<ProjectAgentSkillInput>,
  ) => {
    onChange(
      positioned(
        skills.map((skill, candidateIndex) =>
          candidateIndex === index ? { ...skill, ...update } : skill,
        ),
      ),
    );
  };

  const addSkill = () => {
    if (skills.length >= agentSkillsMaxCount) return;
    onChange([
      ...positioned(skills),
      {
        id: crypto.randomUUID(),
        name: "",
        description: "",
        body: "",
        provider: defaultProvider,
        model: defaultModel,
        effort: defaultEffort,
        kind: "custom",
        position: skills.length,
      },
    ]);
  };

  const removeSkill = (index: number) => {
    const next = skills.filter((_, candidateIndex) => candidateIndex !== index);
    onChange(positioned(next));
  };

  return (
    <div className="project-agent-skills-editor">
      <div className="project-agent-skills-editor-heading">
        <span>
          <Typography as="strong" variant="bodySm">
            {t("agents.skills")}
          </Typography>
          <Typography as="small" tone="muted" variant="caption">
            {t("agents.skillsDescription")}
          </Typography>
        </span>
        <Button
          disabled={disabled || skills.length >= agentSkillsMaxCount}
          onClick={addSkill}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus aria-hidden="true" size={14} />
          {t("agents.addSkill")}
        </Button>
      </div>

      {skills.length === 0 ? (
        <div className="project-agent-skills-empty">
          <Wrench aria-hidden="true" size={20} />
          <Typography tone="muted" variant="caption">
            {t("agents.skillsEmpty")}
          </Typography>
          <Button
            disabled={disabled}
            onClick={addSkill}
            size="sm"
            type="button"
          >
            <Plus aria-hidden="true" size={14} />
            {t("agents.addSkill")}
          </Button>
        </div>
      ) : (
        <div className="project-agent-skill-list">
          {skills.map((skill, index) => {
            const modelOptions = agentModelOptions(
              providerModels,
              skill.provider,
              t("agents.providerDefaultModel"),
              skill.model,
            );
            const accessibleSkillName =
              skill.name.trim() || t("agents.untitledSkill");
            return (
              <section
                className="project-agent-skill-card"
                key={skill.id ?? `${skill.kind}-${index}`}
              >
                <header>
                  <span>
                    <Wrench aria-hidden="true" size={15} />
                    <strong>
                      {skill.name.trim() || t("agents.untitledSkill")}
                    </strong>
                    {skill.kind === "issue_processing" ? (
                      <small>{t("agents.issueProcessingSkill")}</small>
                    ) : null}
                  </span>
                  <span>
                    <Button
                      aria-label={t("agents.deleteSkill", {
                        name: skill.name.trim() || t("agents.untitledSkill"),
                      })}
                      disabled={disabled}
                      onClick={() => removeSkill(index)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </Button>
                  </span>
                </header>

                <div className="project-agent-skill-fields">
                  <div className="project-agent-settings-field">
                    <Label htmlFor={`project-agent-skill-name-${index}`}>
                      {t("agents.skillName")}
                    </Label>
                    <Input
                      disabled={disabled}
                      id={`project-agent-skill-name-${index}`}
                      maxLength={100}
                      onChange={(event) =>
                        updateSkill(index, { name: event.target.value })
                      }
                      placeholder={t("agents.skillNamePlaceholder")}
                      required
                      value={skill.name}
                    />
                  </div>

                  <div className="project-agent-settings-field">
                    <Label
                      htmlFor={`project-agent-skill-description-${index}`}
                    >
                      {t("agents.skillDescription")}
                    </Label>
                    <Textarea
                      disabled={disabled}
                      id={`project-agent-skill-description-${index}`}
                      maxLength={agentSkillDescriptionMaxLength}
                      onChange={(event) =>
                        updateSkill(index, {
                          description: event.target.value,
                        })
                      }
                      placeholder={t("agents.skillDescriptionPlaceholder")}
                      required
                      rows={2}
                      value={skill.description}
                    />
                  </div>

                  <div className="project-agent-settings-field">
                    <Label htmlFor={`project-agent-skill-body-${index}`}>
                      {t("agents.skillBody")}
                    </Label>
                    <Textarea
                      disabled={disabled}
                      id={`project-agent-skill-body-${index}`}
                      maxLength={agentSkillBodyMaxLength}
                      onChange={(event) =>
                        updateSkill(index, { body: event.target.value })
                      }
                      placeholder={t("agents.skillBodyPlaceholder")}
                      required
                      rows={6}
                      value={skill.body}
                    />
                  </div>

                  <div className="project-agent-skill-runtime-grid">
                    <div className="project-agent-settings-field">
                      <Label>{t("agents.provider")}</Label>
                      <ProviderSelect
                        disabled={disabled}
                        label={`${accessibleSkillName} · ${t("agents.provider")}`}
                        onValueChange={(value) =>
                          updateSkill(index, {
                            provider: value as AgentProvider,
                            model: null,
                            effort: null,
                          })
                        }
                        value={skill.provider}
                      />
                    </div>
                    <div className="project-agent-settings-field">
                      <Label>{t("agents.model")}</Label>
                      <NativeSelect
                        disabled={disabled}
                        label={`${accessibleSkillName} · ${t("agents.model")}`}
                        onValueChange={(value) =>
                          updateSkill(index, {
                            model: value || null,
                            effort: null,
                          })
                        }
                        options={modelOptions}
                        searchEmptyMessage={t("issue.noModelsFound")}
                        searchPlaceholder={t("issue.searchModels")}
                        searchable={skill.provider === "opencode" || skill.provider === "agy"}
                        value={skill.model ?? ""}
                      />
                    </div>
                    <div className="project-agent-settings-field">
                      <Label>{t("agents.effort")}</Label>
                      <NativeSelect
                        disabled={disabled}
                        label={`${accessibleSkillName} · ${t("agents.effort")}`}
                        onValueChange={(value) =>
                          updateSkill(index, {
                            effort: (value || null) as ModelEffort | null,
                          })
                        }
                        options={[
                          {
                            label: t("agents.providerDefaultEffort"),
                            value: "",
                          },
                          ...agentEffortOptions(
                            providerModels,
                            skill.provider,
                            skill.model,
                            skill.effort,
                          ),
                        ]}
                        value={skill.effort ?? ""}
                      />
                    </div>
                  </div>
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
