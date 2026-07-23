import {
  Activity,
  Bell,
  CheckCircle2,
  Inbox,
  ListTodo,
  Plus,
} from "lucide-react";
import { useI18n } from "../i18n";

export type CompanionStatusFilter =
  | "all"
  | "active"
  | "attention"
  | "completed";

type CompanionDestination = CompanionStatusFilter | "inbox";

export function CompanionBottomNavigation({
  activeDestination,
  counts,
  onCreate,
  onInboxOpen,
  onStatusChange,
  unreadInboxCount,
}: {
  activeDestination: CompanionDestination;
  counts: { active: number; attention: number };
  onCreate?: () => void;
  onInboxOpen: () => void;
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
    {
      count: counts.active,
      icon: Activity,
      label: t("companion.navActive"),
      value: "active",
    },
    {
      count: counts.attention,
      icon: Bell,
      label: t("companion.navAttention"),
      value: "attention",
    },
    {
      icon: CheckCircle2,
      label: t("companion.navCompleted"),
      value: "completed",
    },
    {
      count: unreadInboxCount,
      icon: Inbox,
      label: t("companion.navInbox"),
      value: "inbox",
    },
  ];

  return (
    <div className="companion-bottom-chrome">
      {onCreate && (
        <button
          aria-label={t("dashboard.createIssue")}
          className="companion-fab"
          onClick={onCreate}
          type="button"
        >
          <Plus size={25} />
        </button>
      )}
      <nav aria-label={t("sidebar.mainMenu")} className="companion-bottom-nav">
        {destinations.map((destination) => {
          const Icon = destination.icon;
          const isActive = activeDestination === destination.value;
          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={isActive ? "active" : ""}
              key={destination.value}
              onClick={() => {
                if (destination.value === "inbox") onInboxOpen();
                else onStatusChange(destination.value);
              }}
              type="button"
            >
              <span>
                <Icon size={22} />
                {destination.count ? <i>{destination.count}</i> : null}
              </span>
              <strong>{destination.label}</strong>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
