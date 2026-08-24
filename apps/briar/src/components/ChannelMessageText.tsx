import {
  Fragment,
  memo,
  useMemo,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import {
  ChannelAlertCard,
  ChannelCollapsibleDump,
} from "./ChannelAlertNotice";
import {
  channelAlertToneFromMessage,
  prettyPrintJson,
  shouldCollapseChannelText,
} from "../lib/channel-alert-presentation";
import type {
  ChannelAgentSummary,
  ChannelBlockTextObject,
  ChannelMember,
  ChannelMessage,
  ChannelMessageBlock,
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
import {
  MarkdownContent,
  defaultMarkdownUrlTransform,
} from "./MarkdownContent";
import { useI18n } from "../i18n";

/** Converts the small Slack mrkdwn subset accepted by webhook blocks to GFM. */
export function slackMrkdwnToMarkdown(value: string) {
  return value
    .replace(/<((?:https?:\/\/|mailto:)[^>|]+)\|([^>]+)>/gu, "[$2]($1)")
    .replace(/<((?:https?:\/\/|mailto:)[^>]+)>/gu, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/gu, "**$1**")
    .replace(/(?<!~)~([^~\n]+)~(?!~)/gu, "~~$1~~");
}

function BlockText({ text }: { text: ChannelBlockTextObject }) {
  return text.type === "mrkdwn" ? (
    <MarkdownContent>{slackMrkdwnToMarkdown(text.text)}</MarkdownContent>
  ) : (
    <p>{text.text}</p>
  );
}

type RichTextBlock = Extract<ChannelMessageBlock, { type: "rich_text" }>;
type RichTextElement = RichTextBlock["elements"][number];
type RichTextInline = Extract<
  RichTextElement,
  { type: "rich_text_section" }
>["elements"][number];

function RichInline({ element }: { element: RichTextInline }) {
  if (element.type === "emoji") return <>:{element.name}:</>;
  let content: ReactNode = element.type === "link"
    ? (
        <a href={defaultMarkdownUrlTransform(element.url)}>
          {element.text ?? element.url}
        </a>
      )
    : element.text;
  if (element.style?.code) content = <code>{content}</code>;
  if (element.style?.bold) content = <strong>{content}</strong>;
  if (element.style?.italic) content = <em>{content}</em>;
  if (element.style?.strike) content = <del>{content}</del>;
  return <>{content}</>;
}

function RichInlines({ elements }: { elements: RichTextInline[] }) {
  return elements.map((element, index) => (
    <Fragment key={index}><RichInline element={element} /></Fragment>
  ));
}

function RichTextElementView({ element }: { element: RichTextElement }) {
  if (element.type === "rich_text_section") {
    return <p><RichInlines elements={element.elements} /></p>;
  }
  if (element.type === "rich_text_quote") {
    return <blockquote><RichInlines elements={element.elements} /></blockquote>;
  }
  if (element.type === "rich_text_preformatted") {
    return <pre><code><RichInlines elements={element.elements} /></code></pre>;
  }
  const List = element.style === "ordered" ? "ol" : "ul";
  return (
    <List
      start={element.style === "ordered" ? (element.offset ?? 0) + 1 : undefined}
      style={{ marginLeft: `${element.indent ?? 0}rem` }}
    >
      {element.elements.map((section, index) => (
        <li key={index}><RichInlines elements={section.elements} /></li>
      ))}
    </List>
  );
}

function richInlinePlain(elements: RichTextInline[]) {
  return elements.map((element) => {
    if (element.type === "text") return element.text;
    if (element.type === "link") return element.text ?? element.url;
    return `:${element.name}:`;
  }).join("");
}

function CollapsibleBlock({
  text,
  expand = false,
  children,
}: {
  text: string;
  expand?: boolean;
  children: ReactNode;
}) {
  const json = prettyPrintJson(text);
  const inner = json
    ? <pre className="channel-alert-dump"><code>{json}</code></pre>
    : children;
  if (!shouldCollapseChannelText(text, expand) && !json) return <>{children}</>;
  if (!shouldCollapseChannelText(text, expand)) return inner;
  return (
    <ChannelCollapsibleDump text={json ?? text}>{inner}</ChannelCollapsibleDump>
  );
}

function ChannelMessageBlocks({
  blocks,
  tone,
}: {
  blocks: ChannelMessageBlock[];
  tone: ReturnType<typeof channelAlertToneFromMessage>;
}) {
  const content = (
    <div className="channel-message-blocks">
      {blocks.map((block, index) => {
        const key = block.block_id ?? `${block.type}-${index}`;
        switch (block.type) {
          case "header":
            return <h3 className="channel-message-block-header" key={key}>{block.text.text}</h3>;
          case "section":
            return (
              <section className="channel-message-block-section" key={key}>
                <CollapsibleBlock expand={block.expand === true} text={block.text.text}>
                  <BlockText text={block.text} />
                </CollapsibleBlock>
              </section>
            );
          case "markdown":
            return (
              <div className="channel-message-block-markdown" key={key}>
                <CollapsibleBlock text={block.text}>
                  <MarkdownContent>{block.text}</MarkdownContent>
                </CollapsibleBlock>
              </div>
            );
          case "divider":
            return <hr className="channel-message-block-divider" key={key} />;
          case "context":
            return (
              <div className="channel-message-block-context" key={key}>
                {block.elements.map((element, elementIndex) => (
                  <BlockText key={elementIndex} text={element} />
                ))}
              </div>
            );
          case "rich_text":
            return (
              <div className="channel-message-block-rich-text" key={key}>
                {block.elements.map((element, elementIndex) => {
                  if (element.type === "rich_text_preformatted") {
                    const text = richInlinePlain(element.elements);
                    return (
                      <CollapsibleBlock key={elementIndex} text={text}>
                        <RichTextElementView element={element} />
                      </CollapsibleBlock>
                    );
                  }
                  return (
                    <RichTextElementView element={element} key={elementIndex} />
                  );
                })}
              </div>
            );
        }
      })}
    </div>
  );
  return tone ? <ChannelAlertCard tone={tone}>{content}</ChannelAlertCard> : content;
}

export const ChannelMessageText = memo(function ChannelMessageText({
  agents,
  members,
  message,
}: {
  agents: readonly ChannelAgentSummary[];
  members: readonly ChannelMember[];
  message: ChannelMessage;
}) {
  const { t } = useI18n();
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
    () => [remarkIssueMentions([...profilesByHandle.keys()])],
    [profilesByHandle],
  );
  const body = channelBodyWithoutImages(message.body);
  const tone = channelAlertToneFromMessage(message);

  if (message.deletedAt) {
    return <p className="channel-message-deleted">{t("channel.deletedMessage")}</p>;
  }

  if (message.blocks?.length) {
    return <ChannelMessageBlocks blocks={message.blocks} tone={tone} />;
  }

  if (!body) return null;

  const json = prettyPrintJson(body);
  const markdown = (
    json ? (
      <pre className="channel-alert-dump"><code>{json}</code></pre>
    ) : (
      <MarkdownContent
        className="channel-message-text"
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
        }}
        remarkPlugins={remarkPlugins}
        urlTransform={(url) =>
          isIssueMentionUrl(url) ? url : defaultMarkdownUrlTransform(url)
        }
      >
        {body}
      </MarkdownContent>
    )
  );
  const content = (
    <CollapsibleBlock text={body}>{markdown}</CollapsibleBlock>
  );

  return (
    <>
      {tone ? <ChannelAlertCard tone={tone}>{content}</ChannelAlertCard> : content}
      <ProfileDialog
        profile={profile}
        onOpenChange={(open) => {
          if (!open) setProfile(null);
        }}
      />
    </>
  );
});
