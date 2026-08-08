import type { Metadata } from "next";
import { buildPageMetadata } from "../../seo";
import ChangelogView, { changelogCopy } from "../../views/changelog";

const LOCALE = "en" as const;
const PATH = "/changelog" as const;

export async function generateMetadata(): Promise<Metadata> {
  const metadata = changelogCopy[LOCALE].metadata;
  return buildPageMetadata({
    locale: LOCALE,
    path: PATH,
    title: metadata.title,
    description: metadata.description,
  });
}

export default function Page() {
  return <ChangelogView locale={LOCALE} />;
}
