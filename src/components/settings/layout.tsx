import { ArrowLeft, Search } from "lucide-react";
import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPanel } from "@/components/ui/status-panel";
import { Switch } from "@/components/ui/switch";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";

export function SettingsShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <main
      className={cn(
        "settings-shell flex h-full min-w-0 w-full overflow-hidden bg-card text-foreground",
        className,
      )}
    >
      {children}
    </main>
  );
}

export function SettingsSidebar({
  children,
  className,
  isOpen = true,
  label,
}: {
  children: ReactNode;
  className?: string;
  isOpen?: boolean;
  label?: string;
}) {
  return (
    <aside
      aria-hidden={!isOpen}
      aria-label={label}
      className={cn(
        "settings-sidebar sidebar flex h-full min-w-0 flex-col overflow-hidden border-r border-border/80 bg-muted shadow-none",
        isOpen ? "w-[252px] flex-[0_0_252px]" : "sidebar-collapsed w-0 flex-none overflow-hidden border-r-0",
        className,
      )}
      id="app-sidebar"
      inert={!isOpen ? true : undefined}
    >
      <div
        className="settings-sidebar-toolbar h-[46px] shrink-0 pl-[var(--traffic-light-safe-inset)]"
        data-tauri-drag-region
      />
      {children}
    </aside>
  );
}

export function SettingsBackButton({
  children,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "settings-back mx-2.5 mb-2.5 flex h-[34px] w-[calc(100%-20px)] items-center gap-2 rounded-md border-0 bg-transparent px-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985]",
        className,
      )}
      type="button"
      {...props}
    >
      <ArrowLeft className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.9} />
      <span className="truncate">{children}</span>
    </button>
  );
}

export function SettingsSearch({
  className,
  label,
  onChange,
  placeholder,
  value,
}: {
  className?: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label
      className={cn(
        "settings-search mx-3 mb-3.5 flex h-[34px] items-center gap-2 rounded-md border border-border bg-card px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20",
        className,
      )}
    >
      <Search aria-hidden="true" className="size-3.5 shrink-0" strokeWidth={1.9} />
      <Input
        aria-label={label}
        className="h-full border-0 bg-transparent px-0 py-0 text-sm shadow-none focus-visible:ring-0"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder ?? label}
        type="search"
        value={value}
      />
    </label>
  );
}

export function SettingsNav({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <nav
      className={cn(
        "settings-nav grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-2.5 pb-5 [scrollbar-color:rgba(82,83,77,.18)_transparent] [scrollbar-width:thin]",
        className,
      )}
    >
      {children}
    </nav>
  );
}

export function SettingsNavGroup({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn("settings-nav-group grid gap-0.5", className)}>
      {label ? (
        <Typography
          as="p"
          className="mx-2 mb-1.5 tracking-wide uppercase"
          tone="muted"
          variant="micro"
        >
          {label}
        </Typography>
      ) : null}
      {children}
    </div>
  );
}

export function SettingsNavItem({
  active,
  children,
  className,
  icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  active?: boolean;
  icon?: ReactNode;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={cn(
        "settings-nav-item flex h-[34px] w-full items-center gap-2.5 rounded-md border-0 bg-transparent px-2.5 text-left text-sm font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.985]",
        active && "bg-sidebar-accent font-semibold text-sidebar-accent-foreground",
        className,
      )}
      type="button"
      {...props}
    >
      {icon ? (
        <span
          className={cn(
            "flex shrink-0 text-muted-foreground [&_svg]:size-4",
            active && "text-foreground",
          )}
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

export function SettingsMain({
  children,
  className,
  isSidebarOpen = true,
}: {
  children: ReactNode;
  className?: string;
  isSidebarOpen?: boolean;
}) {
  return (
    <section
      className={cn(
        "settings-main main-content flex h-full min-w-0 flex-1 flex-col bg-card",
        className,
      )}
    >
      <div
        className={cn(
          "settings-main-toolbar h-[46px] shrink-0",
          !isSidebarOpen && "pl-[var(--window-navigation-content-inset)]",
        )}
        data-tauri-drag-region="deep"
      />
      {children}
    </section>
  );
}

export function SettingsScroll({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "settings-scroll min-h-0 flex-1 overflow-auto px-[clamp(28px,5vw,80px)] pb-[72px] pt-2 [scrollbar-gutter:stable]",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsPageHeader({
  className,
  description,
  title,
}: {
  className?: string;
  description?: ReactNode;
  title: ReactNode;
}) {
  return (
    <header
      className={cn(
        "settings-page-header mx-auto mb-7 w-full max-w-[720px]",
        className,
      )}
    >
      <Typography as="h1" variant="heading">
        {title}
      </Typography>
      {description ? (
        <Typography className="mt-2" tone="muted" variant="body">
          {description}
        </Typography>
      ) : null}
    </header>
  );
}

export function SettingsSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "settings-section mx-auto w-full max-w-[720px] pb-6",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SettingsGroupHeading({
  action,
  className,
  title,
}: {
  action?: ReactNode;
  className?: string;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        "settings-group-heading mb-3 mt-0 flex min-h-7 items-center justify-between gap-3 first:mt-0 not-first:mt-8 mx-0.5",
        className,
      )}
    >
      <Typography as="h2" className="tracking-tight" variant="bodyLg">
        {title}
      </Typography>
      {action}
    </div>
  );
}

export function SettingsCard({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "settings-card overflow-hidden rounded-xl border border-border bg-card",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SettingsToggleRow({
  checked,
  description,
  disabled = false,
  label,
  onCheckedChange,
  title,
}: {
  checked: boolean;
  description: ReactNode;
  disabled?: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
  title: ReactNode;
}) {
  return (
    <div className="grid min-h-[72px] grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-[18px] py-4">
      <div className="grid min-w-0 gap-1">
        <Typography as="strong" variant="body">
          {title}
        </Typography>
        <Typography as="p" tone="muted" variant="bodySm">
          {description}
        </Typography>
      </div>
      <Switch
        aria-label={label}
        checked={checked}
        className="justify-self-end data-[state=checked]:bg-foreground"
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}

export function SettingsIconButton({
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <Button
      className={cn("size-8 shrink-0 text-muted-foreground", className)}
      size="icon-sm"
      type="button"
      variant="ghost"
      {...props}
    />
  );
}

export function SettingsAlert({
  children,
  className,
  tone = "error",
}: {
  children: ReactNode;
  className?: string;
  tone?: "error" | "success" | "warning" | "info";
}) {
  return (
    <StatusPanel
      className={cn("mt-4 text-xs", className)}
      density="compact"
      role={tone === "error" ? "alert" : "status"}
      tone={tone === "error" ? "destructive" : tone}
    >
      {children}
    </StatusPanel>
  );
}

export function SettingsNote({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <Typography
      as="p"
      className={cn("mt-3.5", className)}
      tone="muted"
      variant="caption"
    >
      {children}
    </Typography>
  );
}

export function SettingsPlaceholder({
  children,
  className,
  description,
  icon,
  title,
}: {
  children?: ReactNode;
  className?: string;
  description?: ReactNode;
  icon?: ReactNode;
  title?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex min-h-60 w-full max-w-[720px] flex-col items-center justify-center rounded-xl border border-border bg-card px-6 py-14 text-center",
        className,
      )}
    >
      {icon ? (
        <span className="mb-4 grid size-11 place-items-center rounded-xl bg-secondary text-muted-foreground">
          {icon}
        </span>
      ) : null}
      {title ? (
        <Typography as="h2" variant="subheading">
          {title}
        </Typography>
      ) : null}
      {description ? (
        <Typography className="mt-2 max-w-sm" tone="muted" variant="bodySm">
          {description}
        </Typography>
      ) : null}
      {children}
    </div>
  );
}

export function SettingsIdentity({
  className,
  icon,
  subtitle,
  title,
}: {
  className?: string;
  icon?: ReactNode;
  subtitle?: ReactNode;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-3.5 mb-6 flex items-center gap-2.5 px-1",
        className,
      )}
    >
      {icon ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-card text-primary shadow-xs">
          {icon}
        </span>
      ) : null}
      <div className="min-w-0 grid gap-0.5">
        <Typography as="strong" className="truncate" variant="body">
          {title}
        </Typography>
        {subtitle ? (
          <Typography as="small" className="truncate" tone="muted" variant="micro">
            {subtitle}
          </Typography>
        ) : null}
      </div>
    </div>
  );
}
