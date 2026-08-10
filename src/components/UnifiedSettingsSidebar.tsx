import {
  Bot,
  Building2,
  Cpu,
  ChevronDown,
  Download,
  GitBranch,
  Plug,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

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
import type { ProjectSettingsSection } from "./ProjectSettings";
import { ProjectIcon } from "./ProjectIcon";

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
      section: ProjectSettingsSection;
    };

type NavigationItem<Section extends string> = {
  id: Section;
  icon: ReactNode;
  label: string;
};

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
  const projectItems = useMemo<NavigationItem<ProjectSettingsSection>[]>(
    () => [
      {
        id: "general",
        icon: <SlidersHorizontal size={16} strokeWidth={1.75} />,
        label: t("settings.navGeneral"),
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
  const organizationSectionMatches = organizationItems.some((item) =>
    matches(item.label),
  );
  const visibleOrganizations = organizations.filter(
    (organization) =>
      matches(organization.name) ||
      matches(t("organization.settingsLabel")) ||
      organizationSectionMatches,
  );
  const projectSectionMatches = projectItems.some((item) =>
    matches(item.label),
  );
  const visibleProjects = projects.filter(
    (project) =>
      matches(project.name) ||
      matches(t("settings.title")) ||
      projectSectionMatches,
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

      <SettingsNav className="unified-settings-nav">
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

        {visibleOrganizations.length > 0 ? (
          <SettingsNavGroup label={t("organization.settingsLabel")}>
            {visibleOrganizations.map((organization) => {
              const expanded =
                expandedOrganizationId === organization.id ||
                Boolean(normalizedQuery);
              const active =
                activeTarget.scope === "organization" &&
                activeTarget.organizationId === organization.id;
              return (
                <div className="settings-nav-tree" key={organization.id}>
                  <SettingsNavItem
                    active={active && !expanded}
                    aria-expanded={expanded}
                    className="settings-nav-parent [&>span:last-child]:flex [&>span:last-child]:flex-1"
                    data-organization-settings={organization.id}
                    icon={<Building2 size={16} strokeWidth={1.75} />}
                    onClick={() => {
                      setExpandedOrganizationId((current) =>
                        current === organization.id ? null : organization.id,
                      );
                      if (!active) {
                        onNavigate({
                          scope: "organization",
                          organizationId: organization.id,
                          section: "general",
                        });
                      }
                    }}
                  >
                    <span className="flex min-w-0 flex-1 items-center">
                      <span className="truncate">{organization.name}</span>
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
                    <div className="settings-nav-children">
                      {organizationItems
                        .filter(
                          (item) =>
                            matches(organization.name) || matches(item.label),
                        )
                        .map((item) => (
                          <SettingsNavItem
                            active={active && activeTarget.section === item.id}
                            className="pl-8"
                            data-organization-settings-section={item.id}
                            icon={item.icon}
                            key={item.id}
                            onClick={() =>
                              onNavigate({
                                scope: "organization",
                                organizationId: organization.id,
                                section: item.id,
                              })
                            }
                          >
                            {item.label}
                          </SettingsNavItem>
                        ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </SettingsNavGroup>
        ) : null}

        {visibleProjects.length > 0 ? (
          <SettingsNavGroup label={t("settings.title")}>
            {visibleProjects.map((project) => {
              const expanded =
                expandedProjectId === project.id || Boolean(normalizedQuery);
              const active =
                activeTarget.scope === "project" &&
                activeTarget.projectId === project.id;
              return (
                <div className="settings-nav-tree" key={project.id}>
                  <SettingsNavItem
                    active={active && !expanded}
                    aria-expanded={expanded}
                    className="settings-nav-parent [&>span:last-child]:flex [&>span:last-child]:flex-1"
                    data-project-settings={project.id}
                    icon={<ProjectIcon className="size-4" project={project} />}
                    onClick={() => {
                      setExpandedProjectId((current) =>
                        current === project.id ? null : project.id,
                      );
                      if (!active) {
                        onNavigate({
                          scope: "project",
                          projectId: project.id,
                          section: "general",
                        });
                      }
                    }}
                  >
                    <span className="flex min-w-0 flex-1 items-center">
                      <span className="truncate">{project.name}</span>
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
                    <div className="settings-nav-children">
                      {projectItems
                        .filter(
                          (item) =>
                            matches(project.name) || matches(item.label),
                        )
                        .map((item) => (
                          <SettingsNavItem
                            active={active && activeTarget.section === item.id}
                            className="pl-8"
                            data-project-settings-section={item.id}
                            icon={item.icon}
                            key={item.id}
                            onClick={() =>
                              onNavigate({
                                scope: "project",
                                projectId: project.id,
                                section: item.id,
                              })
                            }
                          >
                            {item.label}
                          </SettingsNavItem>
                        ))}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </SettingsNavGroup>
        ) : null}
      </SettingsNav>
    </SettingsSidebar>
  );
}
