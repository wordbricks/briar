import { ChevronDown } from "lucide-react";
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
  details,
  detailsId,
  detailsLabel,
  enabled,
  expanded = false,
  icon,
  name,
  onExpandedChange,
  onToggle,
  title,
  trailing,
}: {
  available: boolean;
  badge?: string;
  className?: string;
  description: string;
  disabled?: boolean;
  details?: ReactNode;
  detailsId?: string;
  detailsLabel?: string;
  enabled: boolean;
  expanded?: boolean;
  icon: ReactNode;
  name: string;
  onExpandedChange?: (expanded: boolean) => void;
  onToggle?: (enabled: boolean) => void;
  title: ReactNode;
  trailing?: ReactNode;
}) {
  const row = (
    <div
      className={cn(
        "settings-provider-row relative grid min-h-[72px] grid-cols-[34px_minmax(0,1fr)_auto_46px] items-center gap-x-3 border-b border-border/80 px-[18px] py-4 last:border-b-0",
        details && "border-b-0",
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
      {trailing || details ? (
        <div className="flex items-center justify-self-end gap-1 text-muted-foreground">
          {trailing}
          {details ? (
            <button
              aria-controls={detailsId}
              aria-expanded={expanded}
              aria-label={detailsLabel ?? `${expanded ? "Hide" : "Show"} ${name} details`}
              className="grid size-8 place-items-center rounded-md border-0 bg-transparent text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => onExpandedChange?.(!expanded)}
              type="button"
            >
              <ChevronDown
                aria-hidden="true"
                className={cn("transition-transform", expanded && "rotate-180")}
                size={16}
              />
            </button>
          ) : null}
        </div>
      ) : null}
      <Switch
        aria-label={`${name} enabled`}
        checked={enabled}
        className="justify-self-end data-[state=checked]:bg-foreground"
        disabled={disabled || !available || !onToggle}
        onCheckedChange={(checked) => onToggle?.(checked)}
      />
    </div>
  );

  if (!details) return row;
  return (
    <div className="border-b border-border/80 last:border-b-0">
      {row}
      {expanded ? (
        <div id={detailsId} className="border-t border-border/70 bg-muted/25 px-[18px] py-4">
          {details}
        </div>
      ) : null}
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
    | "agy"
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
        tone === "agy" && "bg-[#eef3ff] text-[#4285f4]",
        tone === "opencode" && "bg-[#ececf1] text-[#211e1e]",
        className,
      )}
    >
      {children}
    </span>
  );
}
