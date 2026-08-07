import type { MetadataRoute } from "next";
import { resolveOrigin } from "./seo";

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await resolveOrigin();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // The web app proxied at /app/* (see app/app/[[...path]]/route.ts)
        // is an authenticated product surface, not a landing page — keep
        // it out of the index.
        disallow: ["/app"],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
