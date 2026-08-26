import {
  Bot,
  CircleAlert,
  FolderGit2,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wrench,
} from "lucide-react";
import { Spinner } from "./ui/spinner";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import type { AutoHuntHealth } from "../lib/project-connection";
import { cn } from "../lib/utils";

export function ConnectionHealth({
  error,
  health,
  loading,
  onReconnect,
  onRefresh,
  onRepair,
}: {
  error: string | null;
  health: AutoHuntHealth | null;
  loading: boolean;
  onReconnect: () => void;
  onRefresh: () => void;
  onRepair: () => void;
}) {
  const { t } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const assetsNeedRepair =
    health && (!health.cliCurrent || !health.skillCurrent);
  const status = loading
    ? "loading"
    : health?.healthy
      ? "healthy"
      : "attention";
  const statusLabel = loading
    ? t("health.checking")
    : health?.healthy
      ? t("health.ready")
      : t("common.checkNeeded");

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsOpen(false);
    };
    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div
      className="relative ml-auto flex shrink-0 items-center border-l border-border py-0 pr-2 pl-1.5"
      ref={menuRef}
    >
      <button
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={t("health.connectionStatus", { status: statusLabel })}
        className={cn(
          "health-trigger inline-flex h-[22px] cursor-pointer items-center gap-1.5 rounded-md border border-transparent bg-transparent px-1.5 text-micro text-muted-foreground hover:border-border hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          status === "healthy" &&
            "text-[var(--status-success-foreground)] [&>span]:bg-success [&>span]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--success)_14%,transparent)]",
          status === "loading" &&
            "text-accent-foreground [&>span]:animate-pulse [&>span]:bg-accent-foreground [&>span]:shadow-[0_0_0_3px_color-mix(in_srgb,var(--accent-foreground)_13%,transparent)] motion-reduce:[&>span]:animate-none",
          status === "attention" && "text-[var(--status-warning-foreground)]",
        )}
        onClick={() => setIsOpen((open) => !open)}
        title={t("health.connectionStatus", { status: statusLabel })}
        type="button"
      >
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full bg-warning"
        />
        <small className="text-micro whitespace-nowrap text-inherit">
          {statusLabel}
        </small>
      </button>
      {isOpen && (
        <div
          aria-label={t("health.details")}
          className={cn(
            "scrollbar-subtle absolute right-0 bottom-[calc(100%+8px)] z-60 max-h-[calc(100vh-82px)] w-[min(620px,calc(100vw-32px))] origin-bottom-right animate-in overflow-auto rounded-2xl border border-border bg-popover text-popover-foreground shadow-xl duration-150 fade-in slide-in-from-bottom-1 zoom-in-95 motion-reduce:animate-none",
            health?.healthy && "border-[var(--status-success-border)]",
          )}
          role="dialog"
        >
          <div className="flex min-h-14 items-center justify-between gap-2.5 border-b border-border px-3.5 py-2.5 max-[760px]:items-start max-[760px]:flex-col">
            <div className="flex items-center gap-2">
              <span className="grid size-[30px] place-items-center rounded-lg bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]">
                <ShieldCheck size={16} />
              </span>
              <span className="flex flex-col gap-0.5">
                <strong className="text-xs">{t("health.title")}</strong>
                <small className="text-micro text-muted-foreground">
                  {statusLabel}
                </small>
              </span>
            </div>
            <div className="health-actions flex gap-1.5">
              {assetsNeedRepair && (
                <button
                  className="flex min-h-[31px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-muted px-2 text-micro text-muted-foreground hover:border-input hover:bg-accent hover:text-accent-foreground disabled:opacity-55"
                  onClick={onRepair}
                  type="button"
                >
                  <Wrench size={13} />
                  {t("health.repair")}
                </button>
              )}
              <button
                className="flex min-h-[31px] cursor-pointer items-center justify-center gap-1 rounded-lg border border-border bg-muted px-2 text-micro text-muted-foreground hover:border-input hover:bg-accent hover:text-accent-foreground disabled:opacity-55"
                onClick={onReconnect}
                type="button"
              >
                <FolderGit2 size={13} />
                {t("health.reconnect")}
              </button>
              <button
                aria-label={t("health.recheck")}
                className="flex size-[31px] cursor-pointer items-center justify-center rounded-lg border border-border bg-muted p-0 text-muted-foreground hover:border-input hover:bg-accent hover:text-accent-foreground disabled:opacity-55"
                disabled={loading}
                onClick={onRefresh}
                type="button"
              >
                <Spinner icon={RefreshCw} size={13} spinning={loading} />
              </button>
            </div>
          </div>
          {error && (
            <div className="mx-3.5 mt-2.5 flex items-center gap-1.5 rounded-lg border border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] px-2.5 py-2 text-micro text-[var(--status-destructive-foreground)]">
              <CircleAlert size={14} />
              {error}
            </div>
          )}
          {health ? (
            <>
              <div className="grid grid-cols-2 gap-2 px-3.5 py-3 max-[760px]:grid-cols-1">
                <HealthItem
                  healthy={health.repositoryHealthy}
                  icon={<FolderGit2 size={15} />}
                  label={t("health.repository")}
                  value={health.repositoryPath ?? t("common.notConnected")}
                />
                <HealthItem
                  healthy={health.cliCurrent}
                  icon={<Terminal size={15} />}
                  label="Briar CLI"
                  value={
                    health.cliVersion
                      ? `v${health.cliVersion}`
                      : t("common.notInstalled")
                  }
                  expected={`v${health.cliExpectedVersion}`}
                />
                <HealthItem
                  healthy={health.skillCurrent}
                  icon={<Bot size={15} />}
                  label={t("health.skill")}
                  value={
                    health.skillVersion
                      ? `v${health.skillVersion}`
                      : t("common.notInstalled")
                  }
                  expected={`v${health.skillExpectedVersion}`}
                />
                {health.velenOrg ? (
                  <HealthItem
                    healthy={health.velenHealthy}
                    icon={<ShieldCheck size={15} />}
                    label="Velen"
                    value={health.velenOrg}
                    expected={health.velenEmail ?? undefined}
                  />
                ) : null}
              </div>
              <div className="border-t border-border">
                <header className="grid gap-0.5 px-3.5 pt-2.5">
                  <strong className="text-xs">
                    {t("health.workflowRequirements")}
                  </strong>
                  <small className="text-micro text-muted-foreground">
                    {t("health.workflowRequirementsDescription")}
                  </small>
                </header>
                {(health.requirements ?? []).length ? (
                  <div className="grid grid-cols-2 gap-2 px-3.5 pt-2 pb-3 max-[760px]:grid-cols-1">
                    {(health.requirements ?? []).map((requirement) => (
                      <HealthItem
                        expected={requirement.reason}
                        healthy={requirement.healthy}
                        icon={<Wrench size={15} />}
                        key={requirement.id}
                        label={requirement.label}
                        value={requirement.detail}
                      />
                    ))}
                  </div>
                ) : (
                  <p className="m-0 px-3.5 py-3 text-micro text-muted-foreground">
                    {t("health.noWorkflowRequirements")}
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="grid min-h-[72px] place-items-center text-micro text-muted-foreground">
              {loading ? t("health.inspecting") : t("health.desktopOnly")}
            </div>
          )}
          {health && !health.healthy && health.issues.length > 0 && (
            <div className="mx-3.5 mt-0 mb-3 flex flex-wrap items-center gap-1.5 rounded-lg border border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] px-2.5 py-2 text-micro text-[var(--status-destructive-foreground)]">
              {health.issues.map((issue) => (
                <span className="flex items-center gap-1" key={issue}>
                  <CircleAlert size={12} />
                  {issue}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HealthItem({
  expected,
  healthy,
  icon,
  label,
  value,
}: {
  expected?: string;
  healthy: boolean;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  const { t } = useI18n();
  return (
    <div className="grid min-h-[58px] min-w-0 grid-cols-[26px_minmax(0,1fr)_auto] items-center gap-1.5 rounded-xl border border-border bg-muted p-2">
      <i
        className={cn(
          "grid size-[26px] place-items-center rounded-lg not-italic",
          healthy
            ? "bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]"
            : "bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]",
        )}
      >
        {icon}
      </i>
      <span className="grid min-w-0 gap-0.5">
        <small className="text-micro text-muted-foreground">{label}</small>
        <strong
          className="truncate font-mono text-micro font-medium text-foreground"
          title={value}
        >
          {value}
        </strong>
        {expected && (
          <em className="font-mono text-micro text-muted-foreground not-italic">
            {expected}
          </em>
        )}
      </span>
      <b
        className={cn(
          "whitespace-nowrap rounded-md px-1.5 py-1 text-micro",
          healthy
            ? "bg-[var(--status-success-surface)] text-[var(--status-success-foreground)]"
            : "bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)]",
        )}
      >
        {healthy ? t("common.healthy") : t("common.checkNeeded")}
      </b>
    </div>
  );
}
