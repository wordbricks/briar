import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

export function ProviderRow({
  available,
  badge,
  className,
  description,
  disabled = false,
  enabled,
  icon,
  name,
  onToggle,
  title,
  trailing,
}: {
  available: boolean;
  badge?: string;
  className?: string;
  description: string;
  disabled?: boolean;
  enabled: boolean;
  icon: ReactNode;
  name: string;
  onToggle?: (enabled: boolean) => void;
  title: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "settings-provider-row relative grid min-h-[72px] grid-cols-[34px_minmax(0,1fr)_auto_46px] items-center gap-x-3 border-b border-border/80 px-[18px] py-4 last:border-b-0",
        className,
      )}
    >
      <span
        aria-label={available ? "Available" : "Unavailable"}
        className={cn(
          "absolute top-[18px] left-[19px] z-[1] size-[7px] rounded-full border-2 border-card box-content",
          available ? "bg-success" : "bg-warning",
        )}
      />
      {icon}
      <div className="grid min-w-0 gap-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Typography
            as="strong"
            className="flex min-w-0 flex-wrap items-baseline gap-2 tracking-tight [&_code]:font-mono [&_code]:text-xs [&_code]:font-medium [&_code]:text-muted-foreground"
            variant="body"
          >
            {title}
          </Typography>
          {badge ? (
            <Badge className="font-medium" variant="secondary">
              {badge}
            </Badge>
          ) : null}
        </div>
        <Typography as="p" tone="muted" variant="bodySm">
          {description}
        </Typography>
      </div>
      {trailing ? <div className="justify-self-end text-muted-foreground">{trailing}</div> : null}
      <Switch
        aria-label={`${name} enabled`}
        checked={enabled}
        className="justify-self-end data-[state=checked]:bg-foreground"
        disabled={disabled || !available || !onToggle}
        onCheckedChange={(checked) => onToggle?.(checked)}
      />
    </div>
  );
}

export function ProviderIcon({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?:
    | "neutral"
    | "git"
    | "github"
    | "codex"
    | "claude"
    | "grok"
    | "opencode";
}) {
  return (
    <span
      className={cn(
        "grid size-[30px] place-items-center rounded-md [&_img]:block [&_svg]:block",
        tone === "neutral" && "bg-secondary text-foreground",
        tone === "git" && "-rotate-1 bg-[#e65d42] text-white [&_svg]:rotate-1",
        tone === "github" && "bg-secondary text-foreground",
        tone === "codex" && "bg-secondary text-foreground",
        tone === "claude" && "bg-[#fff1e9] text-[#d66f45]",
        tone === "grok" && "bg-[#ececf1] text-[#111114]",
        tone === "opencode" && "bg-[#ececf1] text-[#211e1e]",
        className,
      )}
    >
      {children}
    </span>
  );
}
