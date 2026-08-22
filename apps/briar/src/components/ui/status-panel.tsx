import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const statusPanelVariants = cva(
  "flex w-full items-start gap-3 rounded-xl border shadow-none",
  {
    variants: {
      tone: {
        neutral:
          "border-border bg-card text-card-foreground [&_[data-slot=status-panel-description]]:text-muted-foreground [&_[data-slot=status-panel-meta]]:text-muted-foreground",
        info:
          "border-[var(--status-info-border)] bg-[var(--status-info-surface)] text-[var(--status-info-foreground)] [&_[data-slot=status-panel-description]]:text-[var(--status-info-muted)] [&_[data-slot=status-panel-meta]]:text-[var(--status-info-muted)]",
        success:
          "border-[var(--status-success-border)] bg-[var(--status-success-surface)] text-[var(--status-success-foreground)] [&_[data-slot=status-panel-description]]:text-[var(--status-success-muted)] [&_[data-slot=status-panel-meta]]:text-[var(--status-success-muted)]",
        warning:
          "border-[var(--status-warning-border)] bg-[var(--status-warning-surface)] text-[var(--status-warning-foreground)] [&_[data-slot=status-panel-description]]:text-[var(--status-warning-muted)] [&_[data-slot=status-panel-meta]]:text-[var(--status-warning-muted)]",
        destructive:
          "border-[var(--status-destructive-border)] bg-[var(--status-destructive-surface)] text-[var(--status-destructive-foreground)] [&_[data-slot=status-panel-description]]:text-[var(--status-destructive-muted)] [&_[data-slot=status-panel-meta]]:text-[var(--status-destructive-muted)]",
      },
      density: {
        compact:
          "rounded-lg px-3 py-2.5 [&_[data-slot=status-panel-icon]]:size-7 [&_[data-slot=status-panel-icon]_svg]:size-4",
        default: "px-4 py-3.5",
        spacious:
          "rounded-2xl px-5 py-4 [&_[data-slot=status-panel-icon]]:size-10",
      },
    },
    defaultVariants: {
      density: "default",
      tone: "neutral",
    },
  },
);

export interface StatusPanelProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof statusPanelVariants> {}

const StatusPanel = React.forwardRef<HTMLDivElement, StatusPanelProps>(
  ({ className, density, tone, ...props }, ref) => (
    <div
      data-slot="status-panel"
      ref={ref}
      className={cn(statusPanelVariants({ density, tone }), className)}
      {...props}
    />
  ),
);
StatusPanel.displayName = "StatusPanel";

const StatusPanelIcon = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    data-slot="status-panel-icon"
    ref={ref}
    className={cn(
      "grid size-9 shrink-0 place-items-center rounded-lg bg-card/55 [&_svg]:size-[18px]",
      className,
    )}
    {...props}
  />
));
StatusPanelIcon.displayName = "StatusPanelIcon";

const StatusPanelContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    data-slot="status-panel-content"
    ref={ref}
    className={cn("min-w-0 flex-1", className)}
    {...props}
  />
));
StatusPanelContent.displayName = "StatusPanelContent";

const StatusPanelTitle = React.forwardRef<
  HTMLElement,
  React.HTMLAttributes<HTMLElement>
>(({ className, ...props }, ref) => (
  <strong
    data-slot="status-panel-title"
    ref={ref}
    className={cn("block text-sm font-semibold", className)}
    {...props}
  />
));
StatusPanelTitle.displayName = "StatusPanelTitle";

const StatusPanelDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    data-slot="status-panel-description"
    ref={ref}
    className={cn("mt-1 text-xs leading-relaxed", className)}
    {...props}
  />
));
StatusPanelDescription.displayName = "StatusPanelDescription";

const StatusPanelMeta = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    data-slot="status-panel-meta"
    ref={ref}
    className={cn("shrink-0 text-xs", className)}
    {...props}
  />
));
StatusPanelMeta.displayName = "StatusPanelMeta";

const StatusPanelAction = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    data-slot="status-panel-action"
    ref={ref}
    className={cn("ml-auto shrink-0 self-center", className)}
    {...props}
  />
));
StatusPanelAction.displayName = "StatusPanelAction";

export {
  StatusPanel,
  StatusPanelAction,
  StatusPanelContent,
  StatusPanelDescription,
  StatusPanelIcon,
  StatusPanelMeta,
  StatusPanelTitle,
  statusPanelVariants,
};
