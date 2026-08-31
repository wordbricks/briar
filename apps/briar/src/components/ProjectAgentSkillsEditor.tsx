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
      executionMode: skill.executionMode,
      approvalPolicy: skill.approvalPolicy,
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
        executionMode: "task",
        approvalPolicy: "explicit",
        position: skills.length,
      },
    ]);
  };

  const removeSkill = (index: number) => {
    const next = skills.filter((_, candidateIndex) => candidateIndex !== index);
    onChange(positioned(next));
  };

  return (
    <div className="mt-1 grid gap-3.5 border-t border-border pt-5">
      <div className="flex items-start justify-between gap-4 max-[760px]:flex-col max-[760px]:items-stretch max-[760px]:[&>button]:w-full">
        <span className="grid min-w-0 gap-1">
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
        <div className="grid min-h-36 place-items-center content-center gap-2.5 rounded-xl border border-dashed border-border bg-muted p-5 text-center text-muted-foreground">
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
        <div className="grid gap-3">
          {skills.map((skill, index) => {
            const conversationSkill = skill.executionMode === "conversation";
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
                className="overflow-hidden rounded-xl border border-border bg-card"
                key={skill.id ?? `${skill.kind}-${index}`}
              >
                <header className="flex min-h-12 items-center justify-between gap-3 border-b border-border bg-muted px-3 py-2">
                  <span className="flex min-w-0 items-center gap-2 overflow-hidden">
                    <Wrench aria-hidden="true" size={15} />
                    <strong className="min-w-0 truncate text-xs">
                      {skill.name.trim() || t("agents.untitledSkill")}
                    </strong>
                    {skill.kind === "issue_processing" ? (
                      <small className="min-h-5 shrink-0 whitespace-nowrap rounded-full border border-border bg-card px-2 py-0.5 text-2xs text-muted-foreground">
                        {t("agents.issueProcessingSkill")}
                      </small>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 items-center">
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

                <div className="grid gap-3.5 p-4 [&_.native-select]:w-full [&_.select-menu-trigger]:h-[42px] [&_.select-menu-trigger]:w-full [&_.select-menu-trigger]:rounded-[11px]">
                  <div className="grid min-w-0 gap-2">
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

                  <div className="grid min-w-0 gap-2">
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

                  <div className="grid min-w-0 gap-2">
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

                  {!conversationSkill ? (
                    <div className="grid grid-cols-1 gap-2.5 min-[761px]:grid-cols-[1fr_1.35fr_1fr]">
                      <div className="grid min-w-0 gap-2">
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
                      <div className="grid min-w-0 gap-2">
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
                      <div className="grid min-w-0 gap-2">
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
                  ) : null}
                  <div className="grid grid-cols-1 gap-2.5 min-[761px]:grid-cols-2">
                    <div className="grid min-w-0 gap-2">
                      <Label>{t("agents.skillExecutionMode")}</Label>
                      <NativeSelect
                        disabled={disabled}
                        label={`${accessibleSkillName} · ${t("agents.skillExecutionMode")}`}
                        onValueChange={(value) =>
                          updateSkill(index, {
                            executionMode: value as ProjectAgentSkillInput["executionMode"],
                          })
                        }
                        options={[
                          { label: t("agents.skillExecutionModeConversation"), value: "conversation" },
                          { label: t("agents.skillExecutionModeTask"), value: "task" },
                        ]}
                        value={skill.executionMode}
                      />
                    </div>
                    <div className="grid min-w-0 gap-2">
                      <Label>{t("agents.skillApprovalPolicy")}</Label>
                      <NativeSelect
                        disabled={disabled}
                        label={`${accessibleSkillName} · ${t("agents.skillApprovalPolicy")}`}
                        onValueChange={(value) =>
                          updateSkill(index, {
                            approvalPolicy: value as ProjectAgentSkillInput["approvalPolicy"],
                          })
                        }
                        options={[
                          { label: t("agents.skillApprovalInvokeIsConsent"), value: "invoke_is_consent" },
                          { label: t("agents.skillApprovalExplicit"), value: "explicit" },
                        ]}
                        value={skill.approvalPolicy}
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
