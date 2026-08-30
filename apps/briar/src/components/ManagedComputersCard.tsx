import {
  AlertTriangle,
  Check,
  Cloud,
  FolderPlus,
  HardDrive,
  KeyRound,
  MonitorUp,
  PowerOff,
  RefreshCw,
  ServerCog,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useI18n } from "../i18n";
import {
  applyForManagedComputer,
  loadManagedComputerProduct,
  loadManagedComputers,
  retireManagedComputer,
  retryManagedComputer,
  validateManagedComputerPromotion,
} from "../lib/api";
import { ApiError } from "../lib/api/errors";
import { supportsManagedComputerRemoteDesktop } from "../lib/platform";
import type { ManagedComputer, ManagedComputerProduct, Project } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
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
import { ManagedComputerRemoteDesktop } from "./ManagedComputerRemoteDesktop";
import { ManagedComputerSetupWizard } from "./ManagedComputerSetupWizard";

type PromotionCheck = {
  valid: boolean;
  eligible: boolean;
  totalCents: number;
  limitReason: "user" | "organization" | "fleet" | null;
};

const pollingStates = new Set<ManagedComputer["state"]>([
  "requested",
  "provisioning",
  "bootstrapping",
  "needs_setup",
  "draining",
]);

const userRetirementStates = new Set<ManagedComputer["state"]>([
  "needs_setup",
  "ready",
  "failed",
]);

const stateTone = (state: ManagedComputer["state"]) =>
  state === "ready"
    ? "success"
    : state === "failed"
      ? "destructive"
      : state === "needs_setup"
        ? "warning"
        : "secondary";

function managedComputerErrorKey(error: unknown) {
  if (!(error instanceof ApiError) || !error.code) return null;
  return ({
    MANAGED_COMPUTER_APPLICATIONS_DISABLED:
      "managedComputer.error.applicationsDisabled",
    MANAGED_COMPUTER_FLEET_LIMIT: "managedComputer.error.fleetLimit",
    MANAGED_COMPUTER_ORGANIZATION_LIMIT:
      "managedComputer.error.organizationLimit",
    MANAGED_COMPUTER_USER_LIMIT: "managedComputer.error.userLimit",
    MANAGED_COMPUTER_PROMOTION_INVALID:
      "managedComputer.error.promotionInvalid",
    MANAGED_COMPUTER_RETRY_UNAVAILABLE:
      "managedComputer.error.retryUnavailable",
    MANAGED_COMPUTER_RETIRE_UNAVAILABLE:
      "managedComputer.error.retireUnavailable",
  } as const)[error.code] ?? null;
}

function managedComputerDescriptionKey(state: ManagedComputer["state"]) {
  return state === "draining"
    ? "managedComputer.retiringDescription"
    : state === "stopped"
      ? "managedComputer.stoppedDescription"
      : state === "terminated"
        ? "managedComputer.terminatedDescription"
        : "managedComputer.preparingDescription";
}

export function managedComputerSetupProjects(
  computer: ManagedComputer,
  projects: Project[],
  boundProjectIdsByDeviceId: Record<string, string[]>,
) {
  if (computer.state !== "ready" || !computer.deviceId) return projects;
  const boundProjectIds = new Set(
    boundProjectIdsByDeviceId[computer.deviceId] ?? [],
  );
  return projects.filter((project) => !boundProjectIds.has(project.id));
}

export function ManagedComputersCard({
  boundProjectIdsByDeviceId,
  organizationId,
  onProjectConnected,
  projects,
  token,
  workerBindingsLoaded,
}: {
  boundProjectIdsByDeviceId: Record<string, string[]>;
  organizationId: string;
  onProjectConnected: () => void;
  projects: Project[];
  token: string;
  workerBindingsLoaded: boolean;
}) {
  const { t } = useI18n();
  const [product, setProduct] = useState<ManagedComputerProduct | null>(null);
  const [computers, setComputers] = useState<ManagedComputer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [code, setCode] = useState("");
  const [checkingCode, setCheckingCode] = useState(false);
  const [promotion, setPromotion] = useState<PromotionCheck | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retiringId, setRetiringId] = useState<string | null>(null);
  const [retireCandidate, setRetireCandidate] = useState<ManagedComputer | null>(
    null,
  );
  const [remoteComputer, setRemoteComputer] = useState<ManagedComputer | null>(null);
  const [setupComputer, setSetupComputer] = useState<ManagedComputer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const [nextProduct, nextComputers] = await Promise.all([
        loadManagedComputerProduct(token, organizationId),
        loadManagedComputers(token, organizationId),
      ]);
      setProduct(nextProduct);
      setComputers(nextComputers.computers);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
    }
  }, [organizationId, token]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const shouldPoll = useMemo(
    () => computers.some((computer) =>
      pollingStates.has(computer.state)
    ),
    [computers],
  );
  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => void refresh(), 5_000);
    return () => window.clearInterval(timer);
  }, [refresh, shouldPoll]);

  const displayError = (caught: unknown) => {
    const key = managedComputerErrorKey(caught);
    setError(key ? t(key) : caught instanceof Error ? caught.message : String(caught));
  };

  const openPurchase = () => {
    setCode("");
    setPromotion(null);
    setError(null);
    setRequestId(crypto.randomUUID());
    setDialogOpen(true);
  };

  const checkPromotion = async () => {
    setCheckingCode(true);
    setError(null);
    try {
      const result = await validateManagedComputerPromotion(
        token,
        organizationId,
        code,
      );
      setPromotion(result);
    } catch (caught) {
      displayError(caught);
    } finally {
      setCheckingCode(false);
    }
  };

  const submit = async () => {
    if (!promotion?.eligible) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await applyForManagedComputer(token, organizationId, {
        code,
        requestId,
      });
      setComputers((current) => [
        result.computer,
        ...current.filter((computer) => computer.id !== result.computer.id),
      ]);
      setDialogOpen(false);
    } catch (caught) {
      displayError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  const retry = async (computer: ManagedComputer) => {
    setRetryingId(computer.id);
    setError(null);
    try {
      const result = await retryManagedComputer(
        token,
        organizationId,
        computer.id,
        crypto.randomUUID(),
      );
      setComputers((current) => current.map((candidate) =>
        candidate.id === result.computer.id ? result.computer : candidate
      ));
    } catch (caught) {
      displayError(caught);
    } finally {
      setRetryingId(null);
    }
  };

  const retire = async () => {
    const computer = retireCandidate;
    if (!computer) return;
    setRetiringId(computer.id);
    setError(null);
    try {
      const result = await retireManagedComputer(
        token,
        organizationId,
        computer.id,
      );
      setComputers((current) => current.map((candidate) =>
        candidate.id === result.computer.id ? result.computer : candidate
      ));
      setRetireCandidate(null);
    } catch (caught) {
      setRetireCandidate(null);
      displayError(caught);
    } finally {
      setRetiringId(null);
    }
  };

  const specification = product?.product.specification;
  const purchaseDisabled =
    !product?.applicationsEnabled || !product.canApply || submitting;
  const remoteDesktopSupported = supportsManagedComputerRemoteDesktop();
  const setupProjects = setupComputer
    ? managedComputerSetupProjects(
      setupComputer,
      projects,
      boundProjectIdsByDeviceId,
    )
    : projects;

  return (
    <section className="mb-8 w-full max-w-[820px] overflow-hidden rounded-xl border border-border bg-card shadow-xs">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            <Cloud aria-hidden="true" size={18} strokeWidth={1.8} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Typography as="h2" variant="bodyLg">
                {t("managedComputer.title")}
              </Typography>
              <Badge variant="secondary">{t("managedComputer.pilot")}</Badge>
            </div>
            <Typography tone="muted" variant="caption">
              {t("managedComputer.price")}
            </Typography>
          </div>
        </div>
        <Button
          disabled={purchaseDisabled || loading}
          onClick={openPurchase}
          type="button"
        >
          {t("managedComputer.purchase")}
        </Button>
      </header>

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto]">
        <div className="grid gap-2">
          <Typography variant="bodySm">
            {specification
              ? t("managedComputer.specification", {
                  vcpu: specification.vcpu,
                  memory: specification.memoryGiB,
                  disk: specification.volumeGiB,
                })
              : t("managedComputer.specificationLoading")}
          </Typography>
          <Typography tone="muted" variant="caption">
            {t("managedComputer.concurrency")}
          </Typography>
          <Typography tone="muted" variant="caption">
            {t("managedComputer.apiCosts")}
          </Typography>
        </div>
        {!loading && product && !product.applicationsEnabled ? (
          <Badge className="h-fit" variant="warning">
            {t("managedComputer.applicationsPaused")}
          </Badge>
        ) : null}
        {!loading && product && !product.canApply ? (
          <Badge className="h-fit" variant="outline">
            {t("managedComputer.adminOnly")}
          </Badge>
        ) : null}
      </div>

      {error ? (
        <div className="border-t border-border bg-destructive/5 px-5 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {computers.length > 0 ? (
        <div className="divide-y divide-border border-t border-border">
          {computers.map((computer) => {
            const addableProjects = managedComputerSetupProjects(
              computer,
              projects,
              boundProjectIdsByDeviceId,
            );
            return (
              <article className="px-5 py-4" key={computer.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
                    <ServerCog aria-hidden="true" size={18} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Typography as="h3" variant="bodySm">
                        {t("managedComputer.computerName", {
                          id: computer.id.slice(0, 8),
                        })}
                      </Typography>
                      <Badge variant={stateTone(computer.state)}>
                        {t(`managedComputer.state.${computer.state}`)}
                      </Badge>
                    </div>
                    <Typography className="mt-1" tone="muted" variant="caption">
                      {computer.state === "needs_setup"
                        ? t("managedComputer.setupRequired")
                        : computer.state === "ready"
                          ? t("managedComputer.readyDescription")
                          : computer.state === "failed"
                            ? computer.error?.message ?? t("managedComputer.failedDescription")
                            : t(managedComputerDescriptionKey(computer.state))}
                    </Typography>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {computer.state === "needs_setup" ? (
                    <Button
                      onClick={() => setSetupComputer(computer)}
                      size="sm"
                      type="button"
                    >
                      <ServerCog size={14} />
                      {t("managedComputer.setupAction")}
                    </Button>
                  ) : null}
                  {computer.state === "ready" ? (
                    <Button
                      disabled={
                        !workerBindingsLoaded || addableProjects.length === 0
                      }
                      onClick={() => setSetupComputer(computer)}
                      size="sm"
                      title={
                        workerBindingsLoaded && addableProjects.length === 0
                          ? t(projects.length === 0
                            ? "managedComputer.setup.noProjects"
                            : "managedComputer.addProject.allConnected")
                          : undefined
                      }
                      type="button"
                    >
                      <FolderPlus size={14} />
                      {t("managedComputer.addProjectAction")}
                    </Button>
                  ) : null}
                  {product?.remoteDesktopEnabled && remoteDesktopSupported &&
                      ["needs_setup", "ready"].includes(computer.state) ? (
                    <Button
                      onClick={() => setRemoteComputer(computer)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <MonitorUp size={14} />
                      {t(computer.state === "needs_setup"
                        ? "managedComputer.setupAdvanced"
                        : "managedComputer.remote.open")}
                    </Button>
                  ) : null}
                  {computer.retryAvailable ? (
                    <Button
                      disabled={retryingId === computer.id}
                      onClick={() => void retry(computer)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Spinner
                        icon={RefreshCw}
                        size={14}
                        spinning={retryingId === computer.id}
                      />
                      {t("managedComputer.retry")}
                    </Button>
                  ) : null}
                  {product?.canApply && userRetirementStates.has(computer.state) ? (
                    <Button
                      aria-label={t("managedComputer.retire", {
                        id: computer.id.slice(0, 8),
                      })}
                      className="text-destructive hover:text-destructive"
                      disabled={retiringId === computer.id}
                      onClick={() => {
                        setError(null);
                        setRetireCandidate(computer);
                      }}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <PowerOff size={14} />
                      {t("managedComputer.retireAction")}
                    </Button>
                  ) : null}
                </div>
              </div>
              </article>
            );
          })}
        </div>
      ) : null}

      <Dialog onOpenChange={setDialogOpen} open={dialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("managedComputer.checkoutTitle")}</DialogTitle>
            <DialogDescription>
              {t("managedComputer.checkoutDescription")}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-3 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-3">
              <div className="flex items-center gap-2">
                <ServerCog className="text-muted-foreground" size={17} />
                <Typography variant="caption">
                  {specification
                    ? `${specification.vcpu} vCPU · ${specification.memoryGiB} GB`
                    : "—"}
                </Typography>
              </div>
              <div className="flex items-center gap-2">
                <HardDrive className="text-muted-foreground" size={17} />
                <Typography variant="caption">
                  {specification ? `${specification.volumeGiB} GB` : "—"}
                </Typography>
              </div>
              <div className="flex items-center gap-2">
                <KeyRound className="text-muted-foreground" size={17} />
                <Typography variant="caption">
                  {t("managedComputer.oneRun")}
                </Typography>
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-medium" htmlFor="managed-computer-promotion">
                {t("managedComputer.promotionCode")}
              </label>
              <div className="flex gap-2">
                <Input
                  autoCapitalize="characters"
                  id="managed-computer-promotion"
                  maxLength={100}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setPromotion(null);
                  }}
                  placeholder={t("managedComputer.promotionPlaceholder")}
                  value={code}
                />
                <Button
                  disabled={!code.trim() || checkingCode}
                  onClick={() => void checkPromotion()}
                  type="button"
                  variant="outline"
                >
                  {checkingCode ? (
                    <>
                      <Spinner size={14} />
                      {t("managedComputer.checkingCode")}
                    </>
                  ) : t("managedComputer.checkCode")}
                </Button>
              </div>
              {promotion ? (
                <div className={`mt-2 flex items-center gap-2 text-xs ${promotion.valid && promotion.eligible ? "text-success" : "text-destructive"}`}>
                  {promotion.valid && promotion.eligible ? (
                    <Check size={14} />
                  ) : (
                    <AlertTriangle size={14} />
                  )}
                  {promotion.valid && promotion.eligible
                    ? t("managedComputer.promotionApplied")
                    : promotion.valid && promotion.limitReason
                      ? t(`managedComputer.limit.${promotion.limitReason}`)
                      : t("managedComputer.promotionInvalid")}
                </div>
              ) : null}
            </div>

            <div className="flex items-center justify-between border-y border-border py-3">
              <Typography variant="bodySm">{t("managedComputer.total")}</Typography>
              <div className="text-right">
                {promotion?.valid ? (
                  <Typography className="text-xs line-through" tone="muted">
                    {t("managedComputer.monthlyAmount")}
                  </Typography>
                ) : null}
                <Typography as="strong" variant="bodyLg">
                  {promotion?.valid
                    ? t("managedComputer.freeAmount")
                    : t("managedComputer.monthlyAmount")}
                </Typography>
              </div>
            </div>
            <Typography tone="muted" variant="micro">
              {t("managedComputer.paymentNotice")}
            </Typography>
          </div>

          <DialogFooter>
            <Button onClick={() => setDialogOpen(false)} type="button" variant="ghost">
              {t("common.cancel")}
            </Button>
            <Button
              disabled={!promotion?.eligible || submitting}
              onClick={() => void submit()}
              type="button"
            >
              {submitting ? (
                <>
                  <Spinner size={14} />
                  {t("managedComputer.preparing")}
                </>
              ) : t("managedComputer.applyFree")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!open && !retiringId) setRetireCandidate(null);
        }}
        open={retireCandidate !== null}
      >
        <DialogContent className="sm:max-w-md" showClose={!retiringId}>
          <DialogHeader>
            <div className="mb-2 grid size-10 place-items-center rounded-xl bg-destructive/10 text-destructive">
              <PowerOff aria-hidden="true" size={20} strokeWidth={1.8} />
            </div>
            <DialogTitle>
              {retireCandidate
                ? t("managedComputer.retireTitle", {
                    id: retireCandidate.id.slice(0, 8),
                  })
                : null}
            </DialogTitle>
            <DialogDescription>
              {t("managedComputer.retireDescription")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              disabled={Boolean(retiringId)}
              onClick={() => setRetireCandidate(null)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={Boolean(retiringId)}
              onClick={() => void retire()}
              type="button"
              variant="destructive"
            >
              {retiringId ? <Spinner size={15} /> : <PowerOff size={15} />}
              {t("managedComputer.retireConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {remoteComputer ? (
        <ManagedComputerRemoteDesktop
          computer={remoteComputer}
          onClose={() => setRemoteComputer(null)}
          organizationId={organizationId}
          token={token}
        />
      ) : null}

      {setupComputer ? (
        <ManagedComputerSetupWizard
          computer={setupComputer}
          mode={setupComputer.state === "ready" ? "add_project" : "setup"}
          onComplete={() => {
            void refresh();
            onProjectConnected();
          }}
          onOpenChange={(open) => {
            if (!open) setSetupComputer(null);
          }}
          open
          organizationId={organizationId}
          projects={setupProjects}
          token={token}
        />
      ) : null}
    </section>
  );
}
