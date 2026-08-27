import { GitPullRequest } from "lucide-react";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
export function PullRequestIconLink({
  className = "",
  urls
}: {
  className?: string;
  urls: string[];
}) {
  const {
    t
  } = useI18n();
  const url = urls.at(-1);
  if (!url) return null;
  const label = pullRequestDisplayName(url, urls.length - 1);
  return <a aria-label={t("run.openPullRequest", {
    label
  })} className={cn("pull-request-icon-link inline-flex min-w-6 items-center justify-center gap-1 rounded-md border border-[#ddd8ed] bg-[#f4f0ff] px-1.5 py-0.5 font-mono text-2xs font-semibold text-[#6650ae] no-underline outline-none transition-colors hover:border-[#bdb1df] hover:bg-[#ece5ff] hover:text-[#513799] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring", className)} href={url} onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} rel="noreferrer" target="_blank" title={t("run.openPullRequest", {
    label
  })}>
      <GitPullRequest aria-hidden="true" size={13} />
      {urls.length > 1 && <span>{urls.length}</span>}
    </a>;
}
export function pullRequestDisplayName(url: string, index: number) {
  try {
    const match = new URL(url).pathname.match(/\/pull\/(\d+)\/?$/u);
    if (match) return `PR #${match[1]}`;
  } catch {
    // URLs are validated by the API; keep a safe fallback for historical data.
  }
  return index === 0 ? "PR" : `PR ${index + 1}`;
}
