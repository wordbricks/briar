import type { Metadata } from "next";
import { copy } from "../i18n";
import { buildPageMetadata } from "../seo";
import HomeView from "../views/home";

const LOCALE = "en" as const;
const PATH = "/" as const;

export async function generateMetadata(): Promise<Metadata> {
  const metadata = copy[LOCALE].metadata;
  return buildPageMetadata({
    locale: LOCALE,
    path: PATH,
    title: metadata.title,
    description: metadata.description,
    socialDescription: metadata.socialDescription,
  });
}

export default function Page() {
  return <HomeView locale={LOCALE} />;
}
