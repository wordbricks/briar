import {
  Bot,
  Building2,
  Cpu,
  ChevronDown,
  Download,
  GitBranch,
  LayoutList,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import {
  SettingsBackButton,
  SettingsNav,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsSearch,
  SettingsSidebar,
} from "@/components/settings";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";
import type { Organization, Project } from "../types";
import {
  appSettingsNavigationItems,
  type SettingsSection,
} from "./app-settings-navigation";
import type { OrganizationSettingsSection } from "./OrganizationSettings";
import type { TeamSettingsSection } from "./TeamSettings";
import { TeamIcon } from "./TeamIcon";

export type UnifiedSettingsTarget =
  | { scope: "application"; section: SettingsSection }
  | {
      scope: "organization";
      organizationId: string;
      section: OrganizationSettingsSection;
    }
  | {
      scope: "project";
      projectId: string;
      section: TeamSettingsSection;
    };

type NavigationItem<Section extends string> = {
  id: Section;
  icon: ReactNode;
  label: string;
};

function SettingsTreeGroup<
  Entity extends { id: string; name: string },
  Section extends string,
>({
  activeEntityId,
  activeSection,
  defaultSection,
  entities,
  expandedId,
  groupLabel,
  items,
  normalizedQuery,
  onExpandedIdChange,
  onNavigate,
  renderEntityIcon,
  scope,
  targetFor,
}: {
  activeEntityId: string | null;
  activeSection: Section | null;
  defaultSection: Section;
  entities: Entity[];
  expandedId: string | null;
  groupLabel: string;
  items: NavigationItem<Section>[];
  normalizedQuery: string;
  onExpandedIdChange: Dispatch<SetStateAction<string | null>>;
  onNavigate: (target: UnifiedSettingsTarget) => void;
  renderEntityIcon: (entity: Entity) => ReactNode;
  scope: "organization" | "project";
  targetFor: (entity: Entity, section: Section) => UnifiedSettingsTarget;
}) {
  const matches = (value: string) =>
    !normalizedQuery || value.toLocaleLowerCase().includes(normalizedQuery);
  const sectionMatches = items.some((item) => matches(item.label));
  const visibleEntities = entities.filter(
    (entity) =>
      matches(entity.name) || matches(groupLabel) || sectionMatches,
  );

  if (visibleEntities.length === 0) return null;

  return (
    <SettingsNavGroup label={groupLabel}>
      {visibleEntities.map((entity) => {
        const expanded = expandedId === entity.id || Boolean(normalizedQuery);
        const active = activeEntityId === entity.id;
        const parentDataAttributes = {
          [`data-${scope}-settings`]: entity.id,
        };
        return (
          <div className="grid gap-0.5" key={entity.id}>
            <SettingsNavItem
              active={active && !expanded}
              aria-expanded={expanded}
              className="[&>span:last-child]:flex [&>span:last-child]:flex-1"
              icon={renderEntityIcon(entity)}
              onClick={() => {
                onExpandedIdChange((current) =>
                  current === entity.id ? null : entity.id,
                );
                if (!active) onNavigate(targetFor(entity, defaultSection));
              }}
              {...parentDataAttributes}
            >
              <span className="flex min-w-0 flex-1 items-center">
                <span className="truncate">{entity.name}</span>
                <ChevronDown
                  aria-hidden="true"
                  className={cn(
                    "ml-auto size-3.5 shrink-0 transition-transform",
                    expanded && "rotate-180",
                  )}
                />
              </span>
            </SettingsNavItem>
            {expanded ? (
              <div className="grid gap-0.5">
                {items
                  .filter(
                    (item) => matches(entity.name) || matches(item.label),
                  )
                  .map((item) => {
                    const sectionDataAttributes = {
                      [`data-${scope}-settings-section`]: item.id,
                    };
                    return (
                      <SettingsNavItem
                        active={active && activeSection === item.id}
                        className="pl-8"
                        icon={item.icon}
                        key={item.id}
                        onClick={() => onNavigate(targetFor(entity, item.id))}
                        {...sectionDataAttributes}
                      >
                        {item.label}
                      </SettingsNavItem>
                    );
                  })}
              </div>
            ) : null}
          </div>
        );
      })}
    </SettingsNavGroup>
  );
}

export function UnifiedSettingsSidebar({
  activeTarget,
  isOpen,
  onBack,
  onNavigate,
  organizations,
  projects,
}: {
  activeTarget: UnifiedSettingsTarget;
  isOpen: boolean;
  onBack: () => void;
  onNavigate: (target: UnifiedSettingsTarget) => void;
  organizations: Organization[];
  projects: Project[];
}) {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedOrganizationId, setExpandedOrganizationId] = useState<
    string | null
  >(activeTarget.scope === "organization" ? activeTarget.organizationId : null);
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(
    activeTarget.scope === "project" ? activeTarget.projectId : null,
  );

  useEffect(() => {
    if (activeTarget.scope === "organization") {
      setExpandedOrganizationId(activeTarget.organizationId);
    }
    if (activeTarget.scope === "project") {
      setExpandedProjectId(activeTarget.projectId);
    }
  }, [activeTarget]);

  const applicationItems = useMemo<NavigationItem<SettingsSection>[]>(
    () =>
      appSettingsNavigationItems.map((item) => {
        const Icon = item.icon;
        return {
          id: item.id,
          icon: <Icon size={16} strokeWidth={1.75} />,
          label: t(item.labelKey),
        };
      }),
    [t],
  );
  const organizationItems = useMemo<
    NavigationItem<OrganizationSettingsSection>[]
  >(
    () => [
      {
        id: "general",
        icon: <Building2 size={16} strokeWidth={1.75} />,
        label: t("organization.general"),
      },
      {
        id: "members",
        icon: <Users size={16} strokeWidth={1.75} />,
        label: t("organization.membersAndInvites"),
      },
      {
        id: "agents",
        icon: <Bot size={16} strokeWidth={1.75} />,
        label: t("organization.agents"),
      },
      {
        id: "workers",
        icon: <Cpu size={16} strokeWidth={1.75} />,
        label: t("organization.workers"),
      },
      {
        id: "integrations",
        icon: <Plug size={16} strokeWidth={1.75} />,
        label: t("organization.integrations"),
      },
    ],
    [t],
  );
  const projectItems = useMemo<NavigationItem<TeamSettingsSection>[]>(
    () => [
      {
        id: "general",
        icon: <SlidersHorizontal size={16} strokeWidth={1.75} />,
        label: t("settings.navGeneral"),
      },
      {
        id: "tabs",
        icon: <LayoutList size={16} strokeWidth={1.75} />,
        label: t("settings.navTabs"),
      },
      {
        id: "integrations",
        icon: <Plug size={16} strokeWidth={1.75} />,
        label: t("settings.navIntegrations"),
      },
      {
        id: "issue-import",
        icon: <Download size={16} strokeWidth={1.75} />,
        label: t("settings.navIssueImport"),
      },
      {
        id: "agent-configuration",
        icon: <ShieldCheck size={16} strokeWidth={1.75} />,
        label: t("settings.navAgent"),
      },
      {
        id: "execution",
        icon: <Cpu size={16} strokeWidth={1.75} />,
        label: t("settings.navExecution"),
      },
      {
        id: "workflow",
        icon: <GitBranch size={16} strokeWidth={1.75} />,
        label: t("settings.navWorkflow"),
      },
    ],
    [t],
  );
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase();
  const matches = (value: string) =>
    !normalizedQuery || value.toLocaleLowerCase().includes(normalizedQuery);
  const filteredApplicationItems = applicationItems.filter((item) =>
    matches(item.label),
  );

  return (
    <SettingsSidebar isOpen={isOpen} label={t("appSettings.navigation")}>
      <SettingsBackButton onClick={onBack}>
        {t("appSettings.back")}
      </SettingsBackButton>

      <SettingsSearch
        label={t("appSettings.search")}
        onChange={setSearchQuery}
        value={searchQuery}
      />

      <SettingsNav>
        {filteredApplicationItems.length > 0 ? (
          <SettingsNavGroup label={t("appSettings.applicationSection")}>
            {filteredApplicationItems.map((item) => (
              <SettingsNavItem
                active={
                  activeTarget.scope === "application" &&
                  activeTarget.section === item.id
                }
                data-settings-scope="application"
                data-settings-section={item.id}
                icon={item.icon}
                key={item.id}
                onClick={() =>
                  onNavigate({ scope: "application", section: item.id })
                }
              >
                {item.label}
              </SettingsNavItem>
            ))}
          </SettingsNavGroup>
        ) : null}

        <SettingsTreeGroup
          activeEntityId={
            activeTarget.scope === "organization"
              ? activeTarget.organizationId
              : null
          }
          activeSection={
            activeTarget.scope === "organization" ? activeTarget.section : null
          }
          defaultSection="general"
          entities={organizations}
          expandedId={expandedOrganizationId}
          groupLabel={t("organization.settingsLabel")}
          items={organizationItems}
          normalizedQuery={normalizedQuery}
          onExpandedIdChange={setExpandedOrganizationId}
          onNavigate={onNavigate}
          renderEntityIcon={() => (
            <Building2 size={16} strokeWidth={1.75} />
          )}
          scope="organization"
          targetFor={(organization, section) => ({
            scope: "organization",
            organizationId: organization.id,
            section,
          })}
        />

        <SettingsTreeGroup
          activeEntityId={
            activeTarget.scope === "project" ? activeTarget.projectId : null
          }
          activeSection={
            activeTarget.scope === "project" ? activeTarget.section : null
          }
          defaultSection="general"
          entities={projects}
          expandedId={expandedProjectId}
          groupLabel={t("settings.title")}
          items={projectItems}
          normalizedQuery={normalizedQuery}
          onExpandedIdChange={setExpandedProjectId}
          onNavigate={onNavigate}
          renderEntityIcon={(project) => (
            <TeamIcon className="size-4" project={project} />
          )}
          scope="project"
          targetFor={(project, section) => ({
            scope: "project",
            projectId: project.id,
            section,
          })}
        />
      </SettingsNav>
    </SettingsSidebar>
  );
}
