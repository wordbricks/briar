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

export function PageScroll({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("min-h-0 flex-1 overflow-auto", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  action,
  className,
  description,
  eyebrow,
  title,
  titleId,
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  titleId?: string;
}) {
  return (
    <header
      className={cn(
        "page-header flex flex-wrap items-center justify-between gap-6 border-b border-border bg-card px-8 py-2.5",
        className,
      )}
    >
      <div className="min-w-0 max-w-[720px]">
        {eyebrow ? (
          <Typography
            as="p"
            className="eyebrow mb-2.5 flex items-center gap-1.5 tracking-wide uppercase"
            tone="primary"
            variant="micro"
          >
            {eyebrow}
          </Typography>
        ) : null}
        <Typography as="h1" id={titleId} variant="title">
          {title}
        </Typography>
        {description ? (
          <Typography className="mt-1.5" tone="muted" variant="bodySm">
            {description}
          </Typography>
        ) : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </header>
  );
}

export function PageHero({
  action,
  className,
  description,
  eyebrow,
  meta,
  title,
}: {
  action?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  title: ReactNode;
}) {
  return (
    <section
      className={cn(
        "page-hero flex flex-wrap items-center justify-between gap-8 border-b border-border bg-[radial-gradient(circle_at_80%_20%,rgba(110,82,199,.11),transparent_32%),linear-gradient(135deg,#fff_0%,#faf9fd_100%)] px-8 py-7",
        className,
      )}
    >
      <div className="min-w-0 max-w-[620px]">
        {eyebrow ? (
          <Typography
            as="p"
            className="eyebrow mb-3 flex items-center gap-1.5 tracking-wide uppercase"
            tone="primary"
            variant="micro"
          >
            {eyebrow}
          </Typography>
        ) : null}
        <Typography as="h1" variant="title">
          {title}
        </Typography>
        {description ? (
          <Typography className="mt-2.5" tone="muted" variant="bodySm">
            {description}
          </Typography>
        ) : null}
        {meta ? <div className="mt-4 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
    </section>
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

export function ErrorBanner({
  children,
  className,
  icon,
}: {
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "error-banner flex items-center gap-2 rounded-lg border border-destructive/25 bg-destructive/8 px-3 py-2.5 text-xs text-destructive",
        className,
      )}
      role="alert"
    >
      {icon}
      <span className="min-w-0">{children}</span>
    </div>
  );
}

export function SectionCard({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cn(
        "rounded-xl border border-border bg-card text-card-foreground shadow-xs",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function Toolbar({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-2",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function StatusPill({
  children,
  className,
  tone = "neutral",
}: {
  children: ReactNode;
  className?: string;
  tone?: "neutral" | "primary" | "success" | "warning" | "destructive";
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center justify-center rounded-full px-2.5 text-2xs font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-secondary text-muted-foreground",
        tone === "primary" && "bg-accent text-accent-foreground",
        tone === "success" && "bg-success/15 text-success",
        tone === "warning" && "bg-warning/15 text-warning",
        tone === "destructive" && "bg-destructive/12 text-destructive",
        className,
      )}
    >
      {children}
    </span>
  );
}
