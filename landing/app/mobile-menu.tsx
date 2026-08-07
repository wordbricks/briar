"use client";

import { useEffect, useId, useRef, useState } from "react";

export type MobileNavLink = {
  href: string;
  label: string;
  isCurrent?: boolean;
  external?: boolean;
};

type MobileMenuProps = {
  navLabel: string;
  navLinks: MobileNavLink[];
  ctaHref: string;
  ctaLabel: string;
  ctaAriaLabel?: string;
  openLabel: string;
  closeLabel: string;
};

export function MobileMenu({
  navLabel,
  navLinks,
  ctaHref,
  ctaLabel,
  ctaAriaLabel,
  openLabel,
  closeLabel,
}: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setIsOpen(false);
        toggleRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  function close() {
    setIsOpen(false);
  }

  return (
    <>
      <button
        ref={toggleRef}
        type="button"
        className="mobile-menu-toggle"
        aria-expanded={isOpen}
        aria-controls={panelId}
        aria-label={isOpen ? closeLabel : openLabel}
        onClick={() => setIsOpen((open) => !open)}
      >
        <span className="mobile-menu-icon" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </button>
      {isOpen ? (
        <div className="mobile-menu-backdrop" onClick={close} />
      ) : null}
      <div
        id={panelId}
        className={isOpen ? "mobile-menu is-open" : "mobile-menu"}
      >
        <nav aria-label={navLabel}>
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              aria-current={link.isCurrent ? "page" : undefined}
              target={link.external ? "_blank" : undefined}
              rel={link.external ? "noreferrer" : undefined}
              onClick={close}
            >
              {link.label}
            </a>
          ))}
        </nav>
        <a
          className="button button-primary mobile-menu-cta"
          href={ctaHref}
          aria-label={ctaAriaLabel}
          onClick={close}
        >
          {ctaLabel}
        </a>
      </div>
    </>
  );
}
