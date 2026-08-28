import { House, Inbox, ListTodo, MessageCircle, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";

export type CompanionStatusFilter =
  | "all"
  | "active"
  | "attention"
  | "completed";

type CompanionDestination =
  | CompanionStatusFilter
  | "dms"
  | "home"
  | "inbox";

export function CompanionBottomNavigation({
  activeDestination,
  onCreate,
  onDmsOpen,
  onHomeOpen,
  onInboxOpen,
  onStatusChange,
  unreadDmCount,
  unreadInboxCount,
}: {
  activeDestination: CompanionDestination;
  onCreate?: () => void;
  onDmsOpen: () => void;
  onHomeOpen: () => void;
  onInboxOpen: () => void;
  onStatusChange: (status: CompanionStatusFilter) => void;
  unreadDmCount: number;
  unreadInboxCount: number;
}) {
  const { t } = useI18n();
  const destinations: Array<{
    count?: number;
    icon: typeof ListTodo;
    label: string;
    value: CompanionDestination;
  }> = [
    { icon: House, label: t("companion.navHome"), value: "home" },
    { icon: ListTodo, label: t("companion.navTasks"), value: "all" },
    {
      count: unreadDmCount,
      icon: MessageCircle,
      label: t("sidebar.dms"),
      value: "dms",
    },
    {
      count: unreadInboxCount,
      icon: Inbox,
      label: t("companion.navInbox"),
      value: "inbox",
    },
  ];

  return (
    <div
      className={cn(
        "companion-bottom-chrome pointer-events-none fixed right-[max(12px,env(safe-area-inset-right))] bottom-[max(8px,env(safe-area-inset-bottom))] left-[max(12px,env(safe-area-inset-left))] z-[14] grid grid-cols-[minmax(0,1fr)] items-end gap-2.5",
        "[.platform-ios_&]:inset-x-0 [.platform-ios_&]:bottom-0 [.platform-ios_&]:grid-cols-[minmax(0,1fr)_52px] [.platform-ios_&]:items-center [.platform-ios_&]:bg-transparent [.platform-ios_&]:pt-2 [.platform-ios_&]:pr-[max(12px,env(safe-area-inset-right))] [.platform-ios_&]:pb-[max(8px,calc(env(safe-area-inset-bottom,0px)-8px))] [.platform-ios_&]:pl-[max(12px,env(safe-area-inset-left))]",
        "[.platform-android_&]:inset-x-0 [.platform-android_&]:bottom-0 [.platform-android_&]:grid-cols-[minmax(0,1fr)] [.platform-android_&]:gap-0 [.platform-android_&]:border-t [.platform-android_&]:border-[rgba(57,54,67,.1)] [.platform-android_&]:bg-[#f8f6ff] [.platform-android_&]:pt-0 [.platform-android_&]:pr-[max(5px,env(safe-area-inset-right))] [.platform-android_&]:pb-[env(safe-area-inset-bottom)] [.platform-android_&]:pl-[max(5px,env(safe-area-inset-left))] [.platform-android_&]:shadow-[0_-8px_24px_rgba(46,40,65,.07)]",
      )}
    >
      <nav
        aria-label={t("sidebar.mainMenu")}
        className={cn(
          "companion-bottom-nav pointer-events-auto grid min-h-[68px] min-w-0 grid-cols-4 rounded-[26px] border border-[rgba(61,59,67,.14)] bg-[rgba(247,247,249,.88)] p-[5px] shadow-[0_14px_38px_rgba(36,34,43,.16)] backdrop-blur-[24px] backdrop-saturate-[1.65]",
          "[.platform-android_&]:min-h-[76px] [.platform-android_&]:rounded-none [.platform-android_&]:border-0 [.platform-android_&]:bg-transparent [.platform-android_&]:px-0 [.platform-android_&]:py-1.5 [.platform-android_&]:shadow-none [.platform-android_&]:backdrop-blur-none [.platform-android_&]:backdrop-saturate-100",
        )}
      >
        {destinations.map((destination) => {
          const Icon = destination.icon;
          const isActive = activeDestination === destination.value;
          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-h-14 min-w-0 cursor-pointer flex-col items-center justify-center gap-0.5 rounded-[20px] border-0 bg-transparent px-0.5 py-1 text-[#73746f] transition-[background-color,color,transform] duration-[120ms] ease-out active:scale-[.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#765bd0]",
                "[.platform-android_&]:min-h-[62px] [.platform-android_&]:gap-[3px] [.platform-android_&]:rounded-none",
                isActive &&
                  "active bg-[rgba(111,84,202,.12)] text-[#5941ae] [.platform-android_&]:bg-transparent [.platform-android_&]:text-[#4d378e]",
              )}
              key={destination.value}
              onClick={() => {
                if (destination.value === "dms") onDmsOpen();
                else if (destination.value === "inbox") onInboxOpen();
                else if (destination.value === "home") onHomeOpen();
                else onStatusChange(destination.value);
              }}
              type="button"
            >
              <span
                className={cn(
                  "relative grid min-h-[26px] min-w-8 place-items-center",
                  "[.platform-android_&]:min-h-[30px] [.platform-android_&]:min-w-[54px] [.platform-android_&]:rounded-[18px]",
                  isActive &&
                    "[.platform-android_&]:bg-[#e7def9]",
                )}
              >
                <Icon size={22} />
                {destination.count ? (
                  <i className="absolute -top-[3px] -right-[3px] grid h-[15px] min-w-[15px] place-items-center rounded-full border-2 border-[#f8f8fa] bg-[#d94f72] px-[3px] font-sans text-2xs leading-none font-bold text-white not-italic">
                    {destination.count}
                  </i>
                ) : null}
              </span>
              <strong className="max-w-full overflow-hidden text-2xs font-semibold text-ellipsis whitespace-nowrap text-inherit">
                {destination.label}
              </strong>
            </button>
          );
        })}
      </nav>
      {onCreate ? (
        <Button
          aria-label={t("dashboard.createIssue")}
          className={cn(
            "companion-fab pointer-events-auto absolute right-[3px] bottom-[72px] grid size-[52px] place-items-center rounded-full border border-[rgba(91,69,169,.2)] bg-[#654bb8] p-0 text-white shadow-[0_12px_30px_rgba(67,49,127,.26)] active:scale-[.94] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#765bd0]",
            "[.platform-ios_&]:static [.platform-ios_&]:justify-self-end",
            "[.platform-android_&]:right-[max(13px,env(safe-area-inset-right))] [.platform-android_&]:bottom-[calc(88px+env(safe-area-inset-bottom))] [.platform-android_&]:size-14 [.platform-android_&]:rounded-[17px] [.platform-android_&]:border-0 [.platform-android_&]:bg-[#ded2ff] [.platform-android_&]:text-[#32265b] [.platform-android_&]:shadow-[0_8px_20px_rgba(68,54,110,.22)]",
          )}
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
