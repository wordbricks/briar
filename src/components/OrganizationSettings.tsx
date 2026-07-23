import { ArrowLeft, Building2, Trash2, UserPlus } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  addOrganizationMember,
  loadOrganizationMembers,
  removeOrganizationMember,
} from "../lib/api";
import type { Organization, OrganizationMember } from "../types";

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
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const memberEmailRef = useRef<HTMLInputElement | null>(null);
  const organizationId = organization.id;
  const canManage =
    organization.role === "owner" || organization.role === "admin";

  useEffect(() => {
    void loadOrganizationMembers(token, organizationId)
      .then(setMembers)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      );
  }, [organizationId, token]);

  useEffect(() => {
    if (initialSection === "members") memberEmailRef.current?.focus();
  }, [initialSection]);

  return (
    <main className="organization-settings">
      <header>
        <button aria-label="뒤로" onClick={onBack} type="button">
          <ArrowLeft size={18} />
        </button>
        <Building2 size={20} />
        <div>
          <h1>{organization.name}</h1>
          <p>조직 멤버는 이 조직의 모든 프로젝트를 열람할 수 있습니다.</p>
        </div>
      </header>

      {canManage && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setSaving(true);
            setError(null);
            void addOrganizationMember(token, organizationId, { email, role })
              .then((result) => {
                setMembers(result.members);
                setEmail("");
              })
              .catch((caught) =>
                setError(caught instanceof Error ? caught.message : String(caught)),
              )
              .finally(() => setSaving(false));
          }}
        >
          <UserPlus size={18} />
          <input
            aria-label="멤버 이메일"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="동료의 Briar 이메일"
            ref={memberEmailRef}
            required
            type="email"
            value={email}
          />
          <select
            aria-label="멤버 권한"
            onChange={(event) => setRole(event.target.value as "admin" | "member")}
            value={role}
          >
            <option value="member">멤버</option>
            <option value="admin">관리자</option>
          </select>
          <button disabled={saving} type="submit">추가</button>
        </form>
      )}

      {error && <p className="organization-settings-error">{error}</p>}
      <section>
        <h2>멤버 {members.length}명</h2>
        {members.map((member) => (
          <div className="organization-member" key={member.userId}>
            <div>
              <strong>{member.name}</strong>
              <span>{member.email}</span>
            </div>
            <small>{member.role}</small>
            {organization.role === "owner" && member.role !== "owner" && (
              <button
                aria-label={`${member.name} 내보내기`}
                onClick={() => {
                  setError(null);
                  void removeOrganizationMember(token, organizationId, member.userId)
                    .then(() =>
                      setMembers((current) =>
                        current.filter((item) => item.userId !== member.userId),
                      ),
                    )
                    .catch((caught) =>
                      setError(
                        caught instanceof Error ? caught.message : String(caught),
                      ),
                    );
                }}
                type="button"
              >
                <Trash2 size={16} />
              </button>
            )}
          </div>
        ))}
      </section>
    </main>
  );
}
