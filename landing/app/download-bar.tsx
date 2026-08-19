import { DesktopDownloadLink } from "./desktop-download-link";
import { type LandingCopy, type Locale, localizedPath } from "./i18n";
import { supportedProviders } from "./provider-icons";
import {
  GITHUB_LATEST_RELEASE_URL,
  MAC_DOWNLOAD_URL,
  WEB_APP_URL,
} from "./site-links";

function AppleMark() {
  return (
    <svg
      aria-hidden="true"
      className="download-bar-mark"
      fill="currentColor"
      viewBox="0 0 16 16"
    >
      <path d="M12.62 8.36c-.02-2.08 1.7-3.08 1.78-3.13-1-1.43-2.5-1.63-3.03-1.65-1.27-.13-2.5.75-3.15.75-.66 0-1.66-.73-2.73-.71-1.39.02-2.68.81-3.4 2.06-1.46 2.53-.37 6.26 1.04 8.31.7 1 1.52 2.12 2.6 2.08 1.05-.04 1.45-.67 2.72-.67s1.63.67 2.73.65c1.13-.02 1.84-1.01 2.52-2.02.8-1.15 1.12-2.27 1.14-2.33-.02-.01-2.17-.83-2.2-3.34zm-2.07-5.94c.57-.7.96-1.66.85-2.63-.83.03-1.85.55-2.45 1.24-.53.6-.99 1.59-.87 2.52.92.07 1.87-.46 2.47-1.13z" />
    </svg>
  );
}

function GlobeMark() {
  return (
    <svg
      aria-hidden="true"
      className="download-bar-mark"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.6"
      viewBox="0 0 16 16"
    >
      <circle cx="8" cy="8" r="6" />
      <path d="M2.2 8h11.6M8 2c1.7 1.8 2.6 3.8 2.6 6S9.7 12.2 8 14C6.3 12.2 5.4 10.2 5.4 8S6.3 3.8 8 2z" />
    </svg>
  );
}

function PlayMark() {
  return (
    <svg
      aria-hidden="true"
      className="download-bar-mark"
      fill="currentColor"
      viewBox="0 0 16 16"
    >
      <path d="M2.1 1.35c-.4-.24-.9.05-.9.52v12.26c0 .47.5.76.9.52l11.16-6.13c.42-.23.42-.81 0-1.04L2.1 1.35z" />
    </svg>
  );
}

function TerminalMark() {
  return (
    <svg
      aria-hidden="true"
      className="download-bar-mark"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 16 16"
    >
      <path d="M3.2 5.2 6.4 8 3.2 10.8M8.2 11.4h4.6" />
    </svg>
  );
}

export function DownloadBar({
  copy,
  locale,
  showAllOptions = true,
  trackingLocation,
}: {
  copy: LandingCopy;
  locale: Locale;
  showAllOptions?: boolean;
  trackingLocation: "download_page" | "home_hero";
}) {
  const bar = copy.downloadBar;
  const downloadPage = localizedPath(locale, "/download");
  const providerNames = supportedProviders
    .map((provider) => provider.label)
    .join(", ");

  return (
    <div className="download-bar">
      <div className="download-bar-actions">
        <DesktopDownloadLink
          aria-label={copy.aria.macDownload}
          className="button button-primary download-bar-button"
          href={MAC_DOWNLOAD_URL}
          locale={locale}
          trackingLabel={bar.mac}
          trackingLocation={trackingLocation}
        >
          <AppleMark />
          {bar.mac}
        </DesktopDownloadLink>
        <a
          aria-label={copy.aria.openWebApp}
          className="button button-secondary download-bar-button"
          href={WEB_APP_URL}
        >
          <GlobeMark />
          {bar.webApp}
        </a>
        <a
          aria-label={copy.aria.iosDownload}
          className="button button-secondary download-bar-icon"
          href={`${downloadPage}#mobile`}
        >
          <AppleMark />
        </a>
        <a
          aria-label={copy.aria.androidDownload}
          className="button button-secondary download-bar-icon"
          href={GITHUB_LATEST_RELEASE_URL}
          rel="noreferrer"
          target="_blank"
        >
          <PlayMark />
        </a>
        <a
          aria-label={copy.aria.cliDownload}
          className="button button-secondary download-bar-icon"
          href={`${downloadPage}#cli`}
        >
          <TerminalMark />
        </a>
      </div>
      {showAllOptions ? (
        <a className="download-bar-all" href={downloadPage}>
          {bar.allOptions}
        </a>
      ) : null}
      <div
        aria-label={`${bar.supports}: ${providerNames}`}
        className="download-bar-supports"
        role="group"
      >
        <span>{bar.supports}</span>
        <ul className="download-bar-providers">
          {supportedProviders.map(({ id, label, Icon }) => (
            <li key={id} title={label}>
              <Icon className="download-bar-provider" />
              <span className="sr-only">{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
