import {
  ArrowLeft,
  Download,
  Search,
  Trash2,
  UserPlus,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import {
  addOrganizationMember,
  loadOrganizationMembers,
  removeOrganizationMember,
} from "../lib/api";
import type { Organization, OrganizationMember } from "../types";

type RoleFilter = "all" | OrganizationMember["role"];

const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function OrganizationSettings({
  organization,
  token,
  onBack,
  initialSection,
}: {
  organization: Organization;
  token: string;
  onBack: () => void;
  initialSection?: "members";
}) {
  const { locale, t } = useI18n();
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const inviteEmailRef = useRef<HTMLInputElement | null>(null);
  const organizationId = organization.id;
  const canManage =
    organization.role === "owner" || organization.role === "admin";
  const dateLocale =
    locale === "ko" ? "ko-KR" : locale === "zh" ? "zh-CN" : "en-US";

  useEffect(() => {
    setLoading(true);
    void loadOrganizationMembers(token, organizationId)
      .then((result) => {
        setMembers(result);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      )
      .finally(() => setLoading(false));
  }, [organizationId, token]);

  useEffect(() => {
    if (initialSection === "members") searchRef.current?.focus();
  }, [initialSection]);

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
        t("organization.joined"),
      ],
      ...filteredMembers.map((member) => [
        member.name,
        member.email,
        roleLabel(member.role),
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
    <main className="organization-settings">
      <header className="organization-members-header">
        <button
          aria-label={t("organization.back")}
          className="organization-members-back"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft size={18} strokeWidth={1.8} />
        </button>
        <div>
          <h1>{t("organization.membersTitle")}</h1>
          <p>{t("organization.membersDescription", { name: organization.name })}</p>
        </div>
      </header>

      <div className="organization-members-toolbar">
        <label className="organization-members-search">
          <Search aria-hidden="true" size={17} strokeWidth={1.8} />
          <input
            aria-label={t("organization.search")}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("organization.searchPlaceholder")}
            ref={searchRef}
            type="search"
            value={query}
          />
        </label>
        <select
          aria-label={t("organization.roleFilter")}
          className="organization-role-filter"
          onChange={(event) => setRoleFilter(event.target.value as RoleFilter)}
          value={roleFilter}
        >
          <option value="all">{t("organization.filterAll")}</option>
          <option value="owner">{t("organization.role.owner")}</option>
          <option value="admin">{t("organization.role.admin")}</option>
          <option value="member">{t("organization.role.member")}</option>
        </select>
        <div className="organization-members-actions">
          <button
            className="organization-export-button"
            disabled={members.length === 0}
            onClick={exportMembers}
            type="button"
          >
            <Download aria-hidden="true" size={15} strokeWidth={1.8} />
            {t("organization.exportCsv")}
          </button>
          {canManage && (
            <button
              className="organization-invite-button"
              onClick={() => {
                setError(null);
                setIsInviteOpen(true);
              }}
              type="button"
            >
              <UserPlus aria-hidden="true" size={15} strokeWidth={1.8} />
              {t("organization.invite")}
            </button>
          )}
        </div>
      </div>

      {error && !isInviteOpen && (
        <p className="organization-settings-error" role="alert">
          {error}
        </p>
      )}

      <section
        aria-label={t("organization.memberList")}
        className="organization-member-table"
      >
        <div className="organization-member-table-head" role="row">
          <span>{t("organization.name")}</span>
          <span>{t("organization.email")}</span>
          <span>{t("organization.role")}</span>
          <span>{t("organization.joined")}</span>
          <span className="visually-hidden">{t("organization.actions")}</span>
        </div>
        <div className="organization-member-group">
          <strong>{t("organization.active")}</strong>
          <span>{members.length}</span>
        </div>
        {loading ? (
          <p className="organization-member-empty">{t("organization.loading")}</p>
        ) : filteredMembers.length === 0 ? (
          <p className="organization-member-empty">
            {members.length === 0
              ? t("organization.noMembers")
              : t("organization.noResults")}
          </p>
        ) : (
          filteredMembers.map((member) => (
            <div className="organization-member-row" key={member.userId}>
              <div className="organization-member-identity">
                <div className="organization-member-avatar">
                  {member.image ? (
                    <img alt="" src={member.image} />
                  ) : (
                    member.name.slice(0, 1).toUpperCase()
                  )}
                </div>
                <div>
                  <strong>{member.name}</strong>
                  <small>{member.email.split("@")[0]}</small>
                </div>
              </div>
              <span className="organization-member-email">{member.email}</span>
              <span
                className={`organization-member-role role-${member.role}`}
              >
                {roleLabel(member.role)}
              </span>
              <time dateTime={member.createdAt}>
                {new Intl.DateTimeFormat(dateLocale, {
                  month: "short",
                  year: "numeric",
                }).format(new Date(member.createdAt))}
              </time>
              {organization.role === "owner" && member.role !== "owner" ? (
                <button
                  aria-label={t("organization.removeMember", {
                    name: member.name,
                  })}
                  className="organization-member-remove"
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
                  title={t("organization.removeMember", { name: member.name })}
                  type="button"
                >
                  <Trash2 size={15} strokeWidth={1.7} />
                </button>
              ) : (
                <span aria-hidden="true" />
              )}
            </div>
          ))
        )}
      </section>

      {isInviteOpen && (
        <div
          className="organization-invite-overlay"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !saving) {
              setIsInviteOpen(false);
            }
          }}
        >
          <form
            aria-modal="true"
            aria-labelledby="organization-invite-title"
            className="organization-invite-dialog"
            onSubmit={(event) => {
              event.preventDefault();
              setSaving(true);
              setError(null);
              void addOrganizationMember(token, organizationId, { email, role })
                .then((result) => {
                  setMembers(result.members);
                  setEmail("");
                  setRole("member");
                  setIsInviteOpen(false);
                })
                .catch((caught) =>
                  setError(
                    caught instanceof Error ? caught.message : String(caught),
                  ),
                )
                .finally(() => setSaving(false));
            }}
            role="dialog"
          >
            <header>
              <div>
                <h2 id="organization-invite-title">
                  {t("organization.inviteTitle")}
                </h2>
                <p>
                  {t("organization.inviteDescription", {
                    name: organization.name,
                  })}
                </p>
              </div>
              <button
                aria-label={t("common.close")}
                disabled={saving}
                onClick={() => setIsInviteOpen(false)}
                type="button"
              >
                <X size={17} strokeWidth={1.8} />
              </button>
            </header>
            <label>
              <span>{t("organization.inviteEmail")}</span>
              <input
                onChange={(event) => setEmail(event.target.value)}
                placeholder={t("organization.inviteEmailPlaceholder")}
                ref={inviteEmailRef}
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              <span>{t("organization.inviteRole")}</span>
              <select
                onChange={(event) =>
                  setRole(event.target.value as "admin" | "member")
                }
                value={role}
              >
                <option value="member">{t("organization.role.member")}</option>
                <option value="admin">{t("organization.role.admin")}</option>
              </select>
            </label>
            {error && (
              <p className="organization-invite-error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                disabled={saving}
                onClick={() => setIsInviteOpen(false)}
                type="button"
              >
                {t("common.cancel")}
              </button>
              <button disabled={saving} type="submit">
                {saving
                  ? t("organization.inviting")
                  : t("organization.sendInvite")}
              </button>
            </footer>
          </form>
        </div>
      )}
    </main>
  );
}
