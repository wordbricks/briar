import { Bot, Inbox, Lightbulb, ListTodo, Plus, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { featureFlags } from "@/lib/feature-flags";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";

export type CompanionStatusFilter =
  | "all"
  | "active"
  | "attention"
  | "completed";

type CompanionDestination =
  | CompanionStatusFilter
  | "agents"
  | "ideas"
  | "inbox"
  | "search";

export function CompanionBottomNavigation({
  activeDestination,
  ideasEnabled = featureFlags.ideas,
  onCreate,
  onAgentsOpen,
  onIdeasOpen = () => undefined,
  onInboxOpen,
  onSearchOpen,
  onStatusChange,
  unreadInboxCount,
}: {
  activeDestination: CompanionDestination;
  ideasEnabled?: boolean;
  onCreate?: () => void;
  onAgentsOpen: () => void;
  onIdeasOpen?: () => void;
  onInboxOpen: () => void;
  onSearchOpen: () => void;
  onStatusChange: (status: CompanionStatusFilter) => void;
  unreadInboxCount: number;
}) {
  const { t } = useI18n();
  const destinations: Array<{
    count?: number;
    icon: typeof ListTodo;
    label: string;
    value: CompanionDestination;
  }> = [
    { icon: ListTodo, label: t("companion.navTasks"), value: "all" },
    { icon: Bot, label: t("companion.navAgents"), value: "agents" },
    ...(ideasEnabled
      ? [{ icon: Lightbulb, label: t("companion.navIdeas"), value: "ideas" as const }]
      : []),
    { icon: Search, label: t("companion.navSearch"), value: "search" },
    {
      count: unreadInboxCount,
      icon: Inbox,
      label: t("companion.navInbox"),
      value: "inbox",
    },
  ];

  return (
    <div className="companion-bottom-chrome border-t border-border bg-card/95 backdrop-blur">
      <nav
        aria-label={t("sidebar.mainMenu")}
        className={cn(
          "companion-bottom-nav grid gap-1 px-2",
          ideasEnabled ? "grid-cols-5" : "grid-cols-4",
        )}
      >
        {destinations.map((destination) => {
          const Icon = destination.icon;
          const isActive = activeDestination === destination.value;
          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-muted-foreground transition-colors",
                isActive && "active text-foreground",
              )}
              key={destination.value}
              onClick={() => {
                if (destination.value === "agents") onAgentsOpen();
                else if (destination.value === "ideas") onIdeasOpen();
                else if (destination.value === "inbox") onInboxOpen();
                else if (destination.value === "search") onSearchOpen();
                else onStatusChange(destination.value);
              }}
              type="button"
            >
              <span className="relative">
                <Icon size={22} />
                {destination.count ? (
                  <i className="absolute -top-1 -right-2 min-w-4 rounded-full bg-primary px-1 text-center text-2xs font-semibold text-primary-foreground not-italic">
                    {destination.count}
                  </i>
                ) : null}
              </span>
              <strong className="text-2xs font-medium">{destination.label}</strong>
            </button>
          );
        })}
      </nav>
      {onCreate ? (
        <Button
          aria-label={t("dashboard.createIssue")}
          className="companion-fab size-14 rounded-full shadow-lg"
          onClick={onCreate}
          size="icon"
          type="button"
        >
          <Plus size={25} />
        </Button>
      ) : null}
    </div>
  );
}
