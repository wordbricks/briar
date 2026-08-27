import { Bot } from "lucide-react";
import type { IssueMessage } from "@/types";
import { cn } from "@/lib/utils";
export function MessageAvatar({
  message
}: {
  message: IssueMessage;
}) {
  if (message.author.provider) {
    return <span aria-label={message.author.name} className="issue-message-avatar agent grid size-[34px] place-items-center overflow-hidden rounded-lg border border-border bg-accent text-accent-foreground">
        <Bot size={17} />
      </span>;
  }
  if (message.author.image) {
    return <img alt="" className="issue-message-avatar size-[34px] overflow-hidden rounded-lg border border-border object-cover" src={message.author.image} />;
  }
  return <span aria-hidden="true" className={cn("issue-message-avatar grid size-[34px] place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-[#8068ce] to-[#5943a4] text-sm font-bold text-white")}>
      {message.author.name.trim().charAt(0).toUpperCase() || "?"}
    </span>;
}
