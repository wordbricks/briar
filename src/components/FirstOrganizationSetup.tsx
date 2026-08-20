import { LogOut } from "lucide-react";
import type { SessionUser } from "../types";
import { Logo } from "./Logo";
import { OrganizationCreate } from "./OrganizationCreate";

export function FirstOrganizationSetup({
  onCheckHandle,
  onCreate,
  onLogout,
  user,
}: {
  onCheckHandle: (handle: string) => Promise<boolean>;
  onCreate: (input: { name: string; handle: string }) => Promise<void>;
  onLogout: () => void;
  user: SessionUser;
}) {
  return (
    <div className="onboarding-shell project-onboarding-shell">
      <header className="onboarding-topbar" data-tauri-drag-region>
        <Logo />
        <div className="onboarding-topbar-actions">
          <button onClick={onLogout} type="button">
            <LogOut size={14} /> {user.email}
          </button>
        </div>
      </header>
      <main className="onboarding-card project-organization-card">
        <OrganizationCreate
          embedded
          onBack={onLogout}
          onCheckHandle={onCheckHandle}
          onCreate={onCreate}
        />
      </main>
    </div>
  );
}
