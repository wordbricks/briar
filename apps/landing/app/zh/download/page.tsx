import type { Metadata } from "next";
import { buildPageMetadata } from "../../seo";
import DownloadView, { downloadCopy } from "../../views/download";

const LOCALE = "zh" as const;
const PATH = "/download" as const;

export async function generateMetadata(): Promise<Metadata> {
  const metadata = downloadCopy[LOCALE].metadata;
  return buildPageMetadata({
    locale: LOCALE,
    path: PATH,
    title: metadata.title,
    description: metadata.description,
  });
}

export default function Page() {
  return <DownloadView locale={LOCALE} />;
}
