import {
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Github,
  KeyRound,
  Laptop,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import {
  ManagedComputerSetupCancelSchema,
  ManagedComputerSetupChallengeKind,
  ManagedComputerSetupChallengeService,
  ManagedComputerSetupPhase,
  ManagedComputerSetupStartSchema,
  ManagedComputerSetupStateStatus,
  ManagedComputerSetupSubmitSchema,
  ManagedComputerSetupToAgentSchema,
  type ManagedComputerSetupToController,
  ManagedComputerSetupToControllerSchema,
} from "@briar/contracts/gen/briar/worker/v1/managed_computer_setup_pb";

import { useI18n } from "../i18n";
import { AgentProviderIcon } from "./AgentIcons";
import { SelectMenu } from "./SelectMenu";
import { Button } from "./ui/button";
import { ChoiceCard } from "./ui/choice-card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Spinner } from "./ui/spinner";
import { Typography } from "./ui/typography";
import { createManagedComputerSetupSession } from "../lib/api";
import { openExternalUrl } from "../lib/auth-session";
import {
  agentProviderLabels,
  managedComputerSetupProviders,
  type ManagedComputerSetupProvider,
} from "../lib/agent-provider";
import {
  isManagedComputerSetupToController,
  managedComputerSetupProviderToProto,
} from "../lib/managed-computer-setup-codec";
import type {
  ManagedComputer,
  Project,
} from "../types";

type WizardScreen = "start" | "running" | "complete" | "error";
type ManagedComputerSetupMode = "setup" | "add_project";
type SetupPhase = "github" | "provider" | "repository" | "worker";
type SetupChallenge = {
  challengeId: string;
  service: "github" | "provider";
  kind: "device_code" | "authorization_code" | "api_key";
  verificationUri: string;
  userCode?: string;
};

const setupPhaseFromProto = (
  phase: ManagedComputerSetupPhase,
): SetupPhase | null => {
  switch (phase) {
    case ManagedComputerSetupPhase.GITHUB:
      return "github";
    case ManagedComputerSetupPhase.PROVIDER:
      return "provider";
    case ManagedComputerSetupPhase.REPOSITORY:
      return "repository";
    case ManagedComputerSetupPhase.WORKER:
      return "worker";
    default:
      return null;
  }
};

const setupStatusFromProto = (
  status: ManagedComputerSetupStateStatus,
): "working" | "complete" | null => {
  switch (status) {
    case ManagedComputerSetupStateStatus.WORKING:
      return "working";
    case ManagedComputerSetupStateStatus.COMPLETE:
      return "complete";
    default:
      return null;
  }
};

const setupChallengeFromProto = (
  challenge: {
    challengeId: string;
    service: ManagedComputerSetupChallengeService;
    kind: ManagedComputerSetupChallengeKind;
    verificationUri: string;
    userCode?: string;
  },
): SetupChallenge | null => {
  const service = challenge.service === ManagedComputerSetupChallengeService.GITHUB
    ? "github" as const
    : challenge.service === ManagedComputerSetupChallengeService.PROVIDER
      ? "provider" as const
      : null;
  const kind = challenge.kind === ManagedComputerSetupChallengeKind.DEVICE_CODE
    ? "device_code" as const
    : challenge.kind ===
        ManagedComputerSetupChallengeKind.AUTHORIZATION_CODE
      ? "authorization_code" as const
      : challenge.kind === ManagedComputerSetupChallengeKind.API_KEY
        ? "api_key" as const
        : null;
  return service && kind
    ? {
      challengeId: challenge.challengeId,
      service,
      kind,
      verificationUri: challenge.verificationUri,
      ...(challenge.userCode ? { userCode: challenge.userCode } : {}),
    }
    : null;
};

const initialPhaseState = (): Partial<Record<SetupPhase, "working" | "complete">> =>
  ({});

export function ManagedComputerSetupWizard({
  computer,
  createSetupSession = createManagedComputerSetupSession,
  mode = "setup",
  onComplete,
  onOpenChange,
  open,
  organizationId,
  projects,
  token,
}: {
  computer: ManagedComputer;
  createSetupSession?: typeof createManagedComputerSetupSession;
  mode?: ManagedComputerSetupMode;
  onComplete: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  organizationId: string;
  projects: Project[];
  token: string;
}) {
  const { t } = useI18n();
  const addingProject = mode === "add_project";
  const [screen, setScreen] = useState<WizardScreen>("start");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [provider, setProvider] = useState<ManagedComputerSetupProvider>(
    "codex",
  );
  const [phaseState, setPhaseState] = useState(initialPhaseState);
  const [challenge, setChallenge] = useState<SetupChallenge | null>(null);
  const [credential, setCredential] = useState("");
  const [credentialSubmitted, setCredentialSubmitted] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef(false);

  const reset = () => {
    terminalRef.current = false;
    setScreen("start");
    setProjectId((current) =>
      projects.some((project) => project.id === current)
        ? current
        : projects[0]?.id ?? ""
    );
    setProvider("codex");
    setPhaseState(initialPhaseState());
    setChallenge(null);
    setCredential("");
    setCredentialSubmitted(false);
    setCopied(false);
    setError(null);
  };

  useEffect(() => {
    if (open) reset();
    return () => {
      terminalRef.current = true;
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(toBinary(
          ManagedComputerSetupToAgentSchema,
          create(ManagedComputerSetupToAgentSchema, {
            payload: {
              case: "cancel",
              value: create(ManagedComputerSetupCancelSchema),
            },
          }),
        ));
      }
      socket?.close(1000, "Setup dialog closed");
    };
  }, [open]);

  const projectOptions = useMemo(
    () => projects.map((project) => ({
      label: project.name,
      value: project.id,
    })),
    [projects],
  );

  const close = () => onOpenChange(false);

  const fail = (message: string) => {
    terminalRef.current = true;
    setCredential("");
    setChallenge(null);
    setError(message);
    setScreen("error");
    socketRef.current?.close(1011, "Managed setup failed");
    socketRef.current = null;
  };

  const startSetup = async () => {
    if (!projectId) return;
    setScreen("running");
    setError(null);
    setChallenge(null);
    setPhaseState(initialPhaseState());
    terminalRef.current = false;
    try {
      const ticket = await createSetupSession(
        token,
        organizationId,
        computer.id,
        { projectId, requestId: crypto.randomUUID() },
      );
      if (!ticket.agentConnected) {
        fail(t("managedComputer.setup.agentOffline"));
        return;
      }
      const socket = new WebSocket(ticket.socket.url, ticket.socket.protocol);
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      socket.addEventListener("open", () => {
        if (socketRef.current !== socket) return;
        socket.send(toBinary(
          ManagedComputerSetupToAgentSchema,
          create(ManagedComputerSetupToAgentSchema, {
            payload: {
              case: "start",
              value: create(ManagedComputerSetupStartSchema, {
                setupToken: ticket.setupToken,
                provider: managedComputerSetupProviderToProto(provider),
              }),
            },
          }),
        ));
      });
      socket.addEventListener("message", (event) => {
        if (socketRef.current !== socket) return;
        if (!(event.data instanceof ArrayBuffer)) {
          fail(t("managedComputer.setup.agentOffline"));
          return;
        }
        let message: ManagedComputerSetupToController;
        try {
          message = fromBinary(
            ManagedComputerSetupToControllerSchema,
            new Uint8Array(event.data),
          );
        } catch {
          fail(t("managedComputer.setup.agentOffline"));
          return;
        }
        if (!isManagedComputerSetupToController(message)) {
          fail(t("managedComputer.setup.agentOffline"));
          return;
        }
        if (message.payload.case === "state") {
          const phase = setupPhaseFromProto(message.payload.value.phase);
          const status = setupStatusFromProto(message.payload.value.status);
          if (!phase || !status) {
            fail(t("managedComputer.setup.agentOffline"));
            return;
          }
          setPhaseState((current) => ({
            ...current,
            [phase]: status,
          }));
          if (status === "complete") {
            setChallenge(null);
            setCredential("");
            setCredentialSubmitted(false);
          }
          return;
        }
        if (message.payload.case === "challenge") {
          const nextChallenge = setupChallengeFromProto(message.payload.value);
          if (!nextChallenge) {
            fail(t("managedComputer.setup.agentOffline"));
            return;
          }
          setChallenge(nextChallenge);
          setCredential("");
          setCredentialSubmitted(false);
          setCopied(false);
          return;
        }
        if (message.payload.case === "error") {
          fail(message.payload.value.message);
          return;
        }
        if (message.payload.case !== "complete") {
          fail(t("managedComputer.setup.agentOffline"));
          return;
        }
        terminalRef.current = true;
        setChallenge(null);
        setCredential("");
        setScreen("complete");
        socket.close(1000, "Managed setup complete");
        socketRef.current = null;
        onComplete();
      });
      socket.addEventListener("close", () => {
        if (socketRef.current === socket) socketRef.current = null;
        if (!terminalRef.current) {
          fail(t("managedComputer.setup.agentOffline"));
        }
      });
      socket.addEventListener("error", () => {
        if (!terminalRef.current) {
          fail(t("managedComputer.setup.agentOffline"));
        }
      });
    } catch (caught) {
      fail(caught instanceof Error ? caught.message : String(caught));
    }
  };

  const submitCredential = () => {
    if (!challenge || !credential.trim()) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(toBinary(
      ManagedComputerSetupToAgentSchema,
      create(ManagedComputerSetupToAgentSchema, {
        payload: {
          case: "submit",
          value: create(ManagedComputerSetupSubmitSchema, {
            challengeId: challenge.challengeId,
            value: credential.trim(),
          }),
        },
      }),
    ));
    setCredential("");
    setCredentialSubmitted(true);
  };

  const skipProviderChallenge = () => {
    if (!challenge) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(toBinary(
      ManagedComputerSetupToAgentSchema,
      create(ManagedComputerSetupToAgentSchema, {
        payload: {
          case: "submit",
          value: create(ManagedComputerSetupSubmitSchema, {
            challengeId: challenge.challengeId,
            value: "SKIP",
          }),
        },
      }),
    ));
    setChallenge(null);
    setCredentialSubmitted(true);
  };

  const copyCode = async () => {
    if (!challenge?.userCode) return;
    await navigator.clipboard.writeText(challenge.userCode);
    setCopied(true);
  };

  const phaseMessage = (() => {
    const entries = Object.entries(phaseState) as Array<
      [SetupPhase, "working" | "complete"]
    >;
    const current = entries.at(-1);
    if (!current) return t("managedComputer.setup.starting");
    const [phase, status] = current;
    if (phase === "github") {
      return t(status === "complete"
        ? "managedComputer.setup.phase.githubComplete"
        : "managedComputer.setup.phase.githubWorking");
    }
    if (phase === "provider") {
      return t(status === "complete"
        ? "managedComputer.setup.phase.providerComplete"
        : "managedComputer.setup.phase.providerWorking", {
        provider: agentProviderLabels[provider],
      });
    }
    if (phase === "repository") {
      return t(status === "complete"
        ? "managedComputer.setup.phase.repositoryComplete"
        : "managedComputer.setup.phase.repositoryWorking");
    }
    return t(status === "complete"
      ? "managedComputer.setup.phase.workerComplete"
      : "managedComputer.setup.phase.workerWorking");
  })();

  const stepIndex = screen === "complete"
    ? 3
    : phaseState.provider || phaseState.repository || phaseState.worker
      ? 2
      : phaseState.github
        ? 1
        : 0;

  const challengeTitle = challenge?.service === "github"
    ? t("managedComputer.setup.challenge.githubTitle")
    : t("managedComputer.setup.challenge.providerTitle", {
      provider: agentProviderLabels[provider],
    });
  const challengeDescription = challenge?.service === "github"
    ? t("managedComputer.setup.challenge.githubDescription")
    : challenge?.kind === "api_key"
      ? t("managedComputer.setup.challenge.apiKeyDescription")
      : challenge?.kind === "authorization_code"
        ? t("managedComputer.setup.challenge.codeDescription")
        : t("managedComputer.setup.challenge.deviceDescription");

  const stepLabels = [
    t("managedComputer.setup.step.start"),
    t("managedComputer.setup.step.github"),
    t("managedComputer.setup.step.provider"),
    t("managedComputer.setup.step.complete"),
  ];
  const dialogTitle = t(addingProject
    ? "managedComputer.addProject.title"
    : "managedComputer.setup.title");

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
          <DialogDescription>
            {t(addingProject
              ? "managedComputer.addProject.description"
              : "managedComputer.setup.description")}
          </DialogDescription>
        </DialogHeader>

        <ol className="grid grid-cols-4 gap-2" aria-label={dialogTitle}>
          {stepLabels.map((label, index) => (
            <li className="grid min-w-0 gap-1.5" key={label}>
              <span
                className={`h-1.5 rounded-full ${
                  index <= stepIndex ? "bg-primary" : "bg-muted"
                }`}
              />
              <span className={`truncate text-[11px] ${
                index <= stepIndex ? "text-foreground" : "text-muted-foreground"
              }`}>
                {label}
              </span>
            </li>
          ))}
        </ol>

        {screen === "start" ? (
          <div className="grid gap-5 py-1">
            <div className="grid gap-2">
              <Typography as="label" variant="caption">
                {t("managedComputer.setup.project")}
              </Typography>
              {projects.length > 0 ? (
                <SelectMenu
                  label={t("managedComputer.setup.project")}
                  onValueChange={setProjectId}
                  options={projectOptions}
                  placeholder={t("managedComputer.setup.projectPlaceholder")}
                  value={projectId}
                />
              ) : (
                <Typography tone="muted" variant="bodySm">
                  {t("managedComputer.setup.noProjects")}
                </Typography>
              )}
            </div>

            <div className="grid gap-2">
              <div>
                <Typography variant="caption">
                  {t("managedComputer.setup.provider")}
                </Typography>
                <Typography tone="muted" variant="caption">
                  {t("managedComputer.setup.providerDescription")}
                </Typography>
              </div>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                {managedComputerSetupProviders.map((candidate) => (
                  <ChoiceCard
                    aria-checked={provider === candidate}
                    className="min-h-0"
                    description={t(`managedComputer.setup.provider.${candidate}`)}
                    icon={<AgentProviderIcon provider={candidate} size={18} />}
                    key={candidate}
                    layout="horizontal"
                    onClick={() => setProvider(candidate)}
                    role="radio"
                    selected={provider === candidate}
                    title={agentProviderLabels[candidate]}
                    trailing={provider === candidate ? <Check /> : undefined}
                  />
                ))}
              </div>
            </div>

            <div className="flex gap-2 rounded-lg border border-border bg-muted/30 p-3">
              <ShieldCheck className="mt-0.5 shrink-0 text-muted-foreground" size={16} />
              <Typography tone="muted" variant="caption">
                {t("managedComputer.setup.privateNotice")}
              </Typography>
            </div>
          </div>
        ) : null}

        {screen === "running" ? (
          <div className="grid gap-4 py-2">
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/25 p-4">
              <Spinner size={18} />
              <Typography variant="bodySm">{phaseMessage}</Typography>
            </div>

            {challenge ? (
              <div className="grid gap-4 rounded-xl border border-primary/30 bg-primary/5 p-4">
                <div className="flex items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-background text-primary">
                    {challenge.service === "github"
                      ? <Github size={18} />
                      : <KeyRound size={18} />}
                  </span>
                  <div className="grid gap-1">
                    <Typography as="h3" variant="bodySm">
                      {challengeTitle}
                    </Typography>
                    <Typography tone="muted" variant="caption">
                      {challengeDescription}
                    </Typography>
                  </div>
                </div>

                {challenge.userCode ? (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-4 py-3">
                    <code className="text-lg font-semibold tracking-[0.18em]">
                      {challenge.userCode}
                    </code>
                    <Button onClick={() => void copyCode()} size="sm" type="button" variant="outline">
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {t(copied
                        ? "managedComputer.setup.copied"
                        : "managedComputer.setup.copyCode")}
                    </Button>
                  </div>
                ) : null}

                <Button
                  onClick={() => void openExternalUrl(challenge.verificationUri)}
                  type="button"
                  variant="outline"
                >
                  <ExternalLink size={15} />
                  {t("managedComputer.setup.openAuthorization")}
                </Button>

                {challenge.kind === "authorization_code" || challenge.kind === "api_key" ? (
                  <div className="grid gap-2">
                    <label className="text-xs font-medium" htmlFor="managed-setup-credential">
                      {t(challenge.kind === "api_key"
                        ? "managedComputer.setup.apiKey"
                        : "managedComputer.setup.authorizationCode")}
                    </label>
                    <div className="flex gap-2">
                      <Input
                        autoComplete="off"
                        disabled={credentialSubmitted}
                        id="managed-setup-credential"
                        onChange={(event) => setCredential(event.currentTarget.value)}
                        placeholder={t(challenge.kind === "api_key"
                          ? "managedComputer.setup.apiKeyPlaceholder"
                          : "managedComputer.setup.authorizationCodePlaceholder")}
                        type={challenge.kind === "api_key" ? "password" : "text"}
                        value={credential}
                      />
                      <Button
                        disabled={!credential.trim() || credentialSubmitted}
                        onClick={submitCredential}
                        type="button"
                      >
                        {t("managedComputer.setup.submitCredential")}
                      </Button>
                    </div>
                    {provider === "opencode" && challenge.service === "provider" ? (
                      <div className="mt-1 text-center">
                        <button
                          className="text-xs text-muted-foreground underline hover:text-foreground"
                          disabled={credentialSubmitted}
                          onClick={skipProviderChallenge}
                          type="button"
                        >
                          {t("managedComputer.setup.skipProvider")}
                        </button>
                        <Typography className="mt-1" tone="muted" variant="caption">
                          {t("managedComputer.setup.skipProviderDescription")}
                        </Typography>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <Typography className="text-center" tone="muted" variant="caption">
                    {t("managedComputer.setup.waiting")}
                  </Typography>
                )}
              </div>
            ) : null}
          </div>
        ) : null}

        {screen === "complete" ? (
          <div className="grid justify-items-center gap-3 py-8 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-success/10 text-success">
              <CheckCircle2 size={28} />
            </span>
            <Typography as="h3" variant="bodyLg">
              {t(addingProject
                ? "managedComputer.addProject.completeTitle"
                : "managedComputer.setup.completeTitle")}
            </Typography>
            <Typography tone="muted" variant="bodySm">
              {t(addingProject
                ? "managedComputer.addProject.completeDescription"
                : "managedComputer.setup.completeDescription")}
            </Typography>
          </div>
        ) : null}

        {screen === "error" ? (
          <div className="grid justify-items-center gap-3 py-8 text-center">
            <span className="grid size-14 place-items-center rounded-full bg-destructive/10 text-destructive">
              <XCircle size={28} />
            </span>
            <Typography as="h3" variant="bodyLg">
              {t("managedComputer.setup.errorTitle")}
            </Typography>
            <Typography className="max-w-lg" tone="muted" variant="bodySm">
              {error}
            </Typography>
          </div>
        ) : null}

        <DialogFooter>
          {screen === "start" ? (
            <>
              <Button onClick={close} type="button" variant="outline">
                {t("common.cancel")}
              </Button>
              <Button
                disabled={!projectId || projects.length === 0}
                onClick={() => void startSetup()}
                type="button"
              >
                <Laptop size={15} />
                {t(addingProject
                  ? "managedComputer.addProject.start"
                  : "managedComputer.setup.start")}
              </Button>
            </>
          ) : screen === "complete" ? (
            <Button onClick={close} type="button">
              {t("managedComputer.setup.finish")}
            </Button>
          ) : screen === "error" ? (
            <>
              <Button onClick={close} type="button" variant="outline">
                {t("common.close")}
              </Button>
              <Button onClick={reset} type="button">
                {t("managedComputer.setup.retry")}
              </Button>
            </>
          ) : (
            <Button onClick={close} type="button" variant="outline">
              {t("common.cancel")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
