import { Bot, CalendarDays, Mail, ShieldCheck } from "lucide-react";
import { useI18n } from "../i18n";
import type {
  ChannelAgentSummary,
  ChannelAgentProvider,
  ChannelAgentSkill,
  ChannelMember,
  DirectMessageParticipant,
} from "../lib/channels-contract";
import type { OrganizationRole } from "../types";
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
      role: OrganizationRole;
      roleContext: "organization";
      createdAt: string;
    }
  | {
      type: "user";
      id: string;
      name: string;
      email: string;
      image: string | null;
      role: ChannelMember["role"];
      roleContext: "channel";
      createdAt: string;
    }
  | {
      type: "agent";
      id: string;
      name: string;
      provider: ChannelAgentProvider | null;
      model: string | null;
      description?: string | null;
      responsibility: string | null;
      skills: ChannelAgentSkill[];
      projectId: string | null;
      createdAt: string | null;
    };

export function profileTargetForChannelAgent(
  agent: ChannelAgentSummary,
): ProfileTarget {
  return {
    type: "agent",
    id: agent.agentId,
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    description: agent.description ?? null,
    responsibility: agent.responsibility,
    skills: agent.skills,
    projectId: agent.projectId,
    createdAt: agent.createdAt,
  };
}

export function profileTargetForChannelMember(
  member: ChannelMember,
): ProfileTarget {
  return {
    type: "user",
    id: member.userId,
    name: member.name,
    email: member.email,
    image: member.image,
    role: member.role,
    roleContext: "channel",
    createdAt: member.createdAt,
  };
}

export function profileTargetForDirectMessageParticipant(
  participant: DirectMessageParticipant,
  members: readonly ChannelMember[] = [],
  agents: readonly ChannelAgentSummary[] = [],
): ProfileTarget {
  if (participant.type === "agent") {
    const agent = agents.find((item) => item.agentId === participant.id);
    return agent
      ? profileTargetForChannelAgent(agent)
      : {
          type: "agent",
          id: participant.id,
          name: participant.name,
          provider: null,
          model: null,
          description: null,
          responsibility: null,
          skills: [],
          projectId: null,
          createdAt: null,
        };
  }
  const member = members.find((item) => item.userId === participant.id);
  return member
    ? profileTargetForChannelMember(member)
    : {
        type: "user",
        id: participant.id,
        name: participant.name,
        email: "",
        image: participant.image,
        role: "member",
        roleContext: "channel",
        createdAt: "",
      };
}

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
  const agentRuntime = profile?.type === "agent" ? profile : null;

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
              {profile.type === "user" && profile.email ? (
                <div>
                  <dt>
                    <Mail aria-hidden="true" size={16} /> {t("profile.email")}
                  </dt>
                  <dd>
                    <a href={`mailto:${profile.email}`}>{profile.email}</a>
                  </dd>
                </div>
              ) : null}
              <div>
                <dt>
                  <ShieldCheck aria-hidden="true" size={16} /> {t("profile.role")}
                </dt>
                <dd>{role}</dd>
              </div>
              {profile.type === "agent" && agentRuntime?.provider ? (
                <div>
                  <dt>
                    <Bot aria-hidden="true" size={16} /> {t("profile.provider")}
                  </dt>
                  <dd>
                    {agentRuntime.provider}
                    {agentRuntime.model ? ` · ${agentRuntime.model}` : ""}
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

            {profile.type === "agent" && profile.description ? (
              <section className="profile-dialog-responsibility">
                <h3>{t("agents.agentDescription")}</h3>
                <p>{profile.description}</p>
              </section>
            ) : null}
            {profile.type === "agent" && profile.responsibility ? (
              <section className="profile-dialog-responsibility">
                <h3>{t("profile.responsibility")}</h3>
                <p>{profile.responsibility}</p>
              </section>
            ) : null}
            {profile.type === "agent" && profile.skills.length > 0 ? (
              <section className="profile-dialog-responsibility profile-dialog-skills">
                <h3>{t("agents.skills")}</h3>
                <ul>
                  {profile.skills.map((skill) => (
                    <li key={skill.id}>
                      <strong>{skill.name}</strong>
                      {skill.description ? <span>{skill.description}</span> : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
