"use client";

import type {
  AnchorHTMLAttributes,
  MouseEventHandler,
  ReactNode,
} from "react";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

type DesktopDownloadLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "children" | "href"
> & {
  children: ReactNode;
  href: string;
  locale: "en" | "ko";
  trackingLabel: string;
  trackingLocation: "download_page" | "home_final" | "home_hero" | "tutorial";
};

/** Sends the DMG event explicitly because GA4 enhanced measurement omits .dmg. */
export function DesktopDownloadLink({
  children,
  href,
  locale,
  onClick,
  trackingLabel,
  trackingLocation,
  ...props
}: DesktopDownloadLinkProps) {
  const trackDownload: MouseEventHandler<HTMLAnchorElement> = (event) => {
    onClick?.(event);
    if (event.defaultPrevented) return;

    window.gtag?.("event", "file_download", {
      download_architecture: "arm64",
      download_location: trackingLocation,
      download_platform: "macos",
      file_extension: "dmg",
      file_name: "mac-aarch64.dmg",
      link_text: trackingLabel,
      link_url: href,
      site_locale: locale,
      transport_type: "beacon",
    });
  };

  return (
    <a
      {...props}
      data-download-architecture="arm64"
      data-download-platform="macos"
      href={href}
      onClick={trackDownload}
    >
      {children}
    </a>
  );
}
