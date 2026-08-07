import type { Metadata } from "next";
import { buildPageMetadata } from "../../seo";
import TutorialView, { tutorialCopy } from "../../views/tutorial";

const LOCALE = "ko" as const;
const PATH = "/tutorial" as const;

export async function generateMetadata(): Promise<Metadata> {
  const metadata = tutorialCopy[LOCALE].metadata;
  return buildPageMetadata({
    locale: LOCALE,
    path: PATH,
    title: metadata.title,
    description: metadata.description,
  });
}

export default function Page() {
  return <TutorialView locale={LOCALE} />;
}
