import { useMemo, useState, type MouseEvent } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
  ChannelAgentSummary,
  ChannelMember,
  ChannelMessage,
} from "../lib/channels-contract";
import { mentionHandle } from "../lib/channel-mentions";
import {
  isIssueMentionUrl,
  issueMentionHandleFromUrl,
  remarkIssueMentions,
} from "../lib/issue-mentions";
import { channelBodyWithoutImages } from "./ChannelImages";
import { ProfileDialog, type ProfileTarget } from "./ProfileDialog";

export function ChannelMessageText({
  agents,
  members,
  message,
}: {
  agents: readonly ChannelAgentSummary[];
  members: readonly ChannelMember[];
  message: ChannelMessage;
}) {
  const [profile, setProfile] = useState<ProfileTarget | null>(null);
  const profilesByHandle = useMemo(() => {
    const profiles = new Map<string, ProfileTarget>();
    const mentionedAgentIds = new Set(message.mentionedAgentIds);
    const mentionedUserIds = new Set(message.mentionedUserIds);

    for (const agent of agents) {
      if (!mentionedAgentIds.has(agent.agentId)) continue;
      const handle = mentionHandle(agent.handle?.trim() || agent.name);
      profiles.set(handle.toLowerCase(), {
        type: "agent",
        id: agent.agentId,
        name: agent.name,
        handle,
        provider: agent.provider,
        model: agent.model,
        responsibility: agent.responsibility,
        projectId: agent.projectId,
        createdAt: agent.createdAt,
      });
    }
    for (const member of members) {
      if (!mentionedUserIds.has(member.userId)) continue;
      const handle = mentionHandle(member.email.split("@")[0] || member.userId);
      if (profiles.has(handle.toLowerCase())) continue;
      profiles.set(handle.toLowerCase(), {
        type: "user",
        id: member.userId,
        name: member.name,
        email: member.email,
        image: member.image,
        role: member.role,
        roleContext: "channel",
        createdAt: member.createdAt,
      });
    }
    return profiles;
  }, [agents, members, message.mentionedAgentIds, message.mentionedUserIds]);
  const remarkPlugins = useMemo(
    () => [remarkGfm, remarkIssueMentions([...profilesByHandle.keys()])],
    [profilesByHandle],
  );
  const body = channelBodyWithoutImages(message.body);

  if (!body) return null;

  return (
    <>
      <div className="channel-message-text">
        <ReactMarkdown
          components={{
            a: ({ children, href, node: _node, ...props }) => {
              const handle = issueMentionHandleFromUrl(href)?.toLowerCase();
              const mentionedProfile = handle
                ? profilesByHandle.get(handle) ?? null
                : null;
              return (
                <a
                  {...props}
                  className={
                    mentionedProfile ? "channel-mention-link" : props.className
                  }
                  href={href}
                  onClick={
                    mentionedProfile
                      ? (event: MouseEvent<HTMLAnchorElement>) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setProfile(mentionedProfile);
                        }
                      : props.onClick
                  }
                >
                  {children}
                </a>
              );
            },
          }}
          remarkPlugins={remarkPlugins}
          skipHtml
          urlTransform={(url) =>
            isIssueMentionUrl(url) ? url : defaultUrlTransform(url)
          }
        >
          {body}
        </ReactMarkdown>
      </div>
      <ProfileDialog
        profile={profile}
        onOpenChange={(open) => {
          if (!open) setProfile(null);
        }}
      />
    </>
  );
}
