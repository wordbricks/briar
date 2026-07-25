import {
  Building2,
  Check,
  LogOut,
  RefreshCw,
  Settings,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "./Logo";
import { useI18n } from "../i18n";
import type { Organization, Project, SessionUser } from "../types";
import { SelectMenu } from "./SelectMenu";

export function CompanionHeader({
  activeOrganizationId,
  activeProjectId,
  loading,
  onLogout,
  onOrganizationChange,
  onProjectChange,
  onRefresh,
  onSettings,
  organizations,
  projects,
  user,
}: {
  activeOrganizationId: string | null;
  activeProjectId: string | null;
  loading: boolean;
  onLogout: () => void;
  onOrganizationChange: (organizationId: string) => void;
  onProjectChange: (projectId: string) => void;
  onRefresh: () => void;
  onSettings: () => void;
  organizations: Organization[];
  projects: Project[];
  user: SessionUser;
}) {
  const { t } = useI18n();
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const accountTriggerRef = useRef<HTMLButtonElement>(null);
  const avatarInitial = (user.name || user.email).trim().charAt(0).toUpperCase();

  useEffect(() => {
    if (!isAccountMenuOpen) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !accountMenuRef.current?.contains(event.target)
      ) {
        setIsAccountMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setIsAccountMenuOpen(false);
      accountTriggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isAccountMenuOpen]);

  const selectOrganization = (organizationId: string) => {
    onOrganizationChange(organizationId);
    setIsAccountMenuOpen(false);
  };

  return (
    <header className="companion-header">
      <div className="companion-workspace">
        <div className="companion-workspace-mark">
          <Logo compact />
        </div>
        <div className="companion-project-picker">
          <SelectMenu
            className="companion-project-select"
            label={t("companion.project")}
            onValueChange={onProjectChange}
            options={projects.map((project) => ({
              label: project.name,
              value: project.id,
            }))}
            size="small"
            value={activeProjectId ?? ""}
          />
        </div>
      </div>
      <div className="companion-header-actions">
        <button
          aria-label={t("dashboard.refresh")}
          disabled={loading}
          onClick={onRefresh}
          type="button"
        >
          <RefreshCw className={loading ? "spin" : ""} size={19} />
        </button>
        <div className="companion-account-menu" ref={accountMenuRef}>
          <button
            aria-controls="companion-account-popover"
            aria-expanded={isAccountMenuOpen}
            aria-haspopup="menu"
            aria-label={t("account.menu")}
            className="companion-account-button"
            onClick={() => setIsAccountMenuOpen((open) => !open)}
            ref={accountTriggerRef}
            title={user.email}
            type="button"
          >
            {user.image ? (
              <img alt="" src={user.image} />
            ) : (
              <span>{avatarInitial}</span>
            )}
            <i aria-hidden="true" />
          </button>
          {isAccountMenuOpen ? (
            <div
              aria-label={t("account.menu")}
              className="companion-account-popover"
              id="companion-account-popover"
              role="menu"
            >
              <div className="companion-account-identity">
                <strong>{user.name || user.email}</strong>
                <small>{user.email}</small>
              </div>
              <div className="companion-account-separator" role="separator" />
              <button
                onClick={() => {
                  setIsAccountMenuOpen(false);
                  onSettings();
                }}
                role="menuitem"
                type="button"
              >
                <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{t("account.settings")}</span>
              </button>
              <div className="companion-account-separator" role="separator" />
              <div
                aria-label={t("sidebar.organizationList")}
                className="companion-organization-options"
                role="group"
              >
                <span>{t("sidebar.switchOrganization")}</span>
                {organizations.map((organization) => (
                  <button
                    aria-checked={organization.id === activeOrganizationId}
                    key={organization.id}
                    onClick={() => selectOrganization(organization.id)}
                    role="menuitemradio"
                    type="button"
                  >
                    <Building2 aria-hidden="true" size={17} strokeWidth={1.8} />
                    <span>{organization.name}</span>
                    {organization.id === activeOrganizationId ? (
                      <Check aria-hidden="true" size={17} strokeWidth={2} />
                    ) : null}
                  </button>
                ))}
              </div>
              <div className="companion-account-separator" role="separator" />
              <button
                className="companion-account-logout"
                onClick={onLogout}
                role="menuitem"
                type="button"
              >
                <LogOut aria-hidden="true" size={18} strokeWidth={1.8} />
                <span>{t("account.logout")}</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}

export function CompanionEmptyState({ onLogout }: { onLogout: () => void }) {
  const { t } = useI18n();

  return (
    <main className="companion-empty">
      <Logo />
      <span>{t("companion.badge")}</span>
      <h1>{t("companion.emptyTitle")}</h1>
      <p>{t("companion.emptyDescription")}</p>
      <button onClick={onLogout} type="button">
        {t("account.logout")}
      </button>
    </main>
  );
}
