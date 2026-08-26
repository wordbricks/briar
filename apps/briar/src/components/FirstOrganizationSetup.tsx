import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
    <div className="scrollbar-subtle relative grid h-full min-h-0 w-full place-items-start justify-items-center overflow-y-auto overscroll-y-contain bg-background [scrollbar-gutter:stable]">
      <header
        className="fixed inset-x-0 top-0 z-[2] flex h-[58px] items-center justify-between border-b border-border bg-card/80 pl-[var(--traffic-light-safe-inset)] pr-[22px] text-xl font-bold backdrop-blur-[18px]"
        data-tauri-drag-region
      >
        <Logo />
        <div className="flex items-center gap-1">
          <Button
            className="h-auto min-h-0 rounded-lg px-[9px] py-[7px] text-[var(--text-2xs)] font-medium text-muted-foreground shadow-none hover:bg-secondary hover:text-foreground [&_svg]:size-3.5"
            onClick={onLogout}
            type="button"
            variant="ghost"
          >
            <LogOut size={14} /> {user.email}
          </Button>
        </div>
      </header>
      <main className="flex w-full justify-center">
        <Card className="mt-[92px] mb-[34px] w-[min(660px,calc(100vw-48px))] max-w-full rounded-3xl p-9 shadow-[0_26px_80px_rgba(38,42,32,0.1)] max-[760px]:p-[26px]">
          <OrganizationCreate
            embedded
            onBack={onLogout}
            onCheckHandle={onCheckHandle}
            onCreate={onCreate}
          />
        </Card>
      </main>
    </div>
  );
}
