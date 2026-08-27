import { Bot } from "lucide-react";
import type { IssueMessage } from "@/types";
export function MessageAvatar({
  message
}: {
  message: IssueMessage;
}) {
  if (message.author.provider) {
    return <span aria-label={message.author.name} className="issue-message-avatar agent">
        <Bot size={17} />
      </span>;
  }
  if (message.author.image) {
    return <img alt="" className="issue-message-avatar" src={message.author.image} />;
  }
  return <span aria-hidden="true" className="issue-message-avatar">
      {message.author.name.trim().charAt(0).toUpperCase() || "?"}
    </span>;
}
