import {
  Building2,
  Bot,
  Check,
  Copy,
  Cpu,
  Download,
  ImagePlus,
  Plug,
  Search,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  SettingsAlert,
  SettingsBackButton,
  SettingsIdentity,
  SettingsMain,
  SettingsNav,
  SettingsNavGroup,
  SettingsNavItem,
  SettingsPageHeader,
  SettingsScroll,
  SettingsShell,
  SettingsSidebar,
} from "@/components/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Typography } from "@/components/ui/typography";
import { cn } from "@/lib/utils";
import { useI18n } from "../i18n";
import {
  createOrganizationInvitation,
  loadOrganizationInvitations,
  loadOrganizationMembers,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  updateOrganizationMemberRole,
  updateOrganizationMemberProjects,
} from "../lib/api";
import {
  organizationLogoAccept,
  organizationLogoFromFile,
} from "../lib/organization-logo";
import type {
  Organization,
  OrganizationInvitation,
  OrganizationMember,
  Project,
} from "../types";
import { OrganizationWorkersSettings } from "./OrganizationWorkersSettings";
import { OrganizationIntegrationsSettings } from "./OrganizationIntegrationsSettings";
import { OrganizationAgentsSettings } from "./OrganizationAgentsSettings";
import { SelectMenu } from "./SelectMenu";
import type { OrganizationSettingsSection } from "../lib/app-navigation";

export type { OrganizationSettingsSection } from "../lib/app-navigation";

type RoleFilter = "all" | OrganizationMember["role"];

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function OrganizationSettings({
  organization,
  token,
  onBack,
  onLogoChange,
  onRename,
  isSidebarOpen = true,
  initialSection,
  navigationSidebar,
  connectedProjectIds = null,
  projects = [],
  userId = "",
}: {
  organization: Organization;
  token: string;
  onBack: () => void;
  onLogoChange: (
    organizationId: string,
    logo: string | null,
  ) => Promise<Organization>;
  onRename: (organizationId: string, name: string) => Promise<Organization>;
  isSidebarOpen?: boolean;
  initialSection?: OrganizationSettingsSection;
  navigationSidebar?: ReactNode;
  connectedProjectIds?: string[] | null;
  projects?: Project[];
  userId?: string;
}) {
  const { locale, t } = useI18n();
  const [activeSection, setActiveSection] =
    useState<OrganizationSettingsSection>(initialSection ?? "general");
  const [organizationName, setOrganizationName] = useState(organization.name);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [renameSaved, setRenameSaved] = useState(false);
  const [isLogoSaving, setIsLogoSaving] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoSaved, setLogoSaved] = useState(false);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const organizationProjects = useMemo(
    () =>
      projects.filter((project) => project.organizationId === organization.id),
    [organization.id, projects],
  );
  const [initialProjectId, setInitialProjectId] = useState(
    organizationProjects[0]?.id ?? "",
  );
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [inviteLinkCopied, setInviteLinkCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [projectAccessMember, setProjectAccessMember] =
    useState<OrganizationMember | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<string[]>([]);
  const [savingProjectAccess, setSavingProjectAccess] = useState(false);
  const [revokingInvitationId, setRevokingInvitationId] = useState<
    string | null
  >(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const inviteEmailRef = useRef<HTMLInputElement | null>(null);
  const organizationId = organization.id;
  const canManage =
    organization.role === "owner" || organization.role === "admin";
  const dateLocale =
    locale === "ko" ? "ko-KR" : locale === "zh" ? "zh-CN" : "en-US";
  const normalizedOrganizationName = organizationName.trim();
  const canSaveOrganizationName =
    canManage &&
    normalizedOrganizationName.length > 0 &&
    normalizedOrganizationName.length <= 100 &&
    normalizedOrganizationName !== organization.name &&
    !isRenaming;

  useEffect(() => {
    if (!token) {
      setMembers([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    void Promise.all([
      loadOrganizationMembers(token, organizationId),
      canManage
        ? loadOrganizationInvitations(token, organizationId)
        : Promise.resolve([]),
    ])
      .then(([nextMembers, nextInvitations]) => {
        setMembers(nextMembers);
        setInvitations(nextInvitations);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      )
      .finally(() => setLoading(false));
  }, [canManage, organizationId, token]);

  useEffect(() => {
    if (
      initialProjectId &&
      organizationProjects.some((project) => project.id === initialProjectId)
    ) {
      return;
    }
    setInitialProjectId(organizationProjects[0]?.id ?? "");
  }, [initialProjectId, organizationProjects]);

  useEffect(() => {
    if (activeSection === "members") searchRef.current?.focus();
  }, [activeSection]);

  useEffect(() => {
    if (initialSection) setActiveSection(initialSection);
  }, [initialSection]);

  useEffect(() => {
    setOrganizationName(organization.name);
    setRenameSaved(false);
    setRenameError(null);
  }, [organization.name]);

  useEffect(() => {
    if (isInviteOpen) inviteEmailRef.current?.focus();
  }, [isInviteOpen]);

  const filteredMembers = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return members
      .filter((member) => roleFilter === "all" || member.role === roleFilter)
      .filter(
        (member) =>
          !normalized ||
          `${member.name} ${member.email}`
            .toLocaleLowerCase()
            .includes(normalized),
      )
      .sort((left, right) => left.name.localeCompare(right.name, dateLocale));
  }, [dateLocale, members, query, roleFilter]);

  const roleLabel = (memberRole: OrganizationMember["role"]) =>
    t(`organization.role.${memberRole}` as
      | "organization.role.owner"
      | "organization.role.admin"
      | "organization.role.member");

  const exportMembers = () => {
    const rows = [
      [
        t("organization.name"),
        t("organization.email"),
        t("organization.role"),
        t("organization.projects"),
        t("organization.joined"),
      ],
      ...filteredMembers.map((member) => [
        member.name,
        member.email,
        roleLabel(member.role),
        member.role === "owner" || member.role === "admin"
          ? t("organization.allProjects")
          : organizationProjects
            .filter((project) => member.projectIds?.includes(project.id))
            .map((project) => project.name)
            .join(", "),
        member.createdAt,
      ]),
    ];
    const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${organization.name}-members.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <SettingsShell className="bg-background">
      {navigationSidebar || <SettingsSidebar
        className="bg-[#f1f1f0]"
        isOpen={isSidebarOpen}
        label={t("organization.navigation")}
      >
        <SettingsBackButton onClick={onBack}>
          {t("organization.backToApp")}
        </SettingsBackButton>

        <SettingsIdentity
          icon={
            organization.logo ? (
              <img
                alt=""
                className="size-full rounded-lg object-cover"
                src={organization.logo}
              />
            ) : (
              <Building2 aria-hidden="true" size={17} strokeWidth={1.8} />
            )
          }
          subtitle={t("organization.settingsLabel")}
          title={organization.name}
        />

        <SettingsNav>
          <SettingsNavGroup label={t("organization.organizationSection")}>
            <SettingsNavItem
              active={activeSection === "general"}
              icon={<Building2 aria-hidden="true" size={16} strokeWidth={1.8} />}
              onClick={() => setActiveSection("general")}
            >
              {t("organization.general")}
            </SettingsNavItem>
            <SettingsNavItem
              active={activeSection === "members"}
              icon={<Users aria-hidden="true" size={16} strokeWidth={1.8} />}
              onClick={() => setActiveSection("members")}
            >
              {t("organization.membersAndInvites")}
            </SettingsNavItem>
            <SettingsNavItem
              active={activeSection === "agents"}
              icon={<Bot aria-hidden="true" size={16} strokeWidth={1.8} />}
              onClick={() => setActiveSection("agents")}
            >
              {t("organization.agents")}
            </SettingsNavItem>
            <SettingsNavItem
              active={activeSection === "workers"}
              icon={<Cpu aria-hidden="true" size={16} strokeWidth={1.8} />}
              onClick={() => setActiveSection("workers")}
            >
              {t("organization.workers")}
            </SettingsNavItem>
            <SettingsNavItem
              active={activeSection === "integrations"}
              icon={
                <Plug aria-hidden="true" size={16} strokeWidth={1.8} />
              }
              onClick={() => setActiveSection("integrations")}
            >
              {t("organization.integrations")}
            </SettingsNavItem>
          </SettingsNavGroup>
        </SettingsNav>
      </SettingsSidebar>}

      <SettingsMain className="bg-[#fbfbfd]" isSidebarOpen={isSidebarOpen}>
        <SettingsScroll className="pt-[clamp(40px,8vw,76px)]">
          <div className="mx-auto w-full max-w-[980px]">
            {activeSection === "general" ? (
              <>
                <SettingsPageHeader
                  className="mb-12 max-w-none"
                  description={t("organization.settingsDescription", {
                    name: organization.name,
                  })}
                  title={t("organization.settingsTitle")}
                />

                <section className="w-full max-w-[820px]">
                  <Typography as="h2" className="mb-3.5" variant="bodyLg">
                    {t("organization.general")}
                  </Typography>
                  <div className="mb-4 grid grid-cols-1 items-center gap-x-8 gap-y-4 rounded-xl border border-border bg-card p-6 shadow-xs md:grid-cols-[minmax(200px,1fr)_minmax(260px,360px)]">
                    <div>
                      <Label>{t("organization.logo")}</Label>
                      <Typography className="mt-1.5" tone="muted" variant="caption">
                        {t("organization.logoDescription")}
                      </Typography>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl border border-border bg-secondary text-muted-foreground">
                        {organization.logo ? (
                          <img
                            alt={t("organization.logoPreview", {
                              name: organization.name,
                            })}
                            className="size-full object-cover"
                            src={organization.logo}
                          />
                        ) : (
                          <Building2 aria-hidden="true" size={25} strokeWidth={1.7} />
                        )}
                      </span>
                      <div className="grid gap-2">
                        {canManage ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              aria-disabled={isLogoSaving}
                              asChild
                              className={cn(
                                isLogoSaving && "pointer-events-none opacity-50",
                              )}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              <label>
                                <ImagePlus aria-hidden="true" size={15} strokeWidth={1.8} />
                                {t(
                                  organization.logo
                                    ? "organization.replaceLogo"
                                    : "organization.uploadLogo",
                                )}
                                <input
                                  accept={organizationLogoAccept}
                                  aria-label={t("organization.uploadLogo")}
                                  className="sr-only"
                                  disabled={isLogoSaving}
                                  onChange={(event) => {
                                    const file = event.currentTarget.files?.[0];
                                    event.currentTarget.value = "";
                                    if (!file) return;
                                    setIsLogoSaving(true);
                                    setLogoError(null);
                                    setLogoSaved(false);
                                    void organizationLogoFromFile(file)
                                      .then((logo) =>
                                        onLogoChange(organizationId, logo),
                                      )
                                      .then(() => setLogoSaved(true))
                                      .catch(() =>
                                        setLogoError(
                                          t("organization.logoUploadFailed"),
                                        ),
                                      )
                                      .finally(() => setIsLogoSaving(false));
                                  }}
                                  type="file"
                                />
                              </label>
                            </Button>
                            {organization.logo ? (
                              <Button
                                disabled={isLogoSaving}
                                onClick={() => {
                                  setIsLogoSaving(true);
                                  setLogoError(null);
                                  setLogoSaved(false);
                                  void onLogoChange(organizationId, null)
                                    .then(() => setLogoSaved(true))
                                    .catch(() =>
                                      setLogoError(
                                        t("organization.logoUploadFailed"),
                                      ),
                                    )
                                    .finally(() => setIsLogoSaving(false));
                                }}
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                <Trash2 aria-hidden="true" size={14} strokeWidth={1.8} />
                                {t("organization.removeLogo")}
                              </Button>
                            ) : null}
                          </div>
                        ) : (
                          <Typography tone="muted" variant="caption">
                            {t("organization.logoPermission")}
                          </Typography>
                        )}
                        <Typography tone="muted" variant="micro">
                          {t("organization.logoHint")}
                        </Typography>
                        {logoError ? (
                          <Typography
                            className="text-destructive"
                            role="alert"
                            variant="caption"
                          >
                            {logoError}
                          </Typography>
                        ) : logoSaved ? (
                          <Typography
                            className="text-success"
                            role="status"
                            variant="caption"
                          >
                            {t("organization.logoSaved")}
                          </Typography>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <form
                    className="grid grid-cols-1 items-center gap-x-8 gap-y-4 rounded-xl border border-border bg-card p-6 shadow-xs md:grid-cols-[minmax(200px,1fr)_minmax(260px,360px)]"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (!canSaveOrganizationName) return;
                      setIsRenaming(true);
                      setRenameError(null);
                      setRenameSaved(false);
                      void onRename(organizationId, normalizedOrganizationName)
                        .then((updatedOrganization) => {
                          setOrganizationName(updatedOrganization.name);
                          setRenameSaved(true);
                        })
                        .catch((caught) =>
                          setRenameError(
                            caught instanceof Error
                              ? caught.message
                              : String(caught),
                          ),
                        )
                        .finally(() => setIsRenaming(false));
                    }}
                  >
                    <div>
                      <Label htmlFor="organization-name">
                        {t("organization.organizationName")}
                      </Label>
                      <Typography className="mt-1.5" tone="muted" variant="caption">
                        {t("organization.organizationNameDescription")}
                      </Typography>
                    </div>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Input
                        autoComplete="organization"
                        disabled={!canManage || isRenaming}
                        id="organization-name"
                        maxLength={100}
                        onChange={(event) => {
                          setOrganizationName(event.target.value);
                          setRenameSaved(false);
                          setRenameError(null);
                        }}
                        required
                        value={organizationName}
                      />
                      <Button disabled={!canSaveOrganizationName} type="submit">
                        {isRenaming ? t("common.saving") : t("common.save")}
                      </Button>
                    </div>
                    {!canManage ? (
                      <Typography
                        className="md:col-start-2 -mt-1"
                        tone="muted"
                        variant="caption"
                      >
                        {t("organization.namePermission")}
                      </Typography>
                    ) : renameError ? (
                      <Typography
                        className="md:col-start-2 -mt-1 text-destructive"
                        role="alert"
                        variant="caption"
                      >
                        {renameError}
                      </Typography>
                    ) : renameSaved ? (
                      <Typography
                        className="md:col-start-2 -mt-1 text-success"
                        role="status"
                        variant="caption"
                      >
                        {t("organization.nameSaved")}
                      </Typography>
                    ) : null}
                  </form>
                </section>
              </>
            ) : activeSection === "members" ? (
              <>
                <SettingsPageHeader
                  className="mb-7 max-w-none"
                  description={t("organization.membersDescription", {
                    name: organization.name,
                  })}
                  title={t("organization.membersTitle")}
                />

                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <label className="flex h-9 min-w-[220px] flex-1 items-center gap-2 rounded-md border border-border bg-card px-2.5 text-muted-foreground focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/20">
                    <Search aria-hidden="true" size={17} strokeWidth={1.8} />
                    <Input
                      aria-label={t("organization.search")}
                      className="h-full border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={t("organization.searchPlaceholder")}
                      ref={searchRef}
                      type="search"
                      value={query}
                    />
                  </label>
                  <SelectMenu
                    className="organization-role-filter"
                    label={t("organization.roleFilter")}
                    onValueChange={(value) => setRoleFilter(value as RoleFilter)}
                    options={[
                      { label: t("organization.filterAll"), value: "all" },
                      { label: t("organization.role.owner"), value: "owner" },
                      { label: t("organization.role.admin"), value: "admin" },
                      { label: t("organization.role.member"), value: "member" },
                    ]}
                    size="small"
                    value={roleFilter}
                  />
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <Button
                      disabled={members.length === 0}
                      onClick={exportMembers}
                      type="button"
                      variant="outline"
                    >
                      <Download aria-hidden="true" size={15} strokeWidth={1.8} />
                      {t("organization.exportCsv")}
                    </Button>
                    {canManage ? (
                      <Button
                        onClick={() => {
                          setError(null);
                          setInviteUrl(null);
                          setInviteLinkCopied(false);
                          setIsInviteOpen(true);
                        }}
                        type="button"
                      >
                        <UserPlus aria-hidden="true" size={15} strokeWidth={1.8} />
                        {t("organization.invite")}
                      </Button>
                    ) : null}
                  </div>
                </div>

                {error && !isInviteOpen ? (
                  <SettingsAlert className="mb-4 mt-0">{error}</SettingsAlert>
                ) : null}

                <section
                  aria-label={t("organization.memberList")}
                  className="overflow-hidden rounded-xl border border-border bg-card"
                >
                  <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_110px_140px_90px_40px] gap-3 border-b border-border px-4 py-2.5 text-micro font-medium tracking-wide text-muted-foreground uppercase">
                    <span>{t("organization.name")}</span>
                    <span>{t("organization.email")}</span>
                    <span>{t("organization.role")}</span>
                    <span>{t("organization.projects")}</span>
                    <span>{t("organization.joined")}</span>
                    <span className="visually-hidden">{t("organization.actions")}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border bg-muted/60 px-4 py-2">
                    <Typography as="strong" variant="bodySm">
                      {t("organization.active")}
                    </Typography>
                    <Badge variant="secondary">{members.length}</Badge>
                  </div>
                  {loading ? (
                    <Typography className="p-8 text-center" tone="muted" variant="bodySm">
                      {t("organization.loading")}
                    </Typography>
                  ) : filteredMembers.length === 0 ? (
                    <Typography className="p-8 text-center" tone="muted" variant="bodySm">
                      {members.length === 0
                        ? t("organization.noMembers")
                        : t("organization.noResults")}
                    </Typography>
                  ) : (
                    filteredMembers.map((member) => (
                      <div
                        className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1.3fr)_110px_140px_90px_40px] items-center gap-3 border-b border-border/80 px-4 py-3 last:border-b-0"
                        key={member.userId}
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <div className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-secondary text-xs font-semibold text-foreground">
                            {member.image ? (
                              <img alt="" className="size-full object-cover" src={member.image} />
                            ) : (
                              member.name.slice(0, 1).toUpperCase()
                            )}
                          </div>
                          <div className="min-w-0">
                            <Typography as="strong" className="block truncate" variant="bodySm">
                              {member.name}
                            </Typography>
                            <Typography as="small" className="truncate" tone="muted" variant="micro">
                              {member.email.split("@")[0]}
                            </Typography>
                          </div>
                        </div>
                        <Typography as="span" className="truncate" tone="muted" variant="bodySm">
                          {member.email}
                        </Typography>
                        {canManage &&
                        member.role !== "owner" &&
                        member.userId !== userId ? (
                          <SelectMenu
                            className="w-full"
                            disabled={updatingMemberId === member.userId}
                            label={t("organization.changeRole", {
                              name: member.name,
                            })}
                            onValueChange={(value) => {
                              setUpdatingMemberId(member.userId);
                              setError(null);
                              void updateOrganizationMemberRole(
                                token,
                                organizationId,
                                member.userId,
                                value as "admin" | "member",
                              )
                                .then((result) => setMembers(result.members))
                                .catch((caught) =>
                                  setError(
                                    caught instanceof Error
                                      ? caught.message
                                      : String(caught),
                                  ),
                                )
                                .finally(() => setUpdatingMemberId(null));
                            }}
                            options={[
                              {
                                label: t("organization.role.member"),
                                value: "member",
                              },
                              {
                                label: t("organization.role.admin"),
                                value: "admin",
                              },
                            ]}
                            size="small"
                            value={member.role}
                          />
                        ) : (
                          <Badge
                            className={cn(
                              "justify-center capitalize",
                              member.role === "owner" &&
                                "bg-accent text-accent-foreground",
                              member.role === "admin" && "bg-secondary",
                            )}
                            variant="secondary"
                          >
                            {roleLabel(member.role)}
                          </Badge>
                        )}
                        {member.role === "owner" || member.role === "admin" ? (
                          <Typography as="span" tone="muted" variant="caption">
                            {t("organization.allProjects")}
                          </Typography>
                        ) : canManage ? (
                          <Button
                            className="w-full justify-start overflow-hidden"
                            onClick={() => {
                              setProjectAccessMember(member);
                              setSelectedProjectIds(
                                member.projectIds?.filter((projectId) =>
                                  organizationProjects.some(
                                    (project) => project.id === projectId,
                                  )
                                ) ?? [],
                              );
                              setError(null);
                            }}
                            size="sm"
                            type="button"
                            variant="outline"
                          >
                            <span className="truncate">
                              {(member.projectIds?.length ?? 0) === 0
                                ? t("organization.noProjectAccess")
                                : (member.projectIds?.length ?? 0) ===
                                    organizationProjects.length
                                  ? t("organization.allProjects")
                                  : t("organization.projectCount", {
                                      count: member.projectIds?.length ?? 0,
                                    })}
                            </span>
                          </Button>
                        ) : (
                          <Typography as="span" tone="muted" variant="caption">
                            {(member.projectIds?.length ?? 0) === 0
                              ? t("organization.noProjectAccess")
                              : t("organization.projectCount", {
                                  count: member.projectIds?.length ?? 0,
                                })}
                          </Typography>
                        )}
                        <time
                          className="text-xs text-muted-foreground"
                          dateTime={member.createdAt}
                        >
                          {new Intl.DateTimeFormat(dateLocale, {
                            month: "short",
                            year: "numeric",
                          }).format(new Date(member.createdAt))}
                        </time>
                        {organization.role === "owner" && member.role !== "owner" ? (
                          <Button
                            aria-label={t("organization.removeMember", {
                              name: member.name,
                            })}
                            className="size-8 text-muted-foreground hover:text-destructive"
                            disabled={removingMemberId === member.userId}
                            onClick={() => {
                              setRemovingMemberId(member.userId);
                              setError(null);
                              void removeOrganizationMember(
                                token,
                                organizationId,
                                member.userId,
                              )
                                .then(() =>
                                  setMembers((current) =>
                                    current.filter(
                                      (item) => item.userId !== member.userId,
                                    ),
                                  ),
                                )
                                .catch((caught) =>
                                  setError(
                                    caught instanceof Error
                                      ? caught.message
                                      : String(caught),
                                  ),
                                )
                                .finally(() => setRemovingMemberId(null));
                            }}
                            size="icon-sm"
                            title={t("organization.removeMember", {
                              name: member.name,
                            })}
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 size={15} strokeWidth={1.7} />
                          </Button>
                        ) : (
                          <span aria-hidden="true" />
                        )}
                      </div>
                    ))
                  )}
                </section>

                {canManage ? (
                  <section
                    aria-label={t("organization.pendingInvites")}
                    className="mt-5 overflow-hidden rounded-xl border border-border bg-card"
                  >
                    <div className="flex items-center justify-between border-b border-border bg-muted/60 px-4 py-3">
                      <div>
                        <Typography as="strong" variant="bodySm">
                          {t("organization.pendingInvites")}
                        </Typography>
                        <Typography
                          className="mt-0.5"
                          tone="muted"
                          variant="caption"
                        >
                          {t("organization.pendingInvitesDescription")}
                        </Typography>
                      </div>
                      <Badge variant="secondary">{invitations.length}</Badge>
                    </div>
                    {invitations.length === 0 ? (
                      <Typography
                        className="p-6 text-center"
                        tone="muted"
                        variant="bodySm"
                      >
                        {t("organization.noPendingInvites")}
                      </Typography>
                    ) : (
                      invitations.map((invitation) => (
                        <div
                          className="grid grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto_40px] items-center gap-3 border-b border-border/80 px-4 py-3 last:border-b-0"
                          key={invitation.id}
                        >
                          <div className="min-w-0">
                            <Typography
                              as="strong"
                              className="block truncate"
                              variant="bodySm"
                            >
                              {invitation.email}
                            </Typography>
                            <Typography tone="muted" variant="caption">
                              {t("organization.inviteExpires", {
                                date: new Intl.DateTimeFormat(dateLocale, {
                                  dateStyle: "medium",
                                }).format(new Date(invitation.expiresAt)),
                              })}
                            </Typography>
                          </div>
                          <Typography
                            className="truncate"
                            tone="muted"
                            variant="bodySm"
                          >
                            {invitation.initialProjectName}
                          </Typography>
                          <Badge variant="secondary">
                            {roleLabel(invitation.role)}
                          </Badge>
                          <Button
                            aria-label={t("organization.revokeInvite", {
                              email: invitation.email,
                            })}
                            className="size-8 text-muted-foreground hover:text-destructive"
                            disabled={revokingInvitationId === invitation.id}
                            onClick={() => {
                              setRevokingInvitationId(invitation.id);
                              setError(null);
                              void revokeOrganizationInvitation(
                                token,
                                organizationId,
                                invitation.id,
                              )
                                .then(() =>
                                  setInvitations((current) =>
                                    current.filter(
                                      (item) => item.id !== invitation.id,
                                    ),
                                  ),
                                )
                                .catch((caught) =>
                                  setError(
                                    caught instanceof Error
                                      ? caught.message
                                      : String(caught),
                                  ),
                                )
                                .finally(() => setRevokingInvitationId(null));
                            }}
                            size="icon-sm"
                            title={t("organization.revokeInvite", {
                              email: invitation.email,
                            })}
                            type="button"
                            variant="ghost"
                          >
                            <Trash2 size={15} strokeWidth={1.7} />
                          </Button>
                        </div>
                      ))
                    )}
                  </section>
                ) : null}
              </>
            ) : activeSection === "agents" ? (
              <OrganizationAgentsSettings
                organizationId={organizationId}
                organizationName={organization.name}
                token={token}
              />
            ) : activeSection === "workers" ? (
              <OrganizationWorkersSettings
                connectedProjectIds={connectedProjectIds}
                organization={organization}
                projects={projects}
                token={token}
                userId={userId}
              />
            ) : (
              <OrganizationIntegrationsSettings
                organizationId={organizationId}
                token={token}
              />
            )}
          </div>
        </SettingsScroll>
      </SettingsMain>

      <Dialog
        onOpenChange={(open) => {
          if (!savingProjectAccess && !open) setProjectAccessMember(null);
        }}
        open={projectAccessMember !== null}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("organization.projectAccessTitle", {
                name: projectAccessMember?.name ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("organization.projectAccessDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 grid max-h-[360px] gap-2 overflow-y-auto">
            {organizationProjects.map((project) => {
              const checked = selectedProjectIds.includes(project.id);
              return (
                <label
                  className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2.5 hover:bg-muted/60"
                  key={project.id}
                >
                  <Checkbox
                    checked={checked}
                    disabled={savingProjectAccess}
                    onCheckedChange={(nextChecked) =>
                      setSelectedProjectIds((current) =>
                        nextChecked
                          ? [...current, project.id]
                          : current.filter((projectId) => projectId !== project.id)
                      )
                    }
                  />
                  <Typography as="span" variant="bodySm">
                    {project.name}
                  </Typography>
                </label>
              );
            })}
            {organizationProjects.length === 0 ? (
              <Typography className="py-6 text-center" tone="muted" variant="bodySm">
                {t("organization.noProjects")}
              </Typography>
            ) : null}
          </div>
          {error ? <SettingsAlert className="mt-4">{error}</SettingsAlert> : null}
          <DialogFooter className="mt-6">
            <Button
              disabled={savingProjectAccess}
              onClick={() => setProjectAccessMember(null)}
              type="button"
              variant="outline"
            >
              {t("common.cancel")}
            </Button>
            <Button
              disabled={savingProjectAccess || !projectAccessMember}
              onClick={() => {
                if (!projectAccessMember) return;
                setSavingProjectAccess(true);
                setError(null);
                void updateOrganizationMemberProjects(
                  token,
                  organizationId,
                  projectAccessMember.userId,
                  selectedProjectIds,
                )
                  .then((result) => {
                    setMembers(result.members);
                    setProjectAccessMember(null);
                  })
                  .catch((caught) =>
                    setError(
                      caught instanceof Error ? caught.message : String(caught),
                    )
                  )
                  .finally(() => setSavingProjectAccess(false));
              }}
              type="button"
            >
              {savingProjectAccess ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          if (!saving) {
            setIsInviteOpen(open);
            if (!open) {
              setInviteUrl(null);
              setInviteLinkCopied(false);
            }
          }
        }}
        open={isInviteOpen}
      >
        <DialogContent className="sm:max-w-md">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!initialProjectId || inviteUrl) return;
              setSaving(true);
              setError(null);
              void createOrganizationInvitation(token, organizationId, {
                email,
                initialProjectId,
                role,
              })
                .then((result) => {
                  setInvitations((current) => [
                    result.invitation,
                    ...current.filter(
                      (item) =>
                        item.email.toLocaleLowerCase() !==
                        result.invitation.email.toLocaleLowerCase(),
                    ),
                  ]);
                  setInviteUrl(result.inviteUrl);
                  setInviteLinkCopied(false);
                })
                .catch((caught) =>
                  setError(
                    caught instanceof Error ? caught.message : String(caught),
                  ),
                )
                .finally(() => setSaving(false));
            }}
          >
            <DialogHeader>
              <DialogTitle>{t("organization.inviteTitle")}</DialogTitle>
              <DialogDescription>
                {t("organization.inviteDescription", {
                  name: organization.name,
                })}
              </DialogDescription>
            </DialogHeader>
            {inviteUrl ? (
              <div className="mt-5 grid gap-3">
                <div className="rounded-xl border border-success/30 bg-success/10 p-4">
                  <Typography
                    as="strong"
                    className="flex items-center gap-2"
                    variant="bodySm"
                  >
                    <Check className="text-success" size={17} />
                    {t("organization.inviteLinkReady")}
                  </Typography>
                  <Typography className="mt-1" tone="muted" variant="caption">
                    {t("organization.inviteLinkDescription")}
                  </Typography>
                </div>
                <div className="flex gap-2">
                  <Input
                    aria-label={t("organization.copyInviteLink")}
                    readOnly
                    value={inviteUrl}
                  />
                  <Button
                    aria-label={t("organization.copyInviteLink")}
                    onClick={() => {
                      void navigator.clipboard.writeText(inviteUrl).then(() => {
                        setInviteLinkCopied(true);
                      });
                    }}
                    size="icon"
                    type="button"
                    variant="outline"
                  >
                    {inviteLinkCopied ? (
                      <Check size={17} />
                    ) : (
                      <Copy size={17} />
                    )}
                  </Button>
                </div>
                {inviteLinkCopied ? (
                  <Typography
                    className="text-success"
                    role="status"
                    variant="caption"
                  >
                    {t("organization.inviteLinkCopied")}
                  </Typography>
                ) : null}
              </div>
            ) : (
              <div className="mt-4 grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="organization-invite-email">
                    {t("organization.inviteEmail")}
                  </Label>
                  <Input
                    id="organization-invite-email"
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("organization.inviteEmailPlaceholder")}
                    ref={inviteEmailRef}
                    required
                    type="email"
                    value={email}
                  />
                </div>
                <div className="grid gap-2">
                  <Label>{t("organization.inviteProject")}</Label>
                  <SelectMenu
                    disabled={organizationProjects.length === 0}
                    label={t("organization.inviteProject")}
                    onValueChange={setInitialProjectId}
                    options={organizationProjects.map((project) => ({
                      label: project.name,
                      value: project.id,
                    }))}
                    placeholder={t("organization.inviteProject")}
                    value={initialProjectId}
                  />
                  <Typography tone="muted" variant="caption">
                    {t("organization.inviteProjectDescription")}
                  </Typography>
                </div>
                <div className="grid gap-2">
                  <Label>{t("organization.inviteRole")}</Label>
                  <SelectMenu
                    label={t("organization.inviteRole")}
                    onValueChange={(value) =>
                      setRole(value as "admin" | "member")
                    }
                    options={[
                      {
                        label: t("organization.role.member"),
                        value: "member",
                      },
                      {
                        label: t("organization.role.admin"),
                        value: "admin",
                      },
                    ]}
                    value={role}
                  />
                </div>
                {error ? (
                  <SettingsAlert className="mt-0">{error}</SettingsAlert>
                ) : null}
              </div>
            )}
            <DialogFooter className="mt-6">
              {inviteUrl ? (
                <Button onClick={() => setIsInviteOpen(false)} type="button">
                  {t("common.close")}
                </Button>
              ) : (
                <>
                  <Button
                    disabled={saving}
                    onClick={() => setIsInviteOpen(false)}
                    type="button"
                    variant="outline"
                  >
                    {t("common.cancel")}
                  </Button>
                  <Button disabled={saving || !initialProjectId} type="submit">
                    {saving
                      ? t("organization.inviting")
                      : t("organization.sendInvite")}
                  </Button>
                </>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}
