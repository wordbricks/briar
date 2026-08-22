import * as React from "react";

import { cn } from "@/lib/utils";

export interface ChoiceCardProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "title"> {
  badge?: React.ReactNode;
  description?: React.ReactNode;
  icon: React.ReactNode;
  iconClassName?: string;
  layout?: "horizontal" | "vertical";
  leading?: React.ReactNode;
  selected?: boolean;
  title: React.ReactNode;
  trailing?: React.ReactNode;
}

const ChoiceCard = React.forwardRef<HTMLButtonElement, ChoiceCardProps>(
  (
    {
      badge,
      className,
      description,
      icon,
      iconClassName,
      layout = "vertical",
      leading,
      selected = false,
      title,
      trailing,
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      aria-pressed={selected || undefined}
      data-slot="choice-card"
      data-state={selected ? "selected" : "idle"}
      ref={ref}
      type={type}
      className={cn(
        "group flex min-h-44 w-full min-w-0 flex-col items-start gap-4 rounded-2xl border border-border bg-muted p-5 text-left text-foreground transition-[transform,border-color,background-color,box-shadow] duration-150 hover:not-disabled:-translate-y-0.5 hover:not-disabled:border-ring/40 hover:not-disabled:bg-accent hover:not-disabled:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:bg-muted/70 disabled:text-muted-foreground disabled:opacity-70 data-[state=selected]:border-ring/55 data-[state=selected]:bg-accent data-[state=selected]:shadow-sm",
        layout === "horizontal" &&
          "min-h-0 flex-row items-center gap-2.5 rounded-lg bg-card p-2.5 hover:not-disabled:translate-y-0 hover:not-disabled:shadow-sm",
        className,
      )}
      {...props}
    >
      {leading ? (
        <span data-slot="choice-card-leading" className="shrink-0">
          {leading}
        </span>
      ) : null}
      <span
        data-slot="choice-card-icon"
        className={cn(
          "grid size-12 shrink-0 place-items-center rounded-xl bg-accent text-accent-foreground [&_svg]:size-6",
          layout === "horizontal" &&
            "size-[30px] rounded-lg bg-secondary [&_svg]:size-[18px]",
          iconClassName,
        )}
      >
        {icon}
      </span>
      <span
        data-slot="choice-card-content"
        className={cn(
          "grid min-w-0 gap-2",
          layout === "horizontal" && "flex-1 gap-0.5",
        )}
      >
        <strong
          className={cn(
            "text-md leading-snug font-semibold",
            layout === "horizontal" && "text-sm",
          )}
        >
          {title}
        </strong>
        {description ? (
          <small className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </small>
        ) : null}
      </span>
      {badge ? (
        <span
          data-slot="choice-card-badge"
          className={cn(
            "mt-auto inline-flex rounded-full bg-secondary px-2 py-1 text-2xs font-semibold text-muted-foreground",
            layout === "horizontal" && "mt-0 ml-auto",
          )}
        >
          {badge}
        </span>
      ) : trailing ? (
        <span
          data-slot="choice-card-trailing"
          className={cn(
            "mt-auto self-end text-accent-foreground [&_svg]:size-[18px]",
            layout === "horizontal" && "mt-0 ml-auto self-center",
          )}
        >
          {trailing}
        </span>
      ) : null}
    </button>
  ),
);
ChoiceCard.displayName = "ChoiceCard";

export { ChoiceCard };
