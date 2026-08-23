import { type LandingCopy, type Locale, type RoutePath } from "./i18n";
import { LanguageSwitcher } from "./language-switcher";
import { MobileMenu } from "./mobile-menu";
import {
  standardSiteNavigation,
  WEB_APP_URL,
  type SiteLink,
} from "./site-links";

export function Arrow({
  direction = "out",
}: {
  direction?: "down" | "out";
}) {
  return (
    <svg
      aria-hidden="true"
      className="inline-arrow"
      fill="none"
      viewBox="0 0 16 16"
    >
      {direction === "down" ? (
        <path d="m3.5 6 4.5 4.5L12.5 6" />
      ) : (
        <path d="M4 12 12 4M6 4h6v6" />
      )}
    </svg>
  );
}

export function Brand({
  copy,
  href,
}: {
  copy: LandingCopy;
  href: string;
}) {
  return (
    <a className="brand" href={href} aria-label={copy.aria.brandHome}>
      <span className="brand-mark">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/briar-black-stroke.svg" alt="" />
      </span>
      <span>briar</span>
    </a>
  );
}

function SiteNavigation({
  label,
  links,
}: {
  label: string;
  links: SiteLink[];
}) {
  return (
    <nav aria-label={label}>
      {links.map((link) => (
        <a
          aria-current={link.isCurrent ? "page" : undefined}
          className={link.isCurrent ? "is-current" : undefined}
          href={link.href}
          key={link.href}
          rel={link.external ? "noreferrer" : undefined}
          target={link.external ? "_blank" : undefined}
        >
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export function SiteHeader({
  brandHref,
  className,
  copy,
  ctaLabel,
  currentPath,
  hrefs,
  locale,
  mobileCtaLabel = ctaLabel,
  navLinks,
  secondaryAction,
}: {
  brandHref: string;
  className?: string;
  copy: LandingCopy;
  ctaLabel: string;
  currentPath: RoutePath;
  hrefs: Record<Locale, string>;
  locale: Locale;
  mobileCtaLabel?: string;
  navLinks?: SiteLink[];
  secondaryAction?: SiteLink & { ariaLabel?: string };
}) {
  const links = navLinks ?? standardSiteNavigation(locale, copy, currentPath);
  const mobileLinks = secondaryAction ? [...links, secondaryAction] : links;

  return (
    <header className={["site-header", className].filter(Boolean).join(" ")}>
      <div className="shell nav-shell">
        <Brand copy={copy} href={brandHref} />
        <SiteNavigation label={copy.aria.mainMenu} links={links} />
        <div className="header-actions">
          <LanguageSwitcher
            locale={locale}
            label={copy.language.label}
            englishLabel={copy.language.english}
            koreanLabel={copy.language.korean}
            chineseLabel={copy.language.chinese}
            hrefs={hrefs}
          />
          {secondaryAction ? (
            <a
              aria-label={secondaryAction.ariaLabel}
              className="header-cta header-github"
              href={secondaryAction.href}
              rel={secondaryAction.external ? "noreferrer" : undefined}
              target={secondaryAction.external ? "_blank" : undefined}
            >
              {secondaryAction.label} <Arrow />
            </a>
          ) : null}
          <a
            aria-label={copy.aria.openWebApp}
            className="header-cta header-download"
            href={WEB_APP_URL}
          >
            <span className="header-cta-label">{ctaLabel}</span>{" "}
            <Arrow />
          </a>
          <MobileMenu
            navLabel={copy.aria.mainMenu}
            navLinks={mobileLinks}
            ctaHref={WEB_APP_URL}
            ctaLabel={mobileCtaLabel}
            ctaAriaLabel={copy.aria.openWebApp}
            openLabel={copy.aria.menuOpen}
            closeLabel={copy.aria.menuClose}
          />
        </div>
      </div>
    </header>
  );
}

export function SiteFooter({
  brandHref,
  copy,
  links,
}: {
  brandHref: string;
  copy: LandingCopy;
  links: SiteLink[];
}) {
  return (
    <footer>
      <div className="shell footer-shell">
        <Brand copy={copy} href={brandHref} />
        <p>{copy.footer.tagline}</p>
        <div>
          {links.map((link) => (
            <a
              href={link.href}
              key={link.href}
              rel={link.external ? "noreferrer" : undefined}
              target={link.external ? "_blank" : undefined}
            >
              {link.label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
