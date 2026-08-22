import type { MetadataRoute } from "next";
import { localizedPath, routePaths, supportedLocales } from "./i18n";
import { buildAlternateLanguages, resolveOrigin } from "./seo";

/**
 * Generated from the same `routePaths` + `supportedLocales` used for
 * routing and metadata, so every page/locale combination is listed here
 * automatically and can't drift from what's actually routable.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await resolveOrigin();
  const entries: MetadataRoute.Sitemap = [];

  for (const path of routePaths) {
    const languages = await buildAlternateLanguages(path);

    for (const locale of supportedLocales) {
      entries.push({
        url: `${origin}${localizedPath(locale, path)}`,
        changeFrequency: "weekly",
        priority: path === "/" ? 1 : 0.7,
        alternates: { languages },
      });
    }
  }

  return entries;
}
