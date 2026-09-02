import { MonitorUp } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/typography";
import { useI18n } from "../i18n";
import type { AgentProvider } from "../lib/agent-provider";
import { supportsComputerUseProvider } from "../lib/computer-use-contract";

export function ComputerUsePolicySwitch({
  disabled = false,
  onChange,
  policy,
  provider,
}: {
  disabled?: boolean;
  onChange: (policy: "disabled" | "unattended") => void;
  policy: "disabled" | "unattended";
  provider: AgentProvider;
}) {
  const { t } = useI18n();
  const supported = supportsComputerUseProvider(provider);

  return (
    <section className="flex items-start justify-between gap-4 rounded-xl border border-border bg-muted/40 p-4">
      <span className="flex min-w-0 items-start gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <MonitorUp aria-hidden="true" size={17} strokeWidth={1.8} />
        </span>
        <span className="grid min-w-0 gap-1">
          <Typography as="strong" variant="bodySm">
            {t("agents.computerUse")}
          </Typography>
          <Typography tone="muted" variant="caption">
            {t(
              supported
                ? "agents.computerUseDescription"
                : "agents.computerUseProviderUnavailable",
            )}
          </Typography>
        </span>
      </span>
      <Switch
        aria-label={t("agents.computerUse")}
        checked={supported && policy === "unattended"}
        disabled={disabled || !supported}
        onCheckedChange={(checked) =>
          onChange(checked ? "unattended" : "disabled")}
      />
    </section>
  );
}
