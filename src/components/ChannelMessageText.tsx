import { memo, useMemo, useState, type MouseEvent } from "react";
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
import {
  ProfileDialog,
  profileTargetForChannelAgent,
  profileTargetForChannelMember,
  type ProfileTarget,
} from "./ProfileDialog";
import { ImageLightbox } from "./ImageLightbox";

export const ChannelMessageText = memo(function ChannelMessageText({
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
    const ambiguousHandles = new Set<string>();
    const mentionedAgentIds = new Set(message.mentionedAgentIds);
    const mentionedUserIds = new Set(message.mentionedUserIds);
    const addProfile = (handle: string, target: ProfileTarget) => {
      const key = handle.toLowerCase();
      if (ambiguousHandles.has(key)) return;
      if (profiles.has(key)) {
        profiles.delete(key);
        ambiguousHandles.add(key);
        return;
      }
      profiles.set(key, target);
    };

    for (const agent of agents) {
      if (!mentionedAgentIds.has(agent.agentId)) continue;
      const handle = agent.name;
      addProfile(handle, profileTargetForChannelAgent(agent));
    }
    for (const member of members) {
      if (!mentionedUserIds.has(member.userId)) continue;
      const handle = mentionHandle(member.email.split("@")[0] || member.userId);
      addProfile(handle, profileTargetForChannelMember(member));
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
              if (mentionedProfile) {
                return (
                  <button
                    className="conversation-mention-button channel-mention-button"
                    onClick={(event: MouseEvent<HTMLButtonElement>) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setProfile(mentionedProfile);
                    }}
                    type="button"
                  >
                    {children}
                  </button>
                );
              }
              return (
                <a
                  {...props}
                  className={props.className}
                  href={href}
                  onClick={props.onClick}
                >
                  {children}
                </a>
              );
            },
            img: ({ alt, src }) =>
              src ? <ImageLightbox alt={alt ?? ""} source={src} /> : null,
            table: ({ children, node: _node, ...props }) => (
              <div className="channel-message-table-wrap">
                <table {...props}>{children}</table>
              </div>
            ),
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
});
