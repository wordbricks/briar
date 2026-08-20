import type { HTMLAttributes, ReactNode } from "react";

import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

/** Product main pane — keeps legacy `main-content` hooks for CSS. */
export function MainContent({
  children,
  className,
  companionMode = false,
  id,
  ...props
}: HTMLAttributes<HTMLElement> & {
  companionMode?: boolean;
  id?: string;
}) {
  return (
    <main
      className={cn(
        "main-content min-w-0 flex-1 bg-background text-foreground",
        companionMode && "companion-mode",
        className,
      )}
      id={id}
      {...props}
    >
      {children}
    </main>
  );
}

export function PageHeader({
  action,
  className,
  description,
  eyebrow,
  title,
  titleId,
  ...props
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId?: string;
} & Omit<HTMLAttributes<HTMLElement>, "title">) {
  return (
    <header
      className={cn(
        "page-header flex items-center justify-between gap-3 border-b border-border bg-card",
        className,
      )}
      data-tauri-drag-region
      {...props}
    >
      <div className="page-header-copy min-w-0 flex-1">
        {eyebrow ? (
          <Typography
            as="p"
            className="eyebrow mb-0 flex items-center gap-1.5 tracking-wide uppercase"
            tone="primary"
            variant="micro"
          >
            {eyebrow}
          </Typography>
        ) : null}
        <Typography as="h1" className="page-header-title" id={titleId} variant="subheading">
          {title}
        </Typography>
        {description ? (
          <Typography className="page-header-description" tone="muted" variant="caption">
            {description}
          </Typography>
        ) : null}
      </div>
      {action ? (
        <div className="page-header-actions flex shrink-0 items-center gap-2">
          {action}
        </div>
      ) : null}
    </header>
  );
}

export function EmptyState({
  action,
  className,
  description,
  icon,
  title,
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[240px] flex-col items-center justify-center px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="mb-3.5 grid size-11 place-items-center rounded-xl bg-accent text-primary">
          {icon}
        </span>
      ) : null}
      <Typography as="strong" variant="body">
        {title}
      </Typography>
      {description ? (
        <Typography className="mt-2 max-w-sm" tone="muted" variant="caption">
          {description}
        </Typography>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
