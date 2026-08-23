import {
  localizedPath,
  type LandingCopy,
  type Locale,
  type RoutePath,
} from "./i18n";

export const WEB_APP_URL = "/app/";
export const GITHUB_URL = "https://github.com/wordbricks/briar";
export const GITHUB_RELEASES_URL = `${GITHUB_URL}/releases`;
export const GITHUB_LATEST_RELEASE_URL = `${GITHUB_RELEASES_URL}/latest`;
export const MAC_DOWNLOAD_URL =
  "https://briar-api.wbai.workers.dev/releases/latest/mac-aarch64.dmg";

export type SiteLink = {
  external?: boolean;
  href: string;
  isCurrent?: boolean;
  label: string;
};

const standardNavigation = [
  { key: "tutorial", path: "/tutorial" },
  { key: "docs", path: "/docs" },
  { key: "changelog", path: "/changelog" },
  { key: "blog", path: "/blog" },
  { key: "download", path: "/download" },
] as const satisfies ReadonlyArray<{
  key: keyof LandingCopy["nav"];
  path: RoutePath;
}>;

export function standardSiteNavigation(
  locale: Locale,
  copy: LandingCopy,
  currentPath: RoutePath,
): SiteLink[] {
  return standardNavigation.map(({ key, path }) => ({
    href: localizedPath(locale, path),
    isCurrent:
      currentPath === path ||
      (path === "/docs" && currentPath.startsWith("/docs/")),
    label: copy.nav[key],
  }));
}
