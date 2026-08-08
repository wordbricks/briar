import { AtSign, Bot, CalendarDays, Mail, ShieldCheck } from "lucide-react";
import { useI18n } from "../i18n";
import type { ChannelAgentProvider } from "../lib/channels-contract";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export type ProfileTarget =
  | {
      type: "user";
      id: string;
      name: string;
      email: string;
      image: string | null;
      role: "owner" | "admin" | "member";
      roleContext: "organization" | "channel";
      createdAt: string;
    }
  | {
      type: "agent";
      id: string;
      name: string;
      handle: string | null;
      provider: ChannelAgentProvider | null;
      model: string | null;
      responsibility: string | null;
      projectId: string | null;
      createdAt: string | null;
    };

export function ProfileDialog({
  profile,
  onOpenChange,
}: {
  profile: ProfileTarget | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { localeTag, t } = useI18n();
  const role =
    profile?.type === "user"
      ? profile.roleContext === "channel"
        ? t(
            profile.role === "owner"
              ? "profile.channelOwner"
              : "profile.channelMember",
          )
        : t(`organization.role.${profile.role}`)
      : profile?.projectId
        ? t("channel.projectAgent")
        : t("channel.orgAgent");
  const joinedAt = profile?.createdAt
    ? new Intl.DateTimeFormat(localeTag, {
        year: "numeric",
        month: "long",
        day: "numeric",
      }).format(new Date(profile.createdAt))
    : null;

  return (
    <Dialog open={profile !== null} onOpenChange={onOpenChange}>
      <DialogContent className="profile-dialog">
        {profile ? (
          <>
            <DialogHeader className="profile-dialog-header">
              <div className={`profile-dialog-avatar ${profile.type}`}>
                {profile.type === "user" && profile.image ? (
                  <img alt="" src={profile.image} />
                ) : profile.type === "agent" ? (
                  <Bot aria-hidden="true" size={30} />
                ) : (
                  profile.name.trim().charAt(0).toUpperCase() || "?"
                )}
              </div>
              <div>
                <DialogTitle>{profile.name}</DialogTitle>
                <DialogDescription>{role}</DialogDescription>
              </div>
            </DialogHeader>

            <dl className="profile-dialog-details">
              {profile.type === "user" ? (
                <div>
                  <dt>
                    <Mail aria-hidden="true" size={16} /> {t("profile.email")}
                  </dt>
                  <dd>
                    <a href={`mailto:${profile.email}`}>{profile.email}</a>
                  </dd>
                </div>
              ) : profile.handle ? (
                <div>
                  <dt>
                    <AtSign aria-hidden="true" size={16} /> {t("profile.handle")}
                  </dt>
                  <dd>@{profile.handle}</dd>
                </div>
              ) : null}
              <div>
                <dt>
                  <ShieldCheck aria-hidden="true" size={16} /> {t("profile.role")}
                </dt>
                <dd>{role}</dd>
              </div>
              {profile.type === "agent" && profile.provider ? (
                <div>
                  <dt>
                    <Bot aria-hidden="true" size={16} /> {t("profile.provider")}
                  </dt>
                  <dd>
                    {profile.provider}
                    {profile.model ? ` · ${profile.model}` : ""}
                  </dd>
                </div>
              ) : null}
              {joinedAt ? (
                <div>
                  <dt>
                    <CalendarDays aria-hidden="true" size={16} /> {t("profile.joined")}
                  </dt>
                  <dd>{joinedAt}</dd>
                </div>
              ) : null}
            </dl>

            {profile.type === "agent" && profile.responsibility ? (
              <section className="profile-dialog-responsibility">
                <h3>{t("profile.responsibility")}</h3>
                <p>{profile.responsibility}</p>
              </section>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
