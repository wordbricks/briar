import {
  Activity,
  Archive,
  Bell,
  Bot,
  GitBranch,
  Globe2,
  Keyboard,
  Link2,
  Palette,
  SlidersHorizontal,
  UserRound,
  type LucideIcon,
} from "lucide-react";

import type { MessageKey } from "../i18n/messages";

export type SettingsSection =
  | "account"
  | "general"
  | "appearance"
  | "notifications"
  | "keybindings"
  | "usage"
  | "providers"
  | "browser"
  | "source-control"
  | "connections"
  | "archive";

export type AppSettingsNavigationItem = {
  id: SettingsSection;
  icon: LucideIcon;
  labelKey: MessageKey;
  descriptionKey: MessageKey;
};

export type AppSettingsNavigationGroup = {
  id: string;
  labelKey: MessageKey;
  items: readonly AppSettingsNavigationItem[];
};

export const appSettingsNavigationGroups = [
  {
    id: "setup",
    labelKey: "appSettings.groupSetup",
    items: [
      {
        id: "account",
        icon: UserRound,
        labelKey: "account.profile",
        descriptionKey: "account.profileDescription",
      },
      {
        id: "general",
        icon: SlidersHorizontal,
        labelKey: "appSettings.general",
        descriptionKey: "appSettings.generalDescription",
      },
      {
        id: "appearance",
        icon: Palette,
        labelKey: "appSettings.appearance",
        descriptionKey: "appSettings.appearanceDescription",
      },
      {
        id: "notifications",
        icon: Bell,
        labelKey: "notifications.title",
        descriptionKey: "notifications.description",
      },
      {
        id: "keybindings",
        icon: Keyboard,
        labelKey: "appSettings.keybindings",
        descriptionKey: "appSettings.keybindingsDescription",
      },
    ],
  },
  {
    id: "ai",
    labelKey: "appSettings.groupAi",
    items: [
      {
        id: "usage",
        icon: Activity,
        labelKey: "usage.title",
        descriptionKey: "usage.settingsDescription",
      },
      {
        id: "providers",
        icon: Bot,
        labelKey: "appSettings.providers",
        descriptionKey: "appSettings.providersDescription",
      },
    ],
  },
  {
    id: "workflows",
    labelKey: "appSettings.groupWorkflows",
    items: [
      {
        id: "browser",
        icon: Globe2,
        labelKey: "appSettings.browser",
        descriptionKey: "appSettings.browserDescription",
      },
      {
        id: "source-control",
        icon: GitBranch,
        labelKey: "appSettings.sourceControl",
        descriptionKey: "appSettings.sourceControlDescription",
      },
      {
        id: "connections",
        icon: Link2,
        labelKey: "appSettings.connections",
        descriptionKey: "appSettings.connectionsDescription",
      },
    ],
  },
  {
    id: "data",
    labelKey: "appSettings.groupData",
    items: [
      {
        id: "archive",
        icon: Archive,
        labelKey: "appSettings.archive",
        descriptionKey: "appSettings.archiveDescription",
      },
    ],
  },
] as const satisfies readonly AppSettingsNavigationGroup[];

export const appSettingsNavigationItems =
  appSettingsNavigationGroups.reduce<AppSettingsNavigationItem[]>(
    (items, group) => [...items, ...group.items],
    [],
  );
