import { Bot, LoaderCircle, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
  createOrganizationAgent,
  deleteOrganizationAgent,
  listOrganizationAgents,
} from "../lib/api";
import {
  handleFromName,
  type ChannelAgentProvider,
  type ChannelAgentSummary,
} from "../lib/channels-contract";
import {
  agentEfforts,
  agentModels,
  type ModelEffort,
} from "../lib/project-llm";
import { AgentProviderIcon } from "./AgentIcons";
import { NativeSelect } from "./NativeSelect";

const providers: ChannelAgentProvider[] = [
  "codex",
  "claude",
  "grok",
  "opencode",
];

const providerLabels: Record<ChannelAgentProvider, string> = {
  codex: "Codex",
  claude: "Claude",
  grok: "Grok",
  opencode: "OpenCode",
};

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
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    handle?: string;
    provider: ChannelAgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    responsibility: string;
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
          <LoaderCircle className="animate-spin" size={20} />
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
                  {agent.handle ? (
                    <Badge variant="secondary">@{agent.handle}</Badge>
                  ) : null}
                </div>
                <Typography className="mt-3 whitespace-pre-wrap" variant="bodySm">
                  {agent.responsibility}
                </Typography>
                <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                  <Typography as="span" variant="caption">
                    {providerLabels[agent.provider]}
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
                <Button
                  aria-label={t("organization.agentsDelete", {
                    name: agent.name,
                  })}
                  className="self-start text-muted-foreground hover:text-destructive"
                  onClick={() => setDeletingAgent(agent)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 aria-hidden="true" size={15} />
                </Button>
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
              {isDeleting ? <LoaderCircle className="animate-spin" size={16} /> : null}
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
    handle?: string;
    provider: ChannelAgentProvider;
    model: string | null;
    effort: ModelEffort | null;
    responsibility: string;
  }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [isHandleCustomized, setIsHandleCustomized] = useState(false);
  const [provider, setProvider] =
    useState<ChannelAgentProvider>("codex");
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState<ModelEffort | null>(null);
  const [responsibility, setResponsibility] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generatedHandle = useMemo(() => handleFromName(name), [name]);

  useEffect(() => {
    if (!isOpen) {
      setName("");
      setHandle("");
      setIsHandleCustomized(false);
      setProvider("codex");
      setModel("");
      setEffort(null);
      setResponsibility("");
      setError(null);
    }
  }, [isOpen]);

  const canSubmit =
    name.trim().length > 0 &&
    responsibility.trim().length > 0 &&
    (!handle || /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(handle)) &&
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
              handle: handle || undefined,
              provider,
              model: model || null,
              effort,
              responsibility: responsibility.trim(),
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
              onChange={(event) => {
                const nextName = event.target.value;
                setName(nextName);
                if (!isHandleCustomized) setHandle(handleFromName(nextName));
              }}
              placeholder={t("organization.agentsNamePlaceholder")}
              required
              value={name}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="organization-agent-handle">
              {t("organization.agentsHandle")}
            </Label>
            <div className="flex items-center rounded-md border border-input bg-background shadow-xs focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
              <span className="pl-3 text-muted-foreground">@</span>
              <Input
                aria-describedby="organization-agent-handle-help"
                className="border-0 pl-0.5 shadow-none focus-visible:ring-0"
                id="organization-agent-handle"
                maxLength={63}
                onChange={(event) => {
                  setIsHandleCustomized(true);
                  setHandle(event.target.value.toLowerCase());
                }}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                placeholder={
                  generatedHandle || t("organization.agentsHandleGenerated")
                }
                value={handle}
              />
            </div>
            <Typography
              id="organization-agent-handle-help"
              tone="muted"
              variant="caption"
            >
              {name.trim() && !generatedHandle && !handle
                ? t("organization.agentsHandleFallback")
                : t("organization.agentsHandleHint")}
            </Typography>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="grid gap-2">
              <Label>{t("agents.provider")}</Label>
              <NativeSelect
                label={t("agents.provider")}
                onValueChange={(value) => {
                  setProvider(value as ChannelAgentProvider);
                  setModel("");
                  setEffort(null);
                }}
                options={providers.map((candidate) => ({
                  label: providerLabels[candidate],
                  value: candidate,
                }))}
                value={provider}
              />
            </div>
            <div className="grid gap-2">
              <Label>{t("agents.model")}</Label>
              <NativeSelect
                label={t("agents.model")}
                onValueChange={setModel}
                options={agentModels[provider].map((option) => ({
                  ...option,
                  label:
                    option.value === ""
                      ? t("agents.providerDefaultModel")
                      : option.label,
                }))}
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
                  ...agentEfforts[provider].map((candidate) => ({
                    label: candidate,
                    value: candidate,
                  })),
                ]}
                value={effort ?? ""}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="organization-agent-responsibility">
              {t("agents.responsibility")} · {t("common.required")}
            </Label>
            <Textarea
              id="organization-agent-responsibility"
              maxLength={2_000}
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
              <LoaderCircle className="animate-spin" size={16} />
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
