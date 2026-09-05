import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { Bot, Pencil, Plus, Trash2 } from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useState } from "react";

import { requestedOrganizationAgentIdAtom } from "../state/dialogs/atoms";

import { SettingsAlert, SettingsPageHeader } from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useI18n } from "../i18n";
import {
  agentDescriptionMaxLength,
  agentResponsibilityMaxLength,
} from "../lib/agent-limits";
import {
  createOrganizationAgent,
  deleteOrganizationAgent,
  listOrganizationAgents,
  updateOrganizationAgent,
} from "../lib/api";
import {
  type ChannelAgentProvider,
  type ChannelAgentSummary,
} from "../lib/channels-contract";
import {
  agentEffortOptions,
  agentModelOptions,
  type ModelEffort,
} from "../lib/team-llm";
import { useAgentProviderModels } from "../hooks/useAgentProviderModels";
import {
  agentProviderLabels,
  agentProviders,
} from "../lib/agent-provider";
import { AgentProviderIcon } from "./AgentIcons";
import { NativeSelect } from "./NativeSelect";
import { ProviderSelect } from "./ProviderSelect";
import {
  TeamAgentSkillsEditor,
  teamAgentSkillInputs,
  teamAgentSkillsValid,
} from "./TeamAgentSkillsEditor";
import type { TeamAgentSkillInput } from "../types";
import { ComputerUsePolicySwitch } from "./ComputerUsePolicySwitch";

const providers: readonly ChannelAgentProvider[] = agentProviders;

export function OrganizationAgentsSettings({
  organizationId,
  organizationName,
  token,
}: {
  organizationId: string;
  organizationName: string;
  token: string;
}) {
  const { localeTag, t } = useI18n();
  const [agents, setAgents] = useState<ChannelAgentSummary[]>([]);
  const [canManage, setCanManage] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [deletingAgent, setDeletingAgent] =
    useState<ChannelAgentSummary | null>(null);
  const [editingAgent, setEditingAgent] =
    useState<ChannelAgentSummary | null>(null);
  const [editingSkills, setEditingSkills] =
    useState<TeamAgentSkillInput[]>([]);
  const [editingComputerUsePolicy, setEditingComputerUsePolicy] = useState<
    "disabled" | "unattended"
  >("disabled");
  const [isSavingSkills, setIsSavingSkills] = useState(false);
  const [skillSaveError, setSkillSaveError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestedAgentId = useAtomValue(requestedOrganizationAgentIdAtom);
  const setRequestedAgentId = useAtomSet(requestedOrganizationAgentIdAtom);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void listOrganizationAgents(token, organizationId)
      .then((result) => {
        if (cancelled) return;
        setAgents(result.agents.filter((agent) => agent.projectId === null));
        setCanManage(result.canManage);
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organizationId, token]);

  const createAgent = async (input: {
    name: string;
    provider: ChannelAgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    description: string;
    responsibility: string;
    computerUsePolicy: "disabled" | "unattended";
  }) => {
    const result = await createOrganizationAgent(token, organizationId, input);
    setAgents((current) => [...current, result.agent]);
    setIsCreateOpen(false);
  };

  const removeAgent = async () => {
    if (!deletingAgent || isDeleting) return;
    setIsDeleting(true);
    setError(null);
    try {
      await deleteOrganizationAgent(
        token,
        organizationId,
        deletingAgent.agentId,
      );
      setAgents((current) =>
        current.filter((agent) => agent.agentId !== deletingAgent.agentId),
      );
      setDeletingAgent(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsDeleting(false);
    }
  };

  const editSkills = (agent: ChannelAgentSummary) => {
    setSkillSaveError(null);
    setEditingAgent(agent);
    setEditingComputerUsePolicy(agent.computerUsePolicy ?? "disabled");
    setEditingSkills(
      teamAgentSkillInputs(
        agent.skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          body: skill.body,
          provider: skill.provider,
          model: skill.model,
          effort: skill.effort,
          kind: skill.kind,
          executionMode: skill.executionMode,
          approvalPolicy: skill.approvalPolicy,
          position: skill.position,
        })),
      ),
    );
  };

  const saveSkills = async () => {
    if (
      !editingAgent ||
      isSavingSkills ||
      !teamAgentSkillsValid(editingSkills)
    ) return;
    setIsSavingSkills(true);
    setSkillSaveError(null);
    setError(null);
    try {
      const result = await updateOrganizationAgent(
        token,
        organizationId,
        editingAgent.agentId,
        {
          name: editingAgent.name,
          provider: editingAgent.provider,
          model: editingAgent.model,
          effort: editingAgent.effort,
          description: editingAgent.description ?? "",
          responsibility: editingAgent.responsibility,
          computerUsePolicy: editingComputerUsePolicy,
          skills: teamAgentSkillInputs(editingSkills),
        },
      );
      setAgents((current) =>
        current.map((agent) =>
          agent.agentId === result.agent.agentId ? result.agent : agent,
        ),
      );
      setEditingAgent(null);
      setEditingSkills([]);
      setSkillSaveError(null);
    } catch (caught) {
      setSkillSaveError(
        caught instanceof Error ? caught.message : String(caught),
      );
    } finally {
      setIsSavingSkills(false);
    }
  };

  /*
    "Edit Profile" in the sidebar's conversation menu navigates here and leaves
    the Agent it meant in the atom. The list arrives asynchronously, so the
    request waits until the Agent is actually in it, and is cleared as soon as
    its editor opens — a later visit to this page starts closed.
  */
  useEffect(() => {
    if (!requestedAgentId) return;
    const requested = agents.find(
      (agent) => agent.agentId === requestedAgentId,
    );
    if (!requested) return;
    setRequestedAgentId(null);
    editSkills(requested);
  }, [agents, requestedAgentId, setRequestedAgentId]);

  return (
    <>
      <div className="mb-7 flex items-start justify-between gap-4">
        <SettingsPageHeader
          className="mb-0 max-w-none"
          description={t("organization.agentsDescription", {
            name: organizationName,
          })}
          title={t("organization.agentsTitle")}
        />
        {canManage ? (
          <Button
            className="mt-1 shrink-0"
            onClick={() => setIsCreateOpen(true)}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            {t("organization.agentsCreate")}
          </Button>
        ) : null}
      </div>

      {error ? <SettingsAlert className="mb-4 mt-0">{error}</SettingsAlert> : null}

      {isLoading ? (
        <div
          aria-live="polite"
          className="flex min-h-48 items-center justify-center gap-2 rounded-xl border border-border bg-card text-muted-foreground"
        >
          <Spinner className="size-[20px]" />
          <Typography variant="bodySm">{t("organization.agentsLoading")}</Typography>
        </div>
      ) : agents.length === 0 ? (
        <div className="grid min-h-64 place-items-center rounded-xl border border-dashed border-border bg-card p-8 text-center">
          <div className="grid max-w-md justify-items-center gap-3">
            <span className="grid size-12 place-items-center rounded-full bg-secondary text-muted-foreground">
              <Bot aria-hidden="true" size={23} />
            </span>
            <div>
              <Typography as="h2" variant="bodyLg">
                {t("organization.agentsEmptyTitle")}
              </Typography>
              <Typography className="mt-1" tone="muted" variant="bodySm">
                {t("organization.agentsEmptyDescription")}
              </Typography>
            </div>
            {canManage ? (
              <Button onClick={() => setIsCreateOpen(true)} type="button">
                <Plus aria-hidden="true" size={16} />
                {t("organization.agentsCreate")}
              </Button>
            ) : (
              <Typography tone="muted" variant="caption">
                {t("organization.agentsPermission")}
              </Typography>
            )}
          </div>
        </div>
      ) : (
        <section
          aria-label={t("organization.agentsList")}
          className="grid gap-3"
        >
          {agents.map((agent) => (
            <article
              className="grid gap-4 rounded-xl border border-border bg-card p-5 shadow-xs md:grid-cols-[minmax(0,1fr)_auto]"
              key={agent.agentId}
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="grid size-8 place-items-center rounded-lg bg-secondary text-foreground">
                    <AgentProviderIcon provider={agent.provider} size={16} />
                  </span>
                  <Typography as="h2" variant="bodyLg">
                    {agent.name}
                  </Typography>
                </div>
                <Typography className="mt-3 whitespace-pre-wrap" variant="bodySm">
                  {agent.description || agent.responsibility}
                </Typography>
                {agent.skills.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {agent.skills.map((skill) => (
                      <Badge key={skill.id} variant="outline">
                        {skill.name}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                  <Typography as="span" variant="caption">
                    {agentProviderLabels[agent.provider]}
                    {agent.model ? ` · ${agent.model}` : ""}
                  </Typography>
                  <time dateTime={agent.createdAt}>
                    <Typography as="span" variant="caption">
                      {t("organization.agentsCreated", {
                        date: new Intl.DateTimeFormat(localeTag, {
                          dateStyle: "medium",
                        }).format(new Date(agent.createdAt)),
                      })}
                    </Typography>
                  </time>
                </div>
              </div>
              {canManage ? (
                <div className="flex self-start">
                  <Button
                    aria-label={`${agent.name} · ${t("agents.skills")}`}
                    className="text-muted-foreground"
                    onClick={() => editSkills(agent)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Pencil aria-hidden="true" size={15} />
                  </Button>
                  <Button
                    aria-label={t("organization.agentsDelete", {
                      name: agent.name,
                    })}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDeletingAgent(agent)}
                    size="icon-sm"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </section>
      )}

      <OrganizationAgentCreateDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={createAgent}
      />

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isSavingSkills) {
            setEditingAgent(null);
            setEditingSkills([]);
            setEditingComputerUsePolicy("disabled");
            setSkillSaveError(null);
          }
        }}
        open={editingAgent !== null}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>
              {editingAgent?.name ?? ""} · {t("agents.skills")}
            </DialogTitle>
            <DialogDescription>{t("agents.skillsDescription")}</DialogDescription>
          </DialogHeader>
          {skillSaveError ? (
            <SettingsAlert className="mt-0">{skillSaveError}</SettingsAlert>
          ) : null}
          {editingAgent ? (
            <div className="grid gap-5">
              <ComputerUsePolicySwitch
                disabled={isSavingSkills}
                onChange={setEditingComputerUsePolicy}
                policy={editingComputerUsePolicy}
                provider={editingAgent.provider}
              />
              <TeamAgentSkillsEditor
                defaultEffort={editingAgent.effort}
                defaultModel={editingAgent.model}
                defaultProvider={editingAgent.provider}
                disabled={isSavingSkills}
                onChange={setEditingSkills}
                skills={editingSkills}
              />
            </div>
          ) : null}
          <DialogFooter>
            <Button
              disabled={isSavingSkills}
              onClick={() => {
                setEditingAgent(null);
                setEditingSkills([]);
                setEditingComputerUsePolicy("disabled");
                setSkillSaveError(null);
              }}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={
                isSavingSkills || !teamAgentSkillsValid(editingSkills)
              }
              onClick={() => void saveSkills()}
              type="button"
            >
              {isSavingSkills ? (
                <Spinner className="size-[16px]" />
              ) : null}
              {t(isSavingSkills ? "common.saving" : "common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeletingAgent(null);
        }}
        open={deletingAgent !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {t("organization.agentsDeleteTitle", {
                name: deletingAgent?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("organization.agentsDeleteDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={isDeleting}
              onClick={() => setDeletingAgent(null)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={isDeleting}
              onClick={() => void removeAgent()}
              type="button"
              variant="destructive"
            >
              {isDeleting ? <Spinner className="size-[16px]" /> : null}
              {t(
                isDeleting
                  ? "organization.agentsDeleting"
                  : "organization.agentsDeleteAction",
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function OrganizationAgentCreateDialog({
  isOpen,
  onClose,
  onCreate,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: {
    name: string;
    provider: ChannelAgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    description: string;
    responsibility: string;
    computerUsePolicy: "disabled" | "unattended";
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const providerModels = useAgentProviderModels(isOpen);
  const [name, setName] = useState("");
  const [provider, setProvider] =
    useState<ChannelAgentProvider>("codex");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<ModelEffort | null>(null);
  const [description, setDescription] = useState("");
  const [responsibility, setResponsibility] = useState("");
  const [computerUsePolicy, setComputerUsePolicy] = useState<
    "disabled" | "unattended"
  >("disabled");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen) {
      setName("");
      setProvider("codex");
      setModel("");
      setEffort(null);
      setDescription("");
      setResponsibility("");
      setComputerUsePolicy("disabled");
      setError(null);
    }
  }, [isOpen]);

  const canSubmit =
    name.trim().length > 0 &&
    responsibility.trim().length > 0 &&
    !isSubmitting;

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !isSubmitting) onClose();
      }}
      open={isOpen}
    >
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("organization.agentsCreateTitle")}</DialogTitle>
          <DialogDescription>
            {t("organization.agentsCreateDescription")}
          </DialogDescription>
        </DialogHeader>

        {error ? <SettingsAlert className="mt-0">{error}</SettingsAlert> : null}

        <form
          className="grid gap-5"
          id="organization-agent-create-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canSubmit) return;
            setIsSubmitting(true);
            setError(null);
            void onCreate({
              name: name.trim(),
              provider,
              model: model || null,
              effort,
              description: description.trim(),
              responsibility: responsibility.trim(),
              computerUsePolicy,
            })
              .catch((caught) =>
                setError(caught instanceof Error ? caught.message : String(caught)),
              )
              .finally(() => setIsSubmitting(false));
          }}
        >
          <div className="grid gap-2">
            <Label htmlFor="organization-agent-name">
              {t("agents.name")} · {t("common.required")}
            </Label>
            <Input
              autoFocus
              id="organization-agent-name"
              maxLength={100}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("organization.agentsNamePlaceholder")}
              required
              value={name}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="organization-agent-description">
              {t("agents.agentDescription")} · {t("common.optional")}
            </Label>
            <Textarea
              id="organization-agent-description"
              maxLength={agentDescriptionMaxLength}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("agents.agentDescriptionPlaceholder")}
              rows={3}
              value={description}
            />
            <Typography tone="muted" variant="caption">
              {t("agents.agentDescriptionHint")}
            </Typography>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>{t("agents.provider")}</Label>
              <ProviderSelect
                label={t("agents.provider")}
                onValueChange={(value) => {
                  setProvider(value as ChannelAgentProvider);
                  if (value !== "grok") setComputerUsePolicy("disabled");
                  setModel("");
                  setEffort(null);
                }}
                providers={providers}
                value={provider}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("agents.model")}</Label>
              <NativeSelect
                label={t("agents.model")}
                onValueChange={(value) => {
                  setModel(value);
                  setEffort(null);
                }}
                options={agentModelOptions(
                  providerModels,
                  provider,
                  t("agents.providerDefaultModel"),
                )}
                searchEmptyMessage={t("issue.noModelsFound")}
                searchPlaceholder={t("issue.searchModels")}
                searchable={provider === "opencode" || provider === "agy"}
                value={model}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("agents.effort")}</Label>
              <NativeSelect
                label={t("agents.effort")}
                onValueChange={(value) =>
                  setEffort((value || null) as ModelEffort | null)
                }
                options={[
                  { label: t("agents.providerDefaultEffort"), value: "" },
                  ...agentEffortOptions(providerModels, provider, model, effort),
                ]}
                value={effort ?? ""}
              />
            </div>
          </div>

          <ComputerUsePolicySwitch
            disabled={isSubmitting}
            onChange={setComputerUsePolicy}
            policy={computerUsePolicy}
            provider={provider}
          />

          <div className="grid gap-2">
            <Label htmlFor="organization-agent-responsibility">
              {t("agents.responsibility")} · {t("common.required")}
            </Label>
            <Textarea
              id="organization-agent-responsibility"
              maxLength={agentResponsibilityMaxLength}
              onChange={(event) => setResponsibility(event.target.value)}
              placeholder={t("agents.responsibilityPlaceholder")}
              required
              rows={5}
              value={responsibility}
            />
            <Typography tone="muted" variant="caption">
              {t("organization.agentsResponsibilityHint")}
            </Typography>
          </div>
        </form>

        <DialogFooter>
          <Button
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            form="organization-agent-create-form"
            type="submit"
          >
            {isSubmitting ? (
              <Spinner className="size-[16px]" />
            ) : (
              <Plus aria-hidden="true" size={16} />
            )}
            {t(
              isSubmitting
                ? "organization.agentsCreating"
                : "organization.agentsCreate",
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
