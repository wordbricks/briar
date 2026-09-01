import {
  CalendarDays,
  FolderKanban,
  Plus,
  Settings2,
  UserRound,
} from "lucide-react";

import { useI18n } from "../i18n";
import type { PlanningProject } from "../types";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { EmptyState, MainContent, PageHeader } from "./layout";
import { cn } from "../lib/utils";

const statusVariant = {
  planned: "soft",
  active: "success",
  completed: "secondary",
  cancelled: "outline",
} as const;

const statusMessage = {
  planned: "planningProject.statusPlanned",
  active: "planningProject.statusActive",
  completed: "planningProject.statusCompleted",
  cancelled: "planningProject.statusCancelled",
} as const;

const statusOrder = {
  active: 0,
  planned: 1,
  completed: 2,
  cancelled: 3,
} as const;

export function Projects({
  isSidebarOpen,
  onCreate,
  onOpen,
  onSettings,
  organizationName,
  projects,
}: {
  isSidebarOpen: boolean;
  onCreate?: () => void;
  onOpen: (projectId: string, teamId: string) => void;
  onSettings: (projectId: string) => void;
  organizationName?: string;
  projects: readonly PlanningProject[];
}) {
  const { localeTag, t } = useI18n();
  const dateFormatter = new Intl.DateTimeFormat(localeTag, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  const sortedProjects = [...projects].sort(
    (left, right) =>
      statusOrder[left.status] - statusOrder[right.status] ||
      left.teamName.localeCompare(right.teamName, localeTag) ||
      left.sortOrder - right.sortOrder ||
      left.name.localeCompare(right.name, localeTag),
  );

  return (
    <MainContent className="flex h-full min-h-0 flex-col overflow-hidden">
      <PageHeader
        action={onCreate ? (
          <Button onClick={onCreate} size="sm" type="button">
            <Plus aria-hidden="true" />
            {t("projects.newProject")}
          </Button>
        ) : undefined}
        className={cn(
          "app-page-header",
          !isSidebarOpen && "sidebar-closed",
        )}
        description={t("projects.description", {
          name: organizationName ?? t("sidebar.projects"),
        })}
        title={t("projects.title")}
      />
      <div className="min-h-0 flex-1 overflow-auto p-6 max-[760px]:p-4">
        {sortedProjects.length === 0 ? (
          <EmptyState
            action={onCreate ? (
              <Button onClick={onCreate} type="button">
                <Plus aria-hidden="true" />
                {t("projects.newProject")}
              </Button>
            ) : undefined}
            description={t("projects.emptyDescription")}
            icon={<FolderKanban aria-hidden="true" />}
            title={t("projects.emptyTitle")}
          />
        ) : (
          <section
            aria-label={t("projects.listLabel")}
            className="mx-auto max-w-[1180px] overflow-hidden rounded-xl border border-border bg-card shadow-xs"
          >
            <div
              aria-hidden="true"
              className="grid min-h-10 grid-cols-[minmax(260px,2fr)_minmax(120px,1fr)_minmax(110px,.7fr)_minmax(120px,.8fr)_minmax(130px,.8fr)_40px] items-center gap-4 border-b border-border bg-muted/45 px-4 text-2xs font-semibold text-muted-foreground max-[980px]:grid-cols-[minmax(220px,2fr)_minmax(120px,1fr)_minmax(110px,.7fr)_40px] max-[760px]:grid-cols-[minmax(0,1fr)_auto_40px]"
            >
              <span>{t("projects.name")}</span>
              <span>{t("projects.team")}</span>
              <span>{t("projects.status")}</span>
              <span className="max-[980px]:hidden">{t("projects.lead")}</span>
              <span className="max-[980px]:hidden">{t("projects.targetDate")}</span>
              <span />
            </div>
            <div className="divide-y divide-border">
              {sortedProjects.map((project) => (
                <div
                  className="group relative grid min-h-[68px] grid-cols-[minmax(260px,2fr)_minmax(120px,1fr)_minmax(110px,.7fr)_minmax(120px,.8fr)_minmax(130px,.8fr)_40px] items-center gap-4 px-4 transition-colors hover:bg-accent/65 focus-within:bg-accent max-[980px]:grid-cols-[minmax(220px,2fr)_minmax(120px,1fr)_minmax(110px,.7fr)_40px] max-[760px]:grid-cols-[minmax(0,1fr)_auto_40px]"
                  key={project.id}
                >
                  <button
                    aria-label={t("projects.openProject", { name: project.name })}
                    className="absolute inset-y-0 left-0 right-12 z-0 cursor-pointer rounded-none outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => onOpen(project.id, project.teamId)}
                    type="button"
                  />
                  <span className="pointer-events-none relative z-[1] flex min-w-0 items-center gap-3">
                    <span
                      className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-primary"
                      style={project.color ? { color: project.color } : undefined}
                    >
                      <FolderKanban aria-hidden="true" size={17} />
                    </span>
                    <span className="grid min-w-0 gap-0.5">
                      <strong className="truncate text-sm font-semibold text-foreground">
                        {project.name}
                      </strong>
                      <small className="truncate text-2xs text-muted-foreground">
                        {project.description || t("projects.noDescription")}
                      </small>
                    </span>
                  </span>
                  <span className="pointer-events-none relative z-[1] truncate text-xs text-muted-foreground max-[760px]:hidden">
                    {project.teamName}
                  </span>
                  <Badge className="pointer-events-none relative z-[1] w-fit" variant={statusVariant[project.status]}>
                    {t(statusMessage[project.status])}
                  </Badge>
                  <span className="pointer-events-none relative z-[1] flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground max-[980px]:hidden">
                    <UserRound aria-hidden="true" className="size-3.5" />
                    {project.leadName ?? t("projects.noLead")}
                  </span>
                  <span className="pointer-events-none relative z-[1] flex min-w-0 items-center gap-1.5 truncate text-xs text-muted-foreground max-[980px]:hidden">
                    <CalendarDays aria-hidden="true" className="size-3.5" />
                    {project.targetDate
                      ? dateFormatter.format(
                          Date.parse(`${project.targetDate}T00:00:00.000Z`),
                        )
                      : t("projects.noTargetDate")}
                  </span>
                  <Button
                    aria-label={t("sidebar.editPlanningProject", {
                      name: project.name,
                    })}
                    className="relative z-[2] opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 max-[760px]:opacity-100"
                    onClick={() => onSettings(project.id)}
                    size="icon-sm"
                    title={t("sidebar.editPlanningProject", {
                      name: project.name,
                    })}
                    type="button"
                    variant="ghost"
                  >
                    <Settings2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </MainContent>
  );
}
